#!/usr/bin/env bash
# Idempotent: ensure the R2 bucket, cdn.builderforce.ai custom domain, and a
# no-Worker route for cdn.builderforce.ai/* exist. DRY_RUN=1 prints the calls.
set -euo pipefail

ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-${CF_ACCOUNT_ID:-}}"
ZONE_ID="${CLOUDFLARE_ZONE_ID:-}"
TOKEN="${CLOUDFLARE_API_TOKEN:-${CF_API_TOKEN:-}}"
BUCKET="${CDN_R2_BUCKET:-builderforce-cdn}"
DOMAIN="${CDN_DOMAIN:-cdn.builderforce.ai}"
API="https://api.cloudflare.com/client/v4"

if [[ "${DRY_RUN:-}" == "1" ]]; then
  echo "cdn-ensure DRY_RUN bucket=${BUCKET} domain=${DOMAIN}"
  echo "PUT ${API}/accounts/\$ACCOUNT_ID/r2/buckets/${BUCKET}"
  echo "PUT ${API}/accounts/\$ACCOUNT_ID/r2/buckets/${BUCKET}/domains/custom"
  echo "POST ${API}/zones/\$ZONE_ID/workers/routes  pattern=${DOMAIN}/*  (no script)"
  exit 0
fi

if [[ -z "$ACCOUNT_ID" || -z "$TOKEN" ]]; then
  echo "cdn-ensure: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required" >&2
  exit 1
fi

auth=(-H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json")

# Bucket — 409 already-exists is success.
code=$(curl -sS -o /tmp/cdn-ensure-bucket.json -w "%{http_code}" \
  "${auth[@]}" -X POST "${API}/accounts/${ACCOUNT_ID}/r2/buckets" \
  --data "{\"name\":\"${BUCKET}\"}")
if [[ "$code" != "200" && "$code" != "409" ]]; then
  echo "cdn-ensure: create bucket failed HTTP ${code}" >&2
  cat /tmp/cdn-ensure-bucket.json >&2 || true
  exit 1
fi

# Custom domain on the bucket (public CDN hostname).
if [[ -n "$ZONE_ID" ]]; then
  curl -sS "${auth[@]}" -X PUT \
    "${API}/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/domains/custom" \
    --data "{\"domain\":\"${DOMAIN}\",\"zoneId\":\"${ZONE_ID}\",\"enabled\":true}" \
    >/tmp/cdn-ensure-domain.json || true

  # No-Worker route so cdn.builderforce.ai/* is not stolen by the API worker.
  curl -sS "${auth[@]}" -X POST \
    "${API}/zones/${ZONE_ID}/workers/routes" \
    --data "{\"pattern\":\"${DOMAIN}/*\",\"script\":null}" \
    >/tmp/cdn-ensure-route.json || true
fi

echo "cdn-ensure: bucket=${BUCKET} domain=${DOMAIN} ok"
