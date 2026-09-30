#!/usr/bin/env bash
# Publish the package in the current directory unless its version is already on npm.
#
#   bash npm-publish-if-new.sh <package-name> [extra `npm publish` args...]
#
# The one guarded publish every npm job in the release workflow goes through, so a
# re-run of an unchanged version is a skip rather than a failed E403.
set -euo pipefail

package_name="$1"
shift

version=$(node -p "require('./package.json').version")
published() { npm view "$package_name@$version" version >/dev/null 2>&1; }

if published; then
  echo "$package_name@$version already exists; skipping publish."
  exit 0
fi

log=$(mktemp)
if npm publish --provenance --access public "$@" 2>&1 | tee "$log"; then
  exit 0
fi

# The release workflow cancels an in-progress run when a newer push lands. A run
# cancelled after npm accepted its PUT leaves the version STAGED — invisible to
# `npm view` until npm finishes it, but already owned — so the next run's publish
# answers E409. The version is in flight, not lost.
if grep -q "previously staged version" "$log"; then
  echo "::notice::$package_name@$version is already staged on npm by an earlier run; skipping publish."
  exit 0
fi

# A registry retry can publish successfully and still return an error; the new
# version can take a moment to become visible.
for _ in 1 2 3 4 5 6; do
  published && exit 0
  sleep 10
done
exit 1
