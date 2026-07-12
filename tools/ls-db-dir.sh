#!/usr/bin/env bash
set -euo pipefail
s="${1:-}"
if [ ! -d "$s" ]; then
  echo "Directory not found: $s"
  exit 1
fi
find "$s" -type f -name "schema*.ts" | head -20