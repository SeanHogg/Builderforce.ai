#!/usr/bin/env bash
# Upload dist/cdn/* to the R2 bucket with cache-control:
#   hashed /replay/r/*  → immutable, 1 year
#   loader / manifest   → 5 minutes (so a new recorder is picked up)
# DRY_RUN=1 prints the wrangler puts without executing.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="${CDN_SRC:-${ROOT}/replay-sdk/dist/cdn}"
BUCKET="${CDN_R2_BUCKET:-builderforce-cdn}"

if [[ ! -d "$SRC" ]]; then
  echo "cdn-publish: missing ${SRC} — build replay-sdk first" >&2
  exit 1
fi

put() {
  local key="$1"
  local file="$2"
  local cache="$3"
  local type="$4"
  if [[ "${DRY_RUN:-}" == "1" ]]; then
    echo "wrangler r2 object put ${BUCKET}/${key} --file=${file} --cache-control=${cache} --content-type=${type}"
    return
  fi
  npx wrangler r2 object put "${BUCKET}/${key}" \
    --file="$file" \
    --content-type="$type" \
    --cache-control="$cache" \
    --remote
}

while IFS= read -r -d '' file; do
  rel="${file#"$SRC"/}"
  key="${rel//\\//}"
  case "$key" in
    replay/r/*)
      cache="public, max-age=31536000, immutable"
      ;;
    *)
      cache="public, max-age=300"
      ;;
  esac
  case "$file" in
    *.js) type="application/javascript; charset=utf-8" ;;
    *.json) type="application/json; charset=utf-8" ;;
    *) type="application/octet-stream" ;;
  esac
  put "$key" "$file" "$cache" "$type"
done < <(find "$SRC" -type f -print0)

echo "cdn-publish: uploaded ${SRC} → r2://${BUCKET}"
