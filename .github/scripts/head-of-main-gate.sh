#!/usr/bin/env bash
# Is this run's commit still the head of main?
#
# Usage:
#   head-of-main-gate.sh            writes `go=true|false` to $GITHUB_OUTPUT (the gate JOBS). A superseded
#                                   commit is not an error: go=false, the deploy is skipped, the run succeeds.
#   head-of-main-gate.sh --assert   exits non-zero when this commit is not the head (the first step INSIDE a
#                                   deploy job). It catches a stale gate output: a single deploy job re-run
#                                   long after its gate passed.
#
# GitHub orders a concurrency group by the time a job ENTERS it, not by commit order, so an older commit that
# enters late would otherwise deploy over a newer one.
#
# Refs other than main (a pull request, a dispatch on a branch) are not main deploys, so they pass and the
# deploy job's own `if:` decides what they do, exactly as before.
#
# Env: GH_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_REF, and GITHUB_OUTPUT (output mode only).
set -euo pipefail

mode="output"
if [ "${1:-}" = "--assert" ]; then mode="assert"; fi

emit() { if [ "$mode" = "output" ]; then echo "go=$1" >> "$GITHUB_OUTPUT"; fi; }

if [ "$GITHUB_REF" != "refs/heads/main" ]; then
  emit true
  exit 0
fi

head=""
for attempt in 1 2 3; do
  if head=$(gh api "repos/$GITHUB_REPOSITORY/commits/main" --jq .sha); then break; fi
  head=""
  if [ "$attempt" -lt 3 ]; then sleep 5; fi
done
if [ -z "$head" ]; then
  # Fails closed: a deploy that cannot prove it is the newest commit does not run. The job goes red.
  echo "::error::Could not read the head of main; not deploying without knowing this commit is the newest."
  exit 1
fi

if [ "$head" = "$GITHUB_SHA" ]; then
  emit true
  exit 0
fi

if [ "$mode" = "assert" ]; then
  echo "::error title=Superseded::$GITHUB_SHA is no longer the head of main ($head); this deploy is superseded. Re-run ALL jobs on the newest commit's run, never a single deploy job of this one."
  exit 1
fi
emit false
echo "::notice title=Superseded::$GITHUB_SHA is no longer the head of main ($head). Skipping this deploy; the newer run deploys it."
