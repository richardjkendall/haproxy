var AWS = require("aws-sdk");
var fs = require("fs");
var exec = require("child_process").exec;
var winston = require("winston");

const logger = winston.createLogger({
	level: "info",
	format: winston.format.json(),
	transports: [new winston.transports.Console()]
});

var boilerplateConfig = `
global
	log stdout  format raw  local0  info

defaults
	log     global
	mode    http
	retries 3
	option redispatch
	option httplog
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
var sleepTime = 10000;
var prevConfig = "";
var applyConfig = false;
var namespaceMap = {};
var revNamespaceMap = {};

async function refreshConfig() {
	var sd = new AWS.ServiceDiscovery({region: awsRegion});
	var frontends = "";
	var backends = "";
	var overallConfig = boilerplateConfig;
	overallConfig = overallConfig + frontEndMainConfig;

	// get list services, filtered by the namespaces we want to use
	// need to loop through the list of namespaces one by one so we can 
	logger.info("Got " + namespaceIds.length + " namespaces to get services for");
	for(var currentNamespace = 0;currentNamespace < namespaceIds.length;currentNamespace++) {
		var currentNamespaceId = namespaceIds[currentNamespace];
		logger.info("Getting services for namespace: " + currentNamespaceId);
		var params = {
			MaxResults: 100,
			Filters: [
				{
					Name: "NAMESPACE_ID",
					Values: [currentNamespaceId],
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
					
					// make frontend config
					var frontend = frontendVhostRuleConfig.replace(/%NAME%/g, service.Name);
					var domainName = revNamespaceMap[currentNamespaceId];
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

	// return the overall config
	overallConfig = overallConfig + frontends + backends + defaultBackendConfig;
	return overallConfig;
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
			if(!applyConfig) {
				logger.info("Not in apply mode, printing config to console")
				console.log(config);
			} else {
				fs.writeFileSync("/usr/local/etc/haproxy/haproxy.cfg", config);  // /usr/local/etc/haproxy/haproxy
				logger.info("Wrote updated config to file");
				logger.info("Sending SIGUSR2 signal to haproxy process");
				exec("killall -12 haproxy").unref();
			}
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
				revNamespaceMap[namespace.Id] = namespaceMap.filter(n => n.namespace == namespace.Name)[0].domainname;
			}
		}
		logger.info("Namespaces found ", {"namespaceIds": namespaceIds});
	} catch (err) {
		console.log(err);
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

		// mode (generate only, or update)
		if("APPLY_MODE" in process.env) {
			applyConfig = process.env.APPLY_MODE == "on" ? true : false;
		} else {
			logger.warn("Expecting APPLY_MODE environment variable, setting default of on");
			applyConfig = true;
		}

		// refresh rate
		if("REFRESH_RATE" in process.env) {
			sleepTime = parseInt(process.env.REFRESH_RATE, 10) * 1000;
		} else {
			logger.warn("Expecting APPLY_MODE environment variable, setting default of 60 seconds");
			sleepTime = 60000;
		}

		// namespace map
		if("NAMESPACE_MAP" in process.env) {
			namespaceMap = JSON.parse(process.env.NAMESPACE_MAP);
			requestedNamespaces = await namespaceMap.map((c) => {return c.namespace});
		} else {
			logger.error("Expecting NAMESPACE_MAP environment variable");
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
		console.log(err);
		logger.error(err);
		logger.error("Exiting");
		process.exit(1);
	}
}

run();