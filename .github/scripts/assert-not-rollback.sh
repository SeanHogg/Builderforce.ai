#!/usr/bin/env bash
# Refuses a deploy that would move a live Worker BACKWARDS.
#
# Usage: assert-not-rollback.sh <health-url>
#
# Reads the commit the Worker reports at <health-url> (live-commit.sh) and asks GitHub how this run's commit
# relates to it, with the same compare semantics as api/src/application/llm/deployStatusToolCatalog.ts:
# `compare/{live}...{this}` answers `ahead` or `identical` when this commit contains what is live. Anything
# else (`behind`, `diverged`) fails.
#
# When the live commit cannot be read (unreachable, unstamped, or GitHub cannot compare it) this warns and
# continues: an unreadable answer must not block a first deploy or an outage recovery. A deliberate redeploy
# of an older commit skips this script (the workflow's `allow_rollback` dispatch input).
#
# Env: GH_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA.
set -uo pipefail

url="${1:?usage: assert-not-rollback.sh <health-url>}"
# shellcheck source=live-commit.sh
source "$(dirname "${BASH_SOURCE[0]}")/live-commit.sh"

if ! live=$(read_live_commit "$url"); then
  echo "::warning::Could not read a commit from $url; skipping the rollback check."
  exit 0
fi

# fail-open by design: a compare GitHub cannot answer is a warning, per the header; only a definite verdict fails.
if ! status=$(gh api "repos/$GITHUB_REPOSITORY/compare/$live...$GITHUB_SHA?per_page=1" --jq .status 2>/dev/null); then
  echo "::warning::GitHub could not compare live commit $live with $GITHUB_SHA; skipping the rollback check."
  exit 0
fi

case "$status" in
  ahead|identical)
    echo "Live commit $live is contained in $GITHUB_SHA ($status); deploying."
    ;;
  *)
    # `status` is GitHub's answer for the compare live...this: how THIS commit sits relative to what is live.
    case "$status" in
      behind) relation="BEHIND the live commit $live" ;;
      diverged) relation="DIVERGED from the live commit $live" ;;
      *) relation="'$status' relative to the live commit $live" ;;
    esac
    echo "::error::Refusing to deploy $GITHUB_SHA: it is $relation, so deploying it would roll back what is live. To do that on purpose, dispatch the workflow with allow_rollback from a branch or tag at that commit (a dispatch on main must be the head of main)."
    exit 1
    ;;
esac
