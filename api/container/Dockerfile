# Long-lived Cloudflare Container for a "V2 Cloud Agent (Node/Container)" run.
# Boots a small Node HTTP server (server.mjs) that AgentContainerDO proxies /run to.
# Includes git + bash so the agent has a REAL shell to clone the repo and run
# builds/type-checks/lint/tests (run_command) before finishing.
FROM node:22-bookworm-slim

# git for cloning the ticket repo; ca-certificates for HTTPS to the gateway/GitHub.
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends git ca-certificates bash \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY server.mjs ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Run as the unprivileged node user (image ships uid 1000) to shrink the blast radius
# of arbitrary build commands the agent may run.
USER node

CMD ["node", "server.mjs"]
