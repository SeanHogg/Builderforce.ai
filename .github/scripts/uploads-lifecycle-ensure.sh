#!/usr/bin/env bash
# Idempotent: ensure the object-lifecycle rules in infra/uploads/lifecycle.json exist on the
# R2 bucket `builderforce-uploads` (the API Worker's UPLOADS binding).
#
# Today: `run-delta-evidence-730d` deletes run-delta evidence blobs (`run-deltas/<tenant>/<digest>.json`,
# PRD 41 §C14) 730 days after upload. That equals the `run_deltas` row retention (sweptTablesBounded.ts
# RUN_DELTA_RETENTION_DAYS) and a blob is written before its row, so a stored row never outlives its blob.
#
# MERGE, never replace: the bucket's other lifecycle rules (set elsewhere) are kept. The rules of
# the file are matched by `id` and replace a same-id rule; everything else is left as it is.
#
#   DRY_RUN=1 bash .github/scripts/uploads-lifecycle-ensure.sh
#   bash .github/scripts/uploads-lifecycle-ensure.sh --dry-run
#
# Env: CLOUDFLARE_API_TOKEN (R2 edit; required unless --dry-run), CLOUDFLARE_ACCOUNT_ID (or CF_ACCOUNT_ID),
#      UPLOADS_R2_BUCKET (default builderforce-uploads), UPLOADS_LIFECYCLE_FILE (default infra/uploads/lifecycle.json).
set -euo pipefail

DRY=0
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY=1 ;;
    *) echo "uploads-lifecycle-ensure: unknown argument: $arg" >&2; exit 2 ;;
  esac
done
if [[ "${DRY_RUN:-}" == "1" ]]; then DRY=1; fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUCKET="${UPLOADS_R2_BUCKET:-builderforce-uploads}"
FILE="${UPLOADS_LIFECYCLE_FILE:-${ROOT}/infra/uploads/lifecycle.json}"
ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-${CF_ACCOUNT_ID:-}}"
TOKEN="${CLOUDFLARE_API_TOKEN:-${CF_API_TOKEN:-}}"
API="https://api.cloudflare.com/client/v4"

command -v jq >/dev/null || { echo "uploads-lifecycle-ensure: jq is required (preinstalled on GitHub runners)" >&2; exit 1; }
jq -e '.rules | type == "array" and length > 0 and all(.id | type == "string")' "$FILE" >/dev/null \
  || { echo "uploads-lifecycle-ensure: ${FILE} must hold a non-empty rules[] with string ids" >&2; exit 1; }

if [[ "$DRY" == "1" ]]; then
  echo "uploads-lifecycle-ensure DRY_RUN bucket=${BUCKET}"
  echo "GET ${API}/accounts/\$ACCOUNT_ID/r2/buckets/${BUCKET}/lifecycle"
  echo "PUT ${API}/accounts/\$ACCOUNT_ID/r2/buckets/${BUCKET}/lifecycle  (existing rules merged by id with ${FILE})"
  jq -c '.rules[] | {id, prefix: .conditions.prefix, maxAgeSeconds: .deleteObjectsTransition.condition.maxAge}' "$FILE"
  exit 0
fi

if [[ -z "$ACCOUNT_ID" || -z "$TOKEN" ]]; then
  echo "uploads-lifecycle-ensure: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required" >&2
  exit 1
fi

URL="${API}/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/lifecycle"
CURRENT="$(curl -sS -H "Authorization: Bearer ${TOKEN}" "$URL")"
if [[ "$(jq -r '.success' <<<"$CURRENT" 2>/dev/null)" != "true" ]]; then
  echo "uploads-lifecycle-ensure: GET lifecycle failed (the token needs Workers R2 Storage: Edit):" >&2
  jq -c '.errors' <<<"$CURRENT" >&2 || echo "$CURRENT" >&2
  exit 1
fi
# The merge keeps the bucket's OTHER rules only if it can see them: a GET whose body does not hold a
# `result.rules` array (an API change, a truncated body) must never become a PUT that wipes them.
if ! jq -e '.result | type == "object" and has("rules") and (.rules | type == "array")' <<<"$CURRENT" >/dev/null; then
  echo "uploads-lifecycle-ensure: GET lifecycle answered without a result.rules array; refusing to PUT (it would replace rules it cannot see)" >&2
  exit 1
fi

MERGED="$(jq -c --slurpfile want "$FILE" '
  ($want[0].rules | map(.id)) as $ids
  | { rules: ((.result.rules | map(select(.id as $id | $ids | index($id) | not))) + $want[0].rules) }
' <<<"$CURRENT")"

if [[ "$(jq -S -c '.result.rules | sort_by(.id)' <<<"$CURRENT")" == "$(jq -S -c '.rules | sort_by(.id)' <<<"$MERGED")" ]]; then
  echo "uploads-lifecycle-ensure: ${BUCKET} lifecycle already current"
  exit 0
fi

RESULT="$(curl -sS -X PUT -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" --data "$MERGED" "$URL")"
if [[ "$(jq -r '.success' <<<"$RESULT")" != "true" ]]; then
  echo "uploads-lifecycle-ensure: PUT lifecycle failed:" >&2
  jq -c '.errors' <<<"$RESULT" >&2 || echo "$RESULT" >&2
  exit 1
fi
echo "uploads-lifecycle-ensure: ${BUCKET} lifecycle set ($(jq -r '.rules | map(.id) | join(", ")' <<<"$MERGED"))"
