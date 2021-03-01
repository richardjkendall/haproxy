![travis ci](https://api.travis-ci.org/richardjkendall/haproxy.svg?branch=master "build status")

# haproxy + AWS Service Discovery
This is a Docker image automatically configures haproxy using information retrieved from the AWS Service Discovery API.

It is based on the ``haproxy:2.1.1`` base image.

Exposes service on 80/tcp.

Polls for changes every 60 seconds and reloads haproxy with signal SIGUSR2 each time a new config is detected.  This refresh rate is configurable with the ``REFRESH_RATE`` environment variable.

Currently only works for services with tasks that use the ``bridge`` networking mode.

See this on docker hub here https://hub.docker.com/r/richardjkendall/haproxy/
## Building
Clone the repository

 1. cd to the directory ``cd haproxy``
 2. cd to the cfgmaker directory ``cd cfgmaker``
 3. Install the npm dependencies ``npm install``
 4. cd to the base directory ``cd ..``
 5. Run docker build ``docker build -t haproxy .``

## Running
### From docker hub
```
docker run --name=<name> -d -p 80:80 \
       -e AWS_REGION=<aws_region> \
       -e APPLY_MODE=<'on' or 'off' defaults to 'on'> \
       -e NAMESPACE_MAP=`cat jsonfile.json` \
       -e REFRESH_RATE=<interval between refreshes in seconds> \
       -e DEFAULT_DOMAIN=<domain unknown hosts are directed to>
       richardjkendall/haproxy
```

### From local copy of image
```
docker run --name=<name> -d -p 80:80 \
       -e AWS_REGION=<aws_region> \
       -e APPLY_MODE=<'on' or 'off' defaults to 'on'> \
       -e NAMESPACE_MAP=`cat jsonfile.json` \
       -e REFRESH_RATE=<internal between refreshes in seconds> \
       -e DEFAULT_DOMAIN=<domain unknown hosts are directed to>
       haproxy
```

## Example
If a container is run with the following environment variables 

|Variable|Value  |
|--|--|
| AWS_REGION | ap-southeast-2 |
| APPLY_MODE | on or off |
| NAMESPACE_MAP | ```{...see below...}``` |
| REFRESH_RATE | 30 |
| DEFAULT_DOMAIN | blank.test.com |
| PROM_PASSWD | blah123 |
| STATS_PASSWD | abcdef |

Where the JSON in NAMESPACE_MAP is
```json
[
  {
    "namespace": "cluster",
    "domainname": "test.com"
    "mode": "host"
  }
]
```

Then the tool will find all the services running in the ``cluster`` namespace in the ``ap-southeast-2`` region and create a rule in the haproxy config to send traffic sent to hosts named ``<service_name>.test.com`` to the instances configured under that service.  This will refresh every ``30`` seconds.

#### Path based routing

The `mode` option can be omitted, and when it is not present 'host' mode is assumed'.  Where it is present it can be set to 'host' or 'path'.  In path mode the routing rules will be set up to route based on paths for example test.com/<service_name>.

Where path based routing is used, you cannot have services with names which conflict with 'stats' or 'metrics'.

The %_PASSWD variables set the following passwords:

* PROM_PASSWD: sets the password for the Prometheus metrics endpoint.  Username is hardcoded to 'stats'
* STATS_PASSWD: sets the password for the HAproxy stats page.  Username is hardcoded to 'stats_user'

### Prometheus Metrics

To access the metrics endpoint, hit any endpoint that haproxy is hosting /metrics e.g. www.example.com/metrics and log in with the username 'stats' and the password set in PROM_PASSWD.

### HAproxy stats page

To access the stats page, hit any endpoint the haproxy is hosting /stats e.g. www.example.com/stats and log in with the username 'stats_user' and the password set in STATS_PASSWD.

### Supported naming conventions
The script which builds the haproxy config supports two naming conventions

1. Plain: e.g. service.namespace.  In this model it would use 'service' as the service name.
2. Extended: e.g. _service._tcp.namespace.  In this model it would use the characters between the first underscore and ._tcp (in this example: service) as the service name

## Health checks
The script exposes a server on port 3000 which can be polled to check the health of the container.  It will either return:

200 okay: the container is up and the config has been created successfully
500 server error: the container is up but there has been 3 or more failures to create the config

This is built into the docker file HEALTHCHECK command, but this is ignored by ECS, so you'll need to include a healthcheck in the task definition.  https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html#container_definition_healthcheck

## AWS Permissions
The following permissions are needed to allow this image to use the AWS Service Discovery API

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ServiceDiscoveryStmt",
      "Action": [
        "servicediscovery:ListInstances",
        "servicediscovery:ListNamespaces",
        "servicediscovery:ListServices"
      ],
      "Effect": "Allow",
      "Resource": "*"
    }
  ]
}
```
