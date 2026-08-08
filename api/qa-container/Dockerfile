# Agentic Tester runner — the Cloudflare Container behind QaRunnerContainerDO.
# Boots a small Node HTTP server (server.mjs) that the DO proxies POST /run to;
# the server drives a real Chromium through a heat-derived exploration plan and
# posts the findings back to the API. Self-contained, no build step (mirrors
# api/container), referenced by `image = "./qa-container/Dockerfile"`.
#
# IMAGE SIZE: the full mcr.microsoft.com/playwright image ships chromium+firefox+
# webkit (~2.76GB) and blows Cloudflare's 2000MB container limit. We only drive
# Chromium, so we start from node-slim and install ONLY chromium + its OS deps —
# keeping the image well under the cap. Cleans apt/npm caches to shrink further.
FROM node:26-bookworm-slim

WORKDIR /app
COPY package.json ./

# Install the playwright client, then only the chromium browser + its system
# libraries (`--with-deps` runs apt-get; needs root). Drop caches afterward.
RUN npm install --no-audit --no-fund \
  && npx playwright install --with-deps chromium \
  && npm cache clean --force \
  && rm -rf /var/lib/apt/lists/* /root/.npm

COPY server.mjs ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.mjs"]
