#!/usr/bin/env bash
# Idempotent: ensure the R2 bucket `builderforce-cdn`, the custom domain
# `cdn.builderforce.ai`, a no-Worker route for `cdn.builderforce.ai/*`, and a
# GET-from-* CORS policy exist. Uses CLOUDFLARE_API_TOKEN.
#
#   DRY_RUN=1 bash .github/scripts/cdn-ensure.sh
#   bash .github/scripts/cdn-ensure.sh --dry-run
#
# A 409 / already-exists response is success. Permission errors name the
# missing Cloudflare grant so the operator can extend the token.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: cdn-ensure.sh [--dry-run]

Idempotently create:
  1. R2 bucket builderforce-cdn
  2. Custom domain cdn.builderforce.ai on that bucket
  3. Workers route cdn.builderforce.ai/* with no script (so the sites
     Worker cannot steal the host)
  4. CORS: GET, HEAD from *

Env: CLOUDFLARE_API_TOKEN (required unless --dry-run)
     CLOUDFLARE_ACCOUNT_ID (or CF_ACCOUNT_ID)
     CLOUDFLARE_ZONE_ID   (optional; looked up from CDN_ZONE_NAME)
     CDN_R2_BUCKET        (default builderforce-cdn)
     CDN_DOMAIN           (default cdn.builderforce.ai)
     CDN_ZONE_NAME        (default builderforce.ai)
     DRY_RUN=1            (same as --dry-run)
EOF
}

DRY=0
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY=1 ;;
    --help|-h) usage; exit 0 ;;
    *)
      echo "cdn-ensure: unknown argument: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done
if [[ "${DRY_RUN:-}" == "1" ]]; then DRY=1; fi

ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-${CF_ACCOUNT_ID:-}}"
ZONE_ID="${CLOUDFLARE_ZONE_ID:-}"
TOKEN="${CLOUDFLARE_API_TOKEN:-${CF_API_TOKEN:-}}"
BUCKET="${CDN_R2_BUCKET:-builderforce-cdn}"
DOMAIN="${CDN_DOMAIN:-cdn.builderforce.ai}"
ZONE_NAME="${CDN_ZONE_NAME:-builderforce.ai}"
API="https://api.cloudflare.com/client/v4"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CORS_FILE="${CDN_CORS_FILE:-${ROOT}/infra/cdn/cors.json}"

if [[ "$DRY" == "1" ]]; then
  echo "cdn-ensure DRY_RUN bucket=${BUCKET} domain=${DOMAIN} zone=${ZONE_NAME}"
  echo "wrangler r2 bucket create ${BUCKET}"
  echo "wrangler r2 bucket domain add ${BUCKET} --domain ${DOMAIN} --zone-id \${CLOUDFLARE_ZONE_ID}"
  echo "POST ${API}/zones/\$ZONE_ID/workers/routes  {\"pattern\":\"${DOMAIN}/*\"}  (no script)"
  echo "wrangler r2 bucket cors set ${BUCKET} --file ${CORS_FILE}"
  echo "PUT ${API}/accounts/\$ACCOUNT_ID/r2/buckets/${BUCKET}/cors  GET,HEAD from *"
  exit 0
fi

if [[ -z "$ACCOUNT_ID" || -z "$TOKEN" ]]; then
  echo "cdn-ensure: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required" >&2
  exit 1
fi

TMPDIR_ENSURE="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_ENSURE"' EXIT

# Print the Cloudflare error body and, when it looks like a grant issue, name
# the permissions the operator must add to CLOUDFLARE_API_TOKEN.
fail_cf() {
  local action="$1"
  local code="$2"
  local body_file="$3"
  local body=""
  body="$(cat "$body_file" 2>/dev/null || true)"
  echo "cdn-ensure: ${action} failed HTTP ${code}" >&2
  if [[ -n "$body" ]]; then
    echo "$body" >&2
  fi
  if echo "$body" | grep -qiE 'permission|authenticat|access denied|unauthorized|forbidden|10000'; then
    echo "cdn-ensure: extend CLOUDFLARE_API_TOKEN with Account.R2 Edit, Zone.DNS Edit, and Zone.Workers Routes Edit" >&2
  fi
  exit 1
}

# cf METHOD url [json-body]  → writes body to $CF_BODY, sets $CF_CODE
cf() {
  local method="$1"
  local url="$2"
  local data="${3:-}"
  local out="${TMPDIR_ENSURE}/last.json"
  local args=(-sS -o "$out" -w "%{http_code}" -X "$method"
    -H "Authorization: Bearer ${TOKEN}"
    -H "Content-Type: application/json")
  if [[ -n "$data" ]]; then
    args+=(--data "$data")
  fi
  CF_CODE="$(curl "${args[@]}" "$url")"
  CF_BODY="$out"
}

ok_or_exists() {
  local code="$1"
  [[ "$code" == "200" || "$code" == "201" || "$code" == "409" || "$code" == "204" ]]
}

# --- 1. Bucket --------------------------------------------------------------
cf GET "${API}/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}"
if [[ "$CF_CODE" == "404" ]]; then
  cf POST "${API}/accounts/${ACCOUNT_ID}/r2/buckets" "{\"name\":\"${BUCKET}\"}"
  if ! ok_or_exists "$CF_CODE"; then
    fail_cf "create bucket ${BUCKET}" "$CF_CODE" "$CF_BODY"
  fi
  echo "cdn-ensure: created bucket ${BUCKET}"
elif [[ "$CF_CODE" == "200" ]]; then
  echo "cdn-ensure: bucket ${BUCKET} exists"
else
  fail_cf "get bucket ${BUCKET}" "$CF_CODE" "$CF_BODY"
fi

# --- zone id (custom domain + no-Worker route) ------------------------------
if [[ -z "$ZONE_ID" ]]; then
  cf GET "${API}/zones?name=${ZONE_NAME}"
  if [[ "$CF_CODE" != "200" ]]; then
    fail_cf "lookup zone ${ZONE_NAME}" "$CF_CODE" "$CF_BODY"
  fi
  ZONE_ID="$(node -e '
    const fs = require("fs");
    const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write((j.result && j.result[0] && j.result[0].id) || "");
  ' "$CF_BODY" 2>/dev/null || true)"
  if [[ -z "$ZONE_ID" ]]; then
    ZONE_ID="$(grep -oE '"id":"[a-f0-9]{32}"' "$CF_BODY" | head -1 | cut -d'"' -f4 || true)"
  fi
  if [[ -z "$ZONE_ID" ]]; then
    echo "cdn-ensure: could not resolve zone id for ${ZONE_NAME}; set CLOUDFLARE_ZONE_ID" >&2
    exit 1
  fi
  echo "cdn-ensure: zone ${ZONE_NAME} → ${ZONE_ID}"
fi

# --- 2. Custom domain on the bucket -----------------------------------------
cf GET "${API}/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/domains/custom"
DOMAIN_LIST_CODE="$CF_CODE"
DOMAIN_LIST_BODY="$CF_BODY"
HAS_DOMAIN=0
if [[ "$DOMAIN_LIST_CODE" == "200" ]] && grep -qF "\"${DOMAIN}\"" "$DOMAIN_LIST_BODY"; then
  HAS_DOMAIN=1
fi
if [[ "$HAS_DOMAIN" == "1" ]]; then
  echo "cdn-ensure: custom domain ${DOMAIN} already attached"
else
  cf POST "${API}/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/domains/custom" \
    "{\"domain\":\"${DOMAIN}\",\"zoneId\":\"${ZONE_ID}\",\"enabled\":true}"
  if ! ok_or_exists "$CF_CODE"; then
    # Some accounts only accept PUT for this resource.
    if [[ "$CF_CODE" == "405" || "$CF_CODE" == "400" ]]; then
      cf PUT "${API}/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/domains/custom" \
        "{\"domain\":\"${DOMAIN}\",\"zoneId\":\"${ZONE_ID}\",\"enabled\":true}"
    fi
  fi
  if ! ok_or_exists "$CF_CODE"; then
    fail_cf "attach custom domain ${DOMAIN}" "$CF_CODE" "$CF_BODY"
  fi
  echo "cdn-ensure: attached custom domain ${DOMAIN}"
fi

# --- 3. No-Worker route so *.builderforce.ai/* cannot steal the host --------
cf GET "${API}/zones/${ZONE_ID}/workers/routes"
if [[ "$CF_CODE" != "200" ]]; then
  fail_cf "list workers routes" "$CF_CODE" "$CF_BODY"
fi
if grep -qF "\"${DOMAIN}/*\"" "$CF_BODY"; then
  echo "cdn-ensure: workers route ${DOMAIN}/* already present"
else
  # `script: null` is the documented no-Worker route (dashboard: Disabled).
  # Some accounts reject null and accept an omitted script instead.
  cf POST "${API}/zones/${ZONE_ID}/workers/routes" \
    "{\"pattern\":\"${DOMAIN}/*\",\"script\":null}"
  if ! ok_or_exists "$CF_CODE"; then
    cf POST "${API}/zones/${ZONE_ID}/workers/routes" \
      "{\"pattern\":\"${DOMAIN}/*\"}"
  fi
  if ! ok_or_exists "$CF_CODE"; then
    fail_cf "create no-Worker route ${DOMAIN}/*" "$CF_CODE" "$CF_BODY"
  fi
  echo "cdn-ensure: created no-Worker route ${DOMAIN}/*"
fi

# --- 4. CORS: GET, HEAD from * ----------------------------------------------
if [[ ! -f "$CORS_FILE" ]]; then
  echo "cdn-ensure: missing CORS file ${CORS_FILE}" >&2
  exit 1
fi
CORS_JSON="$(cat "$CORS_FILE")"
cf PUT "${API}/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/cors" "$CORS_JSON"
if ! ok_or_exists "$CF_CODE"; then
  fail_cf "set CORS on ${BUCKET}" "$CF_CODE" "$CF_BODY"
fi
echo "cdn-ensure: CORS GET,HEAD from * on ${BUCKET}"

echo "cdn-ensure: bucket=${BUCKET} domain=${DOMAIN} ok"
