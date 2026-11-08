# syntax=docker/dockerfile:1
# The run SANDBOX: the Cloudflare Container a cloud run's shell and working tree live in.
# Boots a small Node HTTP server (server.mjs) that AgentContainerDO proxies `/sandbox/*` to.
# The Worker's one engine calls it; it runs no loop. Includes git + bash so a run gets a
# REAL shell to clone the repo and run builds / type-checks / lint / tests (run_command).

FROM node:24-bookworm-slim

# git for cloning the ticket repo; ca-certificates for HTTPS to GitHub and package registries.
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends git ca-certificates bash sudo \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY server.mjs ./
# THE sandbox primitives (shell, working tree, post-edit checks) — the same module the
# GitHub Actions runner inlines (via the generated sandboxCoreSource.ts), so both
# transports serve one implementation.
COPY sandboxCore.mjs ./
# Trusts the platform egress-interception CA for spawned tools (see egressTrust.mjs).
COPY egressTrust.mjs ./
# THE tool-output policy (@builderforce/tool-output-policy), compiled by
# api/scripts/gen-container-shared.mjs, the post-edit fast checks (D7 / D1) and the
# background-job table (`run_command` background / `command_status`).
COPY toolOutputPolicy.mjs postEditChecks.mjs sandboxJobs.mjs workspaceClient.mjs sandboxGit.mjs ./
# The workspace helper: the one process that touches the working tree, run as the shell user.
COPY workspaceAgent.mjs ./

ENV NODE_ENV=production
ENV PORT=8080
# Node reads NODE_EXTRA_CA_CERTS once, at process start, so it must be an image ENV for
# server.mjs itself (and everything it spawns) to trust the egress-interception CA. A path
# that does not exist (enforcement off) only produces a startup warning.
ENV NODE_EXTRA_CA_CERTS=/etc/cloudflare/certs/cloudflare-containers-ca.crt
EXPOSE 8080

# THE uid split. The server (user `node`, uid 1000) holds the run token in its memory and environ;
# every shell the model can influence (run_command, background jobs, the preview dev server) runs as a
# DIFFERENT unprivileged user, `bfagent`, so it can read neither /proc/<server pid>/environ nor
# /proc/<server pid>/mem. `bfagent` has its OWN group (never `node`'s) and no sudo rights, and owns the workspace
# root (/workspaces); `node` may sudo to `bfagent` and to nothing else (no root). The server never touches a
# workspace: workspaceAgent.mjs does, as `bfagent`. sandboxJobs.mjs builds the
# `sudo -n -u bfagent env -i … bash -lc …` spawn; `!use_pty` keeps the shell in a process group the kill can reach.
RUN useradd --create-home --shell /bin/bash --user-group bfagent \
  && install -d -o bfagent -g bfagent -m 0755 /workspaces \
  && printf 'node ALL=(bfagent) NOPASSWD: ALL\nDefaults:node !use_pty\n' > /etc/sudoers.d/zz-bf-agent \
  && chmod 0440 /etc/sudoers.d/zz-bf-agent \
  && visudo -cf /etc/sudoers.d/zz-bf-agent
ENV BUILDERFORCE_SHELL_USER=bfagent
ENV BUILDERFORCE_WORKSPACE_ROOT=/workspaces

# The server itself still runs as the unprivileged node user (never root).
USER node

CMD ["node", "server.mjs"]
