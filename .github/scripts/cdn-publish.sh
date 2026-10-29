#!/usr/bin/env bash
# Upload replay-sdk CDN assets to R2 with per-path Cache-Control.
#
#   hashed  /replay/r/*           → public, max-age=31536000, immutable
#   loader  /replay/v1/loader.js  → public, max-age=300
#   embed   /embed/v1.js          → public, max-age=300
#   manifest /replay/manifest.json → public, max-age=60
#
# Hashed objects are uploaded first and the manifest LAST so a new manifest
# never points at a missing recorder. Content types are set explicitly.
#
# Rollback is a pin (PRD 33 §3.5): emit-assets writes only latest/player/pageKit,
# so an operator-set `pinned` / `channels` in the LIVE manifest would be lost on
# every release. The manifest uploaded here is the new one with the live
# manifest's `pinned` and `channels` carried forward (a 404 = first publish).
#
#   bash .github/scripts/cdn-publish.sh --dry-run
#   bash .github/scripts/cdn-publish.sh replay-sdk/dist/assets --dry-run
#   bash .github/scripts/cdn-publish.sh replay-sdk/dist/assets
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: cdn-publish.sh [dir] [--dry-run]

Upload the CDN layout in <dir> (default: replay-sdk/dist/assets) to the
builderforce-cdn R2 bucket. Hashed /replay/r/* objects go first; the
manifest goes last.

Env: CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID (wrangler, unless --dry-run)
     CDN_R2_BUCKET   (default builderforce-cdn)
     CDN_SRC         (overrides the default dir)
     CDN_MANIFEST_URL (live manifest to carry pinned/channels from;
                      default https://cdn.builderforce.ai/replay/manifest.json)
     DRY_RUN=1       (same as --dry-run)
EOF
}

DRY=0
SRC_ARG=""
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY=1 ;;
    --help|-h) usage; exit 0 ;;
    -*)
      echo "cdn-publish: unknown argument: $arg" >&2
      usage >&2
      exit 2
      ;;
    *) SRC_ARG="$arg" ;;
  esac
done
if [[ "${DRY_RUN:-}" == "1" ]]; then DRY=1; fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUCKET="${CDN_R2_BUCKET:-builderforce-cdn}"
LIVE_MANIFEST_URL="${CDN_MANIFEST_URL:-https://cdn.builderforce.ai/replay/manifest.json}"

resolve_src() {
  local candidate="$1"
  if [[ -d "$candidate" ]]; then
    (cd "$candidate" && pwd)
  elif [[ -d "${ROOT}/${candidate}" ]]; then
    (cd "${ROOT}/${candidate}" && pwd)
  else
    echo "$candidate"
  fi
}

if [[ -n "${SRC_ARG}" ]]; then
  SRC="$(resolve_src "$SRC_ARG")"
elif [[ -n "${CDN_SRC:-}" ]]; then
  SRC="$(resolve_src "$CDN_SRC")"
elif [[ -d "${ROOT}/replay-sdk/dist/assets" ]]; then
  SRC="${ROOT}/replay-sdk/dist/assets"
elif [[ -d "${ROOT}/replay-sdk/dist/cdn" ]]; then
  SRC="${ROOT}/replay-sdk/dist/cdn"
else
  SRC="${ROOT}/replay-sdk/dist/assets"
fi

cache_for() {
  local key="$1"
  case "$key" in
    replay/r/*) echo "public, max-age=31536000, immutable" ;;
    replay/manifest.json|*/manifest.json) echo "public, max-age=60" ;;
    *) echo "public, max-age=300" ;;
  esac
}

type_for() {
  local file="$1"
  case "$file" in
    *.js) echo "application/javascript; charset=utf-8" ;;
    *.json) echo "application/json; charset=utf-8" ;;
    *.css) echo "text/css; charset=utf-8" ;;
    *) echo "application/octet-stream" ;;
  esac
}

put() {
  local key="$1"
  local file="$2"
  local cache
  local type
  cache="$(cache_for "$key")"
  type="$(type_for "$file")"
  if [[ "$DRY" == "1" ]]; then
    echo "wrangler r2 object put ${BUCKET}/${key} --file=${file} --cache-control=${cache} --content-type=${type}"
    return
  fi
  npx wrangler r2 object put "${BUCKET}/${key}" \
    --file="$file" \
    --content-type="$type" \
    --cache-control="$cache" \
    --remote
}

# merge_manifest NEW_MANIFEST OUT — OUT is NEW_MANIFEST plus the live manifest's
# `pinned` and `channels` (the new file's own values win; channels merge by name).
# A 404 is a first publish. Any other failure aborts a real publish — silently
# dropping a rollback pin is the bug this exists to prevent — and only warns in a
# dry run.
merge_manifest() {
  local new="$1"
  local out="$2"
  local live
  local code
  live="$(mktemp)"
  code="$(curl -sS -L --max-time 20 --retry 2 -o "$live" -w '%{http_code}' "${LIVE_MANIFEST_URL}?t=$(date +%s)" 2>/dev/null || true)"
  case "$code" in
    200) ;;
    404) echo "cdn-publish: no live manifest (first publish) — nothing to carry forward" >&2; : > "$live" ;;
    *)
      if [[ "$DRY" == "1" ]]; then
        echo "cdn-publish: could not read live manifest (HTTP ${code:-none}) — dry run, nothing carried forward" >&2
        : > "$live"
      else
        rm -f "$live"
        echo "cdn-publish: could not read live manifest ${LIVE_MANIFEST_URL} (HTTP ${code:-none}); refusing to publish over a possible pin" >&2
        exit 1
      fi
      ;;
  esac
  local dry_flag=()
  if [[ "$DRY" == "1" ]]; then dry_flag=(--dry-run); fi
  if ! node "$(dirname "$0")/merge-replay-manifest.mjs" "$new" "$live" "$out" ${dry_flag[@]+"${dry_flag[@]}"}; then
    rm -f "$live"
    echo "cdn-publish: could not merge the live manifest's pin into ${new}" >&2
    exit 1
  fi
  rm -f "$live"
}

canonical_dry_run() {
  echo "cdn-publish DRY_RUN (no files at ${SRC} — printing canonical layout)"
  echo "wrangler r2 object put ${BUCKET}/replay/r/recorder.<hash>.js --file=${SRC}/replay/r/recorder.<hash>.js --cache-control=public, max-age=31536000, immutable --content-type=application/javascript; charset=utf-8"
  echo "wrangler r2 object put ${BUCKET}/replay/v1/loader.js --file=${SRC}/replay/v1/loader.js --cache-control=public, max-age=300 --content-type=application/javascript; charset=utf-8"
  echo "wrangler r2 object put ${BUCKET}/embed/v1.js --file=${SRC}/embed/v1.js --cache-control=public, max-age=300 --content-type=application/javascript; charset=utf-8"
  echo "wrangler r2 object put ${BUCKET}/replay/manifest.json --file=${SRC}/replay/manifest.json --cache-control=public, max-age=60 --content-type=application/json; charset=utf-8"
}

if [[ ! -d "$SRC" ]]; then
  if [[ "$DRY" == "1" ]]; then
    canonical_dry_run
    exit 0
  fi
  echo "cdn-publish: missing ${SRC} — build replay-sdk first (npm --prefix replay-sdk run build)" >&2
  exit 1
fi

# Collect relative keys. Order: hashed recorder → everything else except
# manifests → manifests last, so a new manifest never points at a missing file.
hashed=()
middle=()
manifests=()
while IFS= read -r -d '' file; do
  rel="${file#"$SRC"/}"
  rel="${rel//\\//}"
  case "$rel" in
    replay/r/*) hashed+=("$rel") ;;
    *manifest.json) manifests+=("$rel") ;;
    *) middle+=("$rel") ;;
  esac
done < <(find "$SRC" -type f -print0)

if [[ ${#hashed[@]} -eq 0 && ${#middle[@]} -eq 0 && ${#manifests[@]} -eq 0 ]]; then
  if [[ "$DRY" == "1" ]]; then
    canonical_dry_run
    exit 0
  fi
  echo "cdn-publish: no files under ${SRC}" >&2
  exit 1
fi

MERGED_DIR="$(mktemp -d)"
trap 'rm -rf "$MERGED_DIR"' EXIT

for rel in "${hashed[@]+"${hashed[@]}"}" "${middle[@]+"${middle[@]}"}" "${manifests[@]+"${manifests[@]}"}"; do
  [[ -n "$rel" ]] || continue
  file="${SRC}/${rel}"
  if [[ "$rel" == "replay/manifest.json" ]]; then
    merged="${MERGED_DIR}/manifest.json"
    merge_manifest "$file" "$merged"
    if [[ "$DRY" == "1" ]]; then
      echo "cdn-publish: manifest to upload (live pinned/channels carried forward):"
      cat "$merged"
    fi
    file="$merged"
  fi
  put "$rel" "$file"
done

echo "cdn-publish: uploaded ${SRC} → r2://${BUCKET}"
