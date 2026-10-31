# syntax=docker/dockerfile:1
# The run SANDBOX: the Cloudflare Container a cloud run's shell and working tree live in.
# Boots a small Node HTTP server (server.mjs) that AgentContainerDO proxies `/sandbox/*` to.
# The Worker's one engine calls it; it runs no loop. Includes git + bash so a run gets a
# REAL shell to clone the repo and run builds / type-checks / lint / tests (run_command).

FROM node:24-bookworm-slim

# git for cloning the ticket repo; ca-certificates for HTTPS to GitHub and package registries.
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends git ca-certificates bash \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY server.mjs ./
# THE sandbox primitives (shell, working tree, post-edit checks) — the same module the
# GitHub Actions runner inlines (via the generated sandboxCoreSource.ts), so both
# transports serve one implementation.
COPY sandboxCore.mjs ./
# THE tool-output policy (@builderforce/tool-output-policy), compiled by
# api/scripts/gen-container-shared.mjs, the post-edit fast checks (D7 / D1) and the
# background-job table (`run_command` background / `command_status`).
COPY toolOutputPolicy.mjs postEditChecks.mjs sandboxJobs.mjs ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Run as the unprivileged node user (image ships uid 1000) to shrink the blast radius
# of arbitrary build commands the agent may run.
USER node

CMD ["node", "server.mjs"]
