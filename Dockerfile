FROM haproxy:1.7

# install psmisc
RUN apt-get update
RUN apt-get install -y psmisc

# install nodejs
RUN apt-get install -y curl gnupg
RUN curl -sL https://deb.nodesource.com/setup_11.x | bash -
RUN apt-get install -y nodejs

# install cfgmaker script
RUN mkdir -p /cfgmaker
COPY cfgmaker/ /cfgmaker/

# replace entrypoint script
COPY docker-entrypoint.sh /
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["haproxy", "-f", "/usr/local/etc/haproxy/haproxy.cfg"]