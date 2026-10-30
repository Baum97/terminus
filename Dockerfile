# Terminus-Server: Web-App, KI-Weiterleitung und Abo-Links. Optional – die App läuft auch ohne.
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY proxy ./proxy
COPY www ./www
COPY scripts ./scripts
RUN node scripts/ferien.mjs || echo "Schulferien nicht geladen"
ENV PORT=8080 ABO_DIR=/data/abo
RUN mkdir -p /data/abo && chown -R node /data
VOLUME /data
EXPOSE 8080
USER node
CMD ["node", "proxy/server.mjs"]
