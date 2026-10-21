FROM node:22-bookworm-slim
LABEL org.opencontainers.image.title="Tohyee TV tuner" \
      org.opencontainers.image.source="https://github.com/Willy-nz/Tohyee-TV" \
      org.opencontainers.image.description="Plex-compatible tuner server; browser capture runs separately on the Linux host"
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg tini ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data && chown node:node /data
WORKDIR /app
COPY --chown=node:node tuner/ ./tuner/
COPY --chown=node:node docker/healthcheck.mjs ./docker/healthcheck.mjs
ENV XDG_CONFIG_HOME=/data
USER node
VOLUME ["/data"]
EXPOSE 34500
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "docker/healthcheck.mjs"]
ENTRYPOINT ["/usr/bin/tini", "--", "node", "tuner/src/main.js"]
