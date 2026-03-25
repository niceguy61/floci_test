FROM node:22-alpine

RUN apk add --no-cache aws-cli

WORKDIR /workspace

COPY ops/monitoring/exporter/server.mjs /workspace/ops/monitoring/exporter/server.mjs

EXPOSE 9464

CMD ["node", "/workspace/ops/monitoring/exporter/server.mjs"]
