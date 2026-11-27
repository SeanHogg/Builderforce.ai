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
published() {
  local visible_version
  visible_version=$(npm view "$package_name@$version" version --prefer-online 2>/dev/null) && [ "$visible_version" = "$version" ]
}

if published; then
  echo "$package_name@$version already exists; skipping publish."
  exit 0
fi

# A run for an OLDER commit can reach this point after a newer one published (publish order is not commit
# order). npm moves `latest` to whatever is published last, so a lower version goes out under the `previous`
# tag instead and `latest` stays where it is. `sort -V` orders dotted versions (semver and calver) numerically;
# a package that is not on npm yet has no latest to protect and publishes as before.
# fail-open by design: an unreadable latest (new package, registry hiccup) means "nothing to protect".
latest=$(npm view "$package_name" version --prefer-online 2>/dev/null || true)
publish_tag=()
if [ -n "$latest" ] && [ "$version" != "$latest" ] \
  && [ "$(printf '%s\n%s\n' "$version" "$latest" | sort -V | head -n1)" = "$version" ]; then
  echo "::notice::$package_name@$version is lower than the current latest ($latest); publishing under the 'previous' tag so latest does not move backwards."
  publish_tag=(--tag previous)
fi

log=$(mktemp)
if npm publish --provenance --access public ${publish_tag[@]+"${publish_tag[@]}"} "$@" 2>&1 | tee "$log"; then
  exit 0
fi

if [ "${STAGE_ON_OIDC_DENIAL:-false}" = true ] && grep -q 'OIDC permission denied for this action' "$log"; then
  if npm stage publish --provenance --access public ${publish_tag[@]+"${publish_tag[@]}"} "$@" 2>&1 | tee "$log"; then
    echo "::notice::$package_name@$version is staged on npm. A maintainer must approve it before it is public."
    exit 0
  fi
fi

# A run interrupted after npm accepted its PUT (a job that was killed or timed out) leaves the version
# STAGED — invisible to `npm view` until npm finishes it, but already owned — so the next run's publish
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
if grep -Fq 'Cannot stage previously published version' "$log"; then
  echo "::error::npm reserves $package_name@$version, but the public registry does not serve it. Check the existing staged release in npm before retrying."
fi
exit 1
