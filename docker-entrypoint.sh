#!/bin/sh
set -e

# first arg is `-f` or `--some-option`
if [ "${1#-}" != "$1" ]; then
	set -- haproxy "$@"
fi

if [ "$1" = 'haproxy' ]; then
	shift # "haproxy"
	# if the user wants "haproxy", let's add a couple useful flags
	#   -W  -- "master-worker mode" (similar to the old "haproxy-systemd-wrapper"; allows for reload via "SIGUSR2")
	#   -db -- disables background mode
	set -- haproxy -W -db "$@"
fi

# start the cfg maker script using forever 
#./cfgmaker/node_modules/forever/bin/forever /cfgmaker/index.js &
node /cfgmaker/index.js &

# loop until config exists
while ! [ -f /usr/local/etc/haproxy/haproxy.cfg ];
do
	echo "Waiting for config to be generated..."
	sleep 2
done;
echo "Config present.  Starting haproxy..."

exec "$@"