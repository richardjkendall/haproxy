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
		redirect location http://null.richardjameskendall.com`;

var frontEndMainConfig = `
frontend main 
	bind *:80
	default_backend default_location
`;

var domainName = "richardjameskendall.com";
var sleepTime = 10000;
var prevConfig = "";

async function refreshConfig() {
	var sd = new AWS.ServiceDiscovery({region: "ap-southeast-2"});
	var frontends = "";
	var backends = "";
	var overallConfig = boilerplateConfig;
	overallConfig = overallConfig + frontEndMainConfig;

	// get list services
	var params = {
		MaxResults: 100
	};
	
	try {
		// get services from AWS service discovery
		services = await sd.listServices(params).promise();
		var servicesCount = services.Services.length;
		
		// loop through the services
		for(var currentService = 0;currentService < servicesCount;currentService++) {
			var service = services.Services[currentService];
			var params = {
				ServiceId: service.Id,
				MaxResults: 100
			};
			try {
				instances = await sd.listInstances(params).promise();
				//console.log("got instances");
				var instanceCount = instances.Instances.length;
				if (instanceCount == 0 && currentService == servicesCount - 1) {
					overallConfig = overallConfig + frontends + backends + defaultBackendConfig;
					return overallConfig;
				}
				//console.log("instance count", instanceCount);
				var frontend = frontendVhostRuleConfig.replace(/%NAME%/g, service.Name);
				frontend = frontend.replace(/%DOMAIN%/g, domainName);
				var backend = backendConfig.replace(/%NAME%/g, service.Name);
				
				for(var currentInstance = 0;currentInstance < instanceCount;currentInstance++) {
					//console.log("instance #", currentInstance);
					var instance = instances.Instances[currentInstance];
					var ip = instance.Attributes.AWS_INSTANCE_IPV4;
					var port = instance.Attributes.AWS_INSTANCE_PORT;
					backend = backend + "\n\t\tserver s" + currentInstance + " " + ip + ":" + port + " weight 1 check";
					//console.log("current instance", currentInstance, "instance count -1", instanceCount -1);
					if(currentInstance == instanceCount - 1) {
						//console.log("instance count match");
						//overallConfig = overallConfig + frontend;
						frontends = frontends + frontend;
						//overallConfig = overallConfig + backend + "\n";
						backends = backends + backend + "\n";
						//console.log("current service", currentService, "service count -1", servicesCount -1);
						if(currentService == servicesCount - 1) {
							overallConfig = overallConfig + frontends + backends + defaultBackendConfig;
							return overallConfig;
						}
					}
				}
			} catch (err) {
				console.log(err, err.stack);
				return err;
			}

		}
	} catch (err) {
		console.log(err, err.stack);
		return err;
	}
}

async function continuousRefresh() {
	logger.info("Getting services from SD API...");
	var config = await refreshConfig();
	logger.info("Got service data");
	if(config == prevConfig) {
		logger.info("The config has not changed");
	} else {
		logger.info("The config has changed");
		prevConfig = config;
		console.log(config);
		//fs.writeFileSync("/usr/local/etc/haproxy/haproxy.cfg", config);  // /usr/local/etc/haproxy/haproxy
		logger.info("Wrote updated config to file");
		logger.info("Sending SIGUSR2 signal to haproxy process");
		exec("killall -12 haproxy-systemd-wrapper").unref();
	}
	setTimeout(continuousRefresh, sleepTime);
}

continuousRefresh();
