#!/usr/bin/env bash
# Sourced by release.yml's `plan` step (not run): picks the commit the affected-builds plan and the test-oracle
# guard compare against. Sets `base` and, when it cannot name a trustworthy base, exports FULL_BUILD=true.
#
# Env: PR_BASE, BEFORE, GH_TOKEN, GITHUB_EVENT_NAME, GITHUB_REF; FULL_BUILD may already be set.
#
# The history is not enough on its own. A run whose deploy jobs were skipped as superseded still ends SUCCESS,
# so "the last successful run" can be a commit that never shipped. For a push to main the base is therefore
# pulled back to what is LIVE, per component: the API's live commit (api.builderforce.ai/health) only when the
# API has undeployed changes since it, the frontend's only when the frontend has. A component that is already
# live at the base costs nothing, so a push that did not touch the API does not keep diffing from an old API
# commit. If a live commit is unreadable, not in this clone, or on a line of history other than main's (neither
# an ancestor nor a descendant of the base), build everything.
#
# Safe to `source` under `bash -e`: no top-level exit or return, every fallible command sits in an `if`.

# shellcheck source=live-commit.sh
source "$(dirname "${BASH_SOURCE[0]}")/live-commit.sh"

# Did <component> (a key of affected-builds.mjs's plan) change between <from> and <to>? Prints true or false and
# returns 0, or returns 1 when affected-builds could not answer. The paths rules live in affected-builds.mjs only.
plan_component_changed() {
  local from="$1" to="$2" component="$3" answer=""
  if ! answer=$(env -u GITHUB_OUTPUT FULL_BUILD=false node .github/scripts/affected-builds.mjs "$from" "$to" | jq -r --arg c "$component" '.[$c]'); then
    return 1
  fi
  if [ "$answer" = "true" ] || [ "$answer" = "false" ]; then
    printf '%s' "$answer"
    return 0
  fi
  return 1
}

if [ -n "$PR_BASE" ]; then
  base="$PR_BASE"
else
  # Include unpublished changes if a prior push failed or was superseded. `--status success` is filtered by the
  # API on the run's conclusion, so a cancelled or failed run's commit is never chosen. With no successful run
  # to compare against, build everything rather than guess from $BEFORE.
  last=""
  if ! last=$(gh run list --workflow release.yml --branch main --event push --status success --limit 1 --json headSha --jq '.[0].headSha // empty') || [ -z "$last" ]; then
    export FULL_BUILD=true
  fi
  base="${last:-$BEFORE}"
  if ! git merge-base --is-ancestor "$base" HEAD 2>/dev/null; then
    base=""
    export FULL_BUILD=true
  fi

  if [ "$GITHUB_EVENT_NAME" = "push" ] && [ "$GITHUB_REF" = "refs/heads/main" ] && [ -n "$base" ]; then
    for target in api=https://api.builderforce.ai/health frontend=https://builderforce.ai/health; do
      component="${target%%=*}"
      url="${target#*=}"
      if live=$(read_live_commit "$url") && git cat-file -e "$live^{commit}" 2>/dev/null; then
        if merged=$(git merge-base "$base" "$live" 2>/dev/null) && [ -n "$merged" ]; then
          # Equal to the base, or a descendant of it: the base already holds everything that is live.
          if [ "$merged" != "$base" ]; then
            # `rev-parse` sits in an `if` so a failure falls to the FULL_BUILD branch instead of aborting the
            # shell that sourced this file.
            if ! live_sha=$(git rev-parse "$live^{commit}" 2>/dev/null) || [ "$merged" != "$live_sha" ]; then
              # The merge-base is neither the base nor the live commit, so live sits on another line of
              # history: changes that are live-only would be invisible to a merge-base..base diff.
              echo "::warning::$component's live commit $live is not on main's history; building everything."
              export FULL_BUILD=true
            elif changed=$(plan_component_changed "$merged" "$base" "$component"); then
              if [ "$changed" = "true" ]; then base="$merged"; fi
            else
              echo "::warning::Could not tell whether $component changed since its live commit; building everything."
              export FULL_BUILD=true
            fi
          fi
        else
          export FULL_BUILD=true
        fi
      else
        echo "::warning::Could not read a known live commit from $url; building everything."
        export FULL_BUILD=true
      fi
    done
  fi
fi
