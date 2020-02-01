FROM haproxy:2.1.1

# install psmisc
RUN apt-get update
RUN apt-get install -y psmisc

# install nodejs
RUN apt-get install -y curl gnupg
RUN curl -sL https://deb.nodesource.com/setup_11.x | bash -
RUN apt-get install -y nodejs build-essential

# install and build cfgmaker script
RUN mkdir -p /cfgmaker
COPY cfgmaker/ /cfgmaker/
RUN cd /cfgmaker; npm ci

# replace entrypoint script
COPY docker-entrypoint.sh /
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["haproxy", "-f", "/usr/local/etc/haproxy/haproxy.cfg"]
