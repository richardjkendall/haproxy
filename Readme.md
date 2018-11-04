# haproxy + AWS Service Discovery
This is a Docker image automatically configures haproxy using information retrieved from the AWS Service Discovery API.

It is based on the ``haproxy:1.7`` base image.

Exposes service on 80/tcp.

Polls for changes every 10 seconds and reloads haproxy with signal SIGUSR2 each time a new config is detected.

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
       -e NAMESPACES=<comma separated list of namespaces> \
       -e DOMAIN_NAME=<base domain name> \
       -e DEFAULT_DOMAIN=<domain unknown hosts are directed to>
       richardjkendall/haproxy
```

### From local copy of image
```
docker run --name=<name> -d -p 80:80 \
       -e AWS_REGION=<aws_region> \
       -e NAMESPACES=<comma separated list of namespaces> \
       -e DOMAIN_NAME=<base domain name> \
       -e DEFAULT_DOMAIN=<domain unknown hosts are directed to>
       haproxy
```

## Example
If a container is run with the following environment variables 

|Variable|Value  |
|--|--|
| AWS_REGION | ap-southeast-2 |
| NAMESPACES | cluster |
| DOMAIN_NAME | test.com |
| DEFAULT_DOMAIN | blank.test.com |

Then the tool will find all the services running in the ``cluster`` namespace in the ``ap-southeast-2`` region and create a rule in the haproxy config to send traffic sent to hosts named ``<service_name>.test.com`` to the instances configured under that service.

## AWS Permissions
The following permissions are needed to allow this image to use the AWS Service Discovery API

```
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
