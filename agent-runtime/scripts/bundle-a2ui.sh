#!/usr/bin/env bash
set -euo pipefail

on_error() {
  echo "A2UI bundling failed. Re-run with: pnpm canvas:a2ui:bundle" >&2
  echo "If this persists, verify pnpm deps and try again." >&2
}
trap on_error ERR

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HASH_FILE="$ROOT_DIR/src/canvas-host/a2ui/.bundle.hash"
OUTPUT_FILE="$ROOT_DIR/src/canvas-host/a2ui/a2ui.bundle.js"
A2UI_RENDERER_DIR="$ROOT_DIR/vendor/a2ui/renderers/lit"
A2UI_APP_DIR="$ROOT_DIR/apps/shared/BuilderForceAgentsKit/Tools/CanvasA2UI"
A2UI_RENDERER_TSCONFIG="$A2UI_RENDERER_DIR/tsconfig.json"
A2UI_APP_ROLLDOWN_CONFIG="$A2UI_APP_DIR/rolldown.config.mjs"
A2UI_RENDERER_TSCONFIG_REL="vendor/a2ui/renderers/lit/tsconfig.json"
A2UI_APP_ROLLDOWN_CONFIG_REL="apps/shared/BuilderForceAgentsKit/Tools/CanvasA2UI/rolldown.config.mjs"

PNPM_RUNNER=(pnpm)
if ! command -v node >/dev/null 2>&1 && command -v cmd.exe >/dev/null 2>&1; then
  PNPM_RUNNER=(cmd.exe /c pnpm)
fi

pnpm_run() {
  "${PNPM_RUNNER[@]}" "$@"
}

# Docker builds exclude vendor/apps via .dockerignore.
# In that environment we can keep a prebuilt bundle only if it exists.
# CI builds set BUILDERFORCE_AGENTS_A2UI_SKIP_MISSING=1 to skip bundling entirely
# (no prebuilt bundle is committed; the canvas feature is omitted from the dist).
if [[ ! -f "$A2UI_RENDERER_TSCONFIG" || ! -f "$A2UI_APP_ROLLDOWN_CONFIG" ]]; then
  if [[ -f "$OUTPUT_FILE" ]]; then
    echo "A2UI sources missing; keeping prebuilt bundle."
    exit 0
  fi
  # No prebuilt bundle — skip only if explicitly allowed (e.g. CI without vendor sources).
  if [[ "${BUILDERFORCE_AGENTS_A2UI_SKIP_MISSING:-}" == "1" ]]; then
    echo "A2UI sources missing; skipping bundle (BUILDERFORCE_AGENTS_A2UI_SKIP_MISSING=1)."
    exit 0
  fi
  echo "A2UI sources missing and no prebuilt bundle found at: $OUTPUT_FILE" >&2
  exit 1
fi

INPUT_PATHS=(
  "$ROOT_DIR/package.json"
  "$ROOT_DIR/pnpm-lock.yaml"
  "$A2UI_RENDERER_DIR"
  "$A2UI_APP_DIR"
)

compute_hash() {
  local hash_cmd
  if command -v sha256sum >/dev/null 2>&1; then
    hash_cmd="sha256sum"
  elif command -v shasum >/dev/null 2>&1; then
    hash_cmd="shasum -a 256"
  else
    echo "Neither sha256sum nor shasum is available to compute the A2UI bundle hash." >&2
    exit 1
  fi

  (
    cd "$ROOT_DIR"

    for input in "${INPUT_PATHS[@]}"; do
      rel_path="${input#"$ROOT_DIR"/}"
      if [[ -d "$input" ]]; then
        find "$rel_path" -type f -print0
      else
        printf '%s\0' "$rel_path"
      fi
    done |
      sort -z |
      while IFS= read -r -d '' rel_path; do
        if [[ "$hash_cmd" == "sha256sum" ]]; then
          file_hash="$(sha256sum "$rel_path" | awk '{print $1}')"
        else
          file_hash="$(shasum -a 256 "$rel_path" | awk '{print $1}')"
        fi
        printf '%s\0%s\0' "$rel_path" "$file_hash"
      done |
      if [[ "$hash_cmd" == "sha256sum" ]]; then
        sha256sum | awk '{print $1}'
      else
        shasum -a 256 | awk '{print $1}'
      fi
  )
}

current_hash="$(compute_hash)"
if [[ -f "$HASH_FILE" ]]; then
  previous_hash="$(cat "$HASH_FILE")"
  if [[ "$previous_hash" == "$current_hash" && -f "$OUTPUT_FILE" ]]; then
    echo "A2UI bundle up to date; skipping."
    exit 0
  fi
fi

(
  cd "$ROOT_DIR"
  pnpm_run -s exec tsc -p "$A2UI_RENDERER_TSCONFIG_REL"
  if command -v rolldown >/dev/null 2>&1; then
    rolldown -c "$A2UI_APP_ROLLDOWN_CONFIG_REL"
  else
    pnpm_run -s dlx rolldown -c "$A2UI_APP_ROLLDOWN_CONFIG_REL"
  fi
)

echo "$current_hash" > "$HASH_FILE"
