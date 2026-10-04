#!/usr/bin/env bash
# WRANGLER_DOCKER_BIN shim: gives wrangler's container image builds a layer cache.
#
# `wrangler deploy` builds every [[containers]] image in api/wrangler.toml and pushes it
# under a tag named for the new Worker version, so every deploy pushes every image. On a
# fresh runner nothing is cached, so the `npm install` / `playwright install` layers are
# rebuilt with new digests and the registry has to take each one again — ~70–100s of
# upload per image, ~5 minutes of every API deploy.
#
# Restoring the layers from the GitHub Actions cache makes an unchanged layer the SAME
# blob, and the registry answers "Layer already exists" instead of taking the upload.
#
# Wrangler runs `<bin> build --load -t <name>:<tag> --platform … -f - <context>` with the
# Dockerfile on stdin; that call gains --cache-from/--cache-to scoped to the image name.
# Every other docker call (info, push, login, inspect) passes straight through. Needs a
# buildx builder that can export to `type=gha` (docker/setup-buildx-action) and the
# Actions runtime env in the step (crazy-max/ghaction-github-runtime).
set -euo pipefail

if [ "${1:-}" != "build" ]; then
  exec docker "$@"
fi
shift

tag=""
previous=""
for arg in "$@"; do
  if [ "$previous" = "-t" ]; then tag="$arg"; fi
  previous="$arg"
done
scope="${tag%%:*}"
scope="${scope##*/}"

# ignore-error: a cache that cannot be written costs the next deploy time, never this one.
exec docker buildx build \
  --cache-from "type=gha,scope=container-${scope}" \
  --cache-to "type=gha,mode=min,scope=container-${scope},ignore-error=true" \
  "$@"
