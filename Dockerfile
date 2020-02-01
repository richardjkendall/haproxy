FROM haproxy:2.1.1

# install psmisc
RUN apt-get update
RUN apt-get install -y psmisc

# install nodejs
RUN apt-get install -y curl gnupg
RUN curl -sL https://deb.nodesource.com/setup_12.x | bash -
RUN apt-get install -y nodejs build-essential

# install curl
RUN apt-get install -y curl

# install cfgmaker script
RUN mkdir -p /cfgmaker
COPY cfgmaker/ /cfgmaker/
RUN cd /cfgmaker; npm ci

# add health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD curl --fail http://localhost:3000/ || exit 1

# replace entrypoint script
COPY docker-entrypoint.sh /
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["haproxy", "-f", "/usr/local/etc/haproxy/haproxy.cfg"]
