var AWS = require("aws-sdk");
var fs = require("fs");
var exec = require("child_process").exec;
var winston = require("winston");

const logger = winston.createLogger({
	level: 'info',
	format: winston.format.json(),
	transports: [new winston.transports.Console()]
});

var boilerplateConfig = `
global
	log 127.0.0.1 local0 notice
	maxconn 2000

defaults
	log     global
	mode    http
	retries 3
	option redispatch
	timeout connect  5000
	timeout client  10000
	timeout server  10000
	stats enable
	stats uri     /myhaproxy?stats
	stats auth stats_user:Q1w2e3r4t5y6!
`;

var backendConfig = `
	backend %NAME%_backend
		mode http
		balance roundrobin
		option httpclose
		option forwardfor`;

var frontendVhostRuleConfig = `
	acl %NAME%_host hdr_dom(host) -i %NAME%.%DOMAIN%
	use_backend %NAME%_backend if %NAME%_host
`;

var defaultBackendConfig = `
	backend default_location
		redirect location http://%DEFAULTDOMAIN%`;

var frontEndMainConfig = `
frontend main 
	bind *:80
	default_backend default_location
`;

var awsRegion = "";
var defaultDomain = "";
var requestedNamespaces = [];
var namespaceIds = [];
var domainName = "";
var sleepTime = 10000;
var prevConfig = "";

async function refreshConfig() {
	var sd = new AWS.ServiceDiscovery({region: awsRegion});
	var frontends = "";
	var backends = "";
	var overallConfig = boilerplateConfig;
	overallConfig = overallConfig + frontEndMainConfig;

	// get list services, filtered by the namespaces we want to use
	var params = {
		MaxResults: 100,
		Filters: [
			{
				Name: "NAMESPACE_ID",
				Values: namespaceIds,
				Condition: "EQ"
			}
		]
	};
	
	try {
		// get services from AWS service discovery
		services = await sd.listServices(params).promise();
		var servicesCount = services.Services.length;
		
		// loop through the services
		for(var currentService = 0;currentService < servicesCount;currentService++) {
			var service = services.Services[currentService];
			
			// need to get the instances for this service
			var params = {
				ServiceId: service.Id,
				MaxResults: 100
			};
			try {
				instances = await sd.listInstances(params).promise();
				var instanceCount = instances.Instances.length;
				
				// check if we got to the end of the services and the instance count of this service is 0 so we can return the config
				if (instanceCount == 0 && currentService == servicesCount - 1) {
					overallConfig = overallConfig + frontends + backends + defaultBackendConfig;
					return overallConfig;
				}
				
				// make frontend config
				var frontend = frontendVhostRuleConfig.replace(/%NAME%/g, service.Name);
				frontend = frontend.replace(/%DOMAIN%/g, domainName);
				
				// make start of backend config
				var backend = backendConfig.replace(/%NAME%/g, service.Name);
				
				// loop through each instance
				for(var currentInstance = 0;currentInstance < instanceCount;currentInstance++) {
					var instance = instances.Instances[currentInstance];
					var ip = instance.Attributes.AWS_INSTANCE_IPV4;
					var port = instance.Attributes.AWS_INSTANCE_PORT;
					
					// add backend config for this instance
					backend = backend + "\n\t\tserver s" + currentInstance + " " + ip + ":" + port + " weight 1 check";
					
					// if this is the last instance we should add the frontend and backend config
					if(currentInstance == instanceCount - 1) {
						frontends = frontends + frontend;
						backends = backends + backend + "\n";
						
						// if this is the last service then we should return the config
						if(currentService == servicesCount - 1) {
							overallConfig = overallConfig + frontends + backends + defaultBackendConfig;
							return overallConfig;
						}
					}
				}
			} catch (err) {
				logger.error(err);
				throw err;
			}

		}
	} catch (err) {
		logger.error(err);
		throw err;
	}
}

async function continuousRefresh() {
	logger.info("Getting services from SD API...");
	try {
		// get a fresh config copy
		var config = await refreshConfig();
		logger.info("Got service data");
		
		// check if the config has changed
		if(config == prevConfig) {
			logger.info("The config has not changed");
		} else {
			// config has changed
			logger.info("The config has changed");
			prevConfig = config;
			//console.log(config);
			fs.writeFileSync("/usr/local/etc/haproxy/haproxy.cfg", config);  // /usr/local/etc/haproxy/haproxy
			logger.info("Wrote updated config to file");
			logger.info("Sending SIGUSR2 signal to haproxy process");
			exec("killall -12 haproxy-systemd-wrapper").unref();
		}
		setTimeout(continuousRefresh, sleepTime);
	} catch (err) {
		logger.error("Hit error while trying to get config");
	}
}

async function prepare() {
	logger.info("Getting namespaces from SD API...");
	
	// call API to get the list of namespaces
	var params = {
		MaxResults: 100
	};
	var sd = new AWS.ServiceDiscovery({region: awsRegion});
	try {
		var namespaces = await sd.listNamespaces(params).promise();
		
		// loop through the namespaces to see if we have a match to the ones we want
		for(var i = 0;i < namespaces.Namespaces.length;i++) {
			var namespace = namespaces.Namespaces[i];
			if(requestedNamespaces.includes(namespace.Name)) {
				logger.info("Found namespace " + namespace.Name + " with ID: " + namespace.Id);
				namespaceIds.push(namespace.Id);
			}
		}
		logger.info("Namespaces found ", {"namespaceIds": namespaceIds});
	} catch (err) {
		logger.error(err);
		throw err;
	}
}

async function run() {
	try {
		// check if environment variables are present
		
		// AWS region
		if("AWS_REGION" in process.env) {
			awsRegion = process.env.AWS_REGION;
		} else {
			logger.error("Expecting AWS_REGION environment variable");
			process.exit(1);
		}
		
		// domain name
		if("DOMAIN_NAME" in process.env) {
			domainName = process.env.DOMAIN_NAME;
		} else {
			logger.error("Expecting DOMAIN_NAME environment variable");
			process.exit(1);
		}
		
		// namespaces
		if("NAMESPACES" in process.env) {
			requestedNamespaces = process.env.NAMESPACES.split(",");
		} else {
			logger.error("Expecting NAMESPACES environment variable");
			process.exit(1);
		}
		
		// default domain
		if("DEFAULT_DOMAIN" in process.env) {
			defaultDomain = process.env.DEFAULT_DOMAIN;
			defaultBackendConfig = defaultBackendConfig.replace(/%DEFAULTDOMAIN%/g, defaultDomain);
		} else {
			logger.error("Expecting DEFAULT_DOMAIN environment variable");
			process.exit(1);
		}
		
		await prepare();
		continuousRefresh();
	} catch (err) {
		logger.error(err);
		logger.error("Exiting");
		process.exit(1);
	}
}

run();

