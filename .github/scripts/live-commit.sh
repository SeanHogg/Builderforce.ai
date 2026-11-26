#!/usr/bin/env bash
# Sourced, not run. The ONE place that reads which commit a deployed Worker reports.
#
#   read_live_commit <health-url>   prints the hex `commit` from GET <health-url> and returns 0;
#                                   returns 1 (prints nothing) when it is unreachable, has no commit, or
#                                   the commit is not hex (an unstamped Worker). Three tries, 10 s each.
#
# Used by assert-not-rollback.sh (refuse a deploy that moves a Worker backwards) and plan-base.sh (pick the
# comparison base from what is actually live). The `commit` field is the GIT_SHA that release.yml stamps on
# deploy-api and deploy-frontend; see api/src/application/llm/deployStatusToolCatalog.ts for the same read.

read_live_commit() {
  local url="$1" attempt live=""
  for attempt in 1 2 3; do
    # fail-open by design: a failed probe is an empty answer, which the caller treats as "unreadable".
    live=$(curl -fsS --max-time 10 -H 'accept: application/json' "$url" 2>/dev/null | jq -r '.commit // empty' 2>/dev/null || true)
    if [[ "$live" =~ ^[0-9a-fA-F]{7,40}$ ]]; then
      printf '%s' "$live"
      return 0
    fi
    if [ "$attempt" -lt 3 ]; then sleep 3; fi
  done
  return 1
}
