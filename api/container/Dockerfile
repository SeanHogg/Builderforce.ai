# syntax=docker/dockerfile:1
# Long-lived Cloudflare Container for a "Cloud Agent (Node/Container)" run.
# Boots a small Node HTTP server (server.mjs) that AgentContainerDO proxies /run to.
# Includes git + bash so the agent has a REAL shell to clone the repo and run
# builds/type-checks/lint/tests (run_command) before finishing.

# ── Stage 1: bf-context (PRD C5, the cloud repo map) ──────────────────────────────
# The SAME binary Builderforce Desktop runs: bf-index's PageRank repo map and keyword
# search over the run's clone (`repoIndex.mjs`). Built from builderforce-inference at a
# PINNED commit, so a rebuild of this image never picks up an unreviewed ranker.
# `--no-default-features` drops the embeddings (no ONNX runtime, no model download on
# first use) and LLMLingua compression; search runs in keyword + structure mode.
# The repo is fetched anonymously; for a private mirror pass a token as a BuildKit
# secret: `docker build --secret id=github_token,env=GITHUB_TOKEN …`.
FROM rust:1-bookworm AS bf-context
ARG BF_INFERENCE_REPO=https://github.com/SeanHogg/builderforce-inference.git
ARG BF_INFERENCE_COMMIT=174566a61b716825e9cbb871bdbdba2341f5cb9d
WORKDIR /src
RUN --mount=type=secret,id=github_token \
  set -eu; \
  url="$BF_INFERENCE_REPO"; \
  if [ -s /run/secrets/github_token ]; then \
    url="$(printf '%s' "$url" | sed "s#https://#https://x-access-token:$(cat /run/secrets/github_token)@#")"; \
  fi; \
  git init -q . \
  && git remote add origin "$url" \
  && git fetch -q --depth 1 origin "$BF_INFERENCE_COMMIT" \
  && git checkout -q FETCH_HEAD \
  && git remote remove origin
RUN --mount=type=cache,target=/usr/local/cargo/registry \
  cargo build --release --locked -p bf-context --no-default-features \
  && strip target/release/bf-context

# ── Stage 2: the runtime image ────────────────────────────────────────────────────
FROM node:24-bookworm-slim

# git for cloning the ticket repo; ca-certificates for HTTPS to the gateway/GitHub.
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends git ca-certificates bash \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Only the binary crosses over — no toolchain, no sources. Same Debian release as the
# builder, so the glibc it links is the one it runs on.
COPY --from=bf-context /src/target/release/bf-context /usr/local/bin/bf-context

WORKDIR /app
COPY package.json ./
COPY server.mjs ./
# The shared Worker-relay dispatch table, imported by server.mjs. The GitHub Actions
# runner inlines this SAME file (via the generated agentRelaySource.ts), so both image
# surfaces execute one implementation rather than two transcriptions of it.
COPY agentRelay.mjs ./
COPY codeAnalysis.mjs ./
# THE agent loop: the shared kernel (@builderforce/agent-loop, compiled into agentLoop.mjs
# by api/scripts/gen-agent-loop-bundle.mjs, drift-checked by check:agent-loop) and the
# image semantics on its hooks. The Actions runner inlines the SAME two files.
COPY agentLoop.mjs agentImageLoop.mjs ./
# THE tool-output policy (@builderforce/tool-output-policy), THE edit_file core
# (packages/agent-tools/src/edit.ts), THE read_file line window
# (packages/agent-tools/src/fileWindow.ts) and THE repo_map / semantic_search definitions
# (packages/agent-tools/src/semantic-tools.ts) and THE read-only tool table (D8,
# api/src/application/runtime/costLoop/readOnlyTools.ts), compiled by api/scripts/gen-container-shared.mjs.
COPY toolOutputPolicy.mjs stringEdit.mjs fileWindow.mjs semanticTools.mjs readOnlyTools.mjs ./
# The image-local services over the clone: the bf-context repo index (C5) and the
# post-edit fast checks (D7).
COPY repoIndex.mjs postEditChecks.mjs ./

ENV NODE_ENV=production
ENV PORT=8080
ENV BF_CONTEXT_BIN=/usr/local/bin/bf-context
EXPOSE 8080

# Run as the unprivileged node user (image ships uid 1000) to shrink the blast radius
# of arbitrary build commands the agent may run.
USER node

CMD ["node", "server.mjs"]
