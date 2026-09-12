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
if npm view "$package_name@$version" version >/dev/null 2>&1; then
  echo "$package_name@$version already exists; skipping publish."
elif ! npm publish --provenance --access public "$@"; then
  # A registry retry can publish successfully and still return an error.
  npm view "$package_name@$version" version >/dev/null 2>&1 || exit 1
fi
