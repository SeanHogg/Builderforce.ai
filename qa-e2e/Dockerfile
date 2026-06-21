# Agentic Tester — containerised browser-exploration RUNNER (the execution
# surface of the QA agent, not the product itself).
#
# The PRODUCT side — configuring a project's target + personas, ranking what to
# test from usage heatmaps, and SCHEDULING runs — lives in the platform
# (Observability ▸ Agentic QA + the qa_schedules cron sweep). This image is just
# a stateless worker that drains the queue: claim one exploration, drive Chromium
# through its heat-derived plan, capture runtime errors, post findings, exit.
#
# AUTH: in production the platform injects a short-lived tenant-scoped token via
# BF_AGENT_TOKEN — NO human email/password. BF_QA_EMAIL/PASSWORD is only a
# local-dev convenience.
#
#   docker run --rm \
#     -e BF_API_URL=https://api.builderforce.ai \
#     -e BF_AGENT_TOKEN=<platform-minted tenant token> \
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

# One-shot worker: claims one exploration, runs it, exits. The platform's
# qa_schedules sweep enqueues the work; this container is dispatched to drain it
# (managed Cloudflare Container surface — see ROADMAP — or any container host).
ENV CI=1
CMD ["npm", "run", "explore"]
