# Agentic Tester — containerised heatmap-driven browser exploration.
#
# Runs the explorer (npm run explore): claim a queued exploration, drive a real
# Chromium through its heat-derived plan, capture runtime errors, and feed them
# back to the API. The Playwright base image ships the browser + system deps, so
# the container is self-contained — give it the BF_* env and run it anywhere.
#
#   docker build -t builderforce/agentic-tester ./qa-e2e
#   docker run --rm \
#     -e BF_API_URL=https://api.builderforce.ai \
#     -e BF_BASE_URL=https://builderforce.ai \
#     -e BF_QA_EMAIL=... -e BF_QA_PASSWORD=... -e BF_QA_TENANT_ID=... \
#     -e BF_PROJECT_ID=...        # optional: claim a project's queued run \
#     -e BF_EXPLORATION_ID=...    # optional: claim a specific run \
#     builderforce/agentic-tester
#
# Pin the image tag to the @playwright/test version in package.json.
FROM mcr.microsoft.com/playwright:v1.58.2-jammy

WORKDIR /app

# Install deps first for layer caching (browsers already live in the base image).
COPY package.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src

# The explorer is a long-lived one-shot: it claims one exploration, runs it, and
# exits. A scheduler (CI cron, k8s Job, builderforce orchestrator) runs it on a
# cadence; each invocation drains one queued exploration.
ENV CI=1
CMD ["npm", "run", "explore"]
