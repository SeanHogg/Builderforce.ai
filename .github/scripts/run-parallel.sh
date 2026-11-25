#!/usr/bin/env bash
# Run independent verification commands CONCURRENTLY inside one step; fail if any failed.
#
#   bash run-parallel.sh "npm run type-check" "npm test"
#   RUN_PARALLEL_TIMEOUT=20m bash run-parallel.sh ...   # end any command still running after 20m (default 0 = no limit)
#
# For checks too light to earn a runner of their own — a separate job pays a fresh
# checkout and install before it does any work. Heavy suites (the API, the VS Code
# extension, the agent runtime) are separate jobs in release.yml instead, so they do
# not compete for one runner's cores and memory.
#
# Each command's output is buffered and printed whole once it finishes, so concurrent
# runs never interleave in the log, and EVERY failure is reported rather than only the
# first — the same exit contract as scripts/run-checks.mjs.
set -uo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: run-parallel.sh <command> [<command>...]" >&2
  exit 2
fi

commands=("$@")
limit="${RUN_PARALLEL_TIMEOUT:-0}"
logs=$(mktemp -d)
pids=()

for i in "${!commands[@]}"; do
  timeout --kill-after=30s "$limit" bash -c "${commands[$i]}" >"$logs/$i.log" 2>&1 &
  pids[i]=$!
done

failed=0
for i in "${!commands[@]}"; do
  if wait "${pids[$i]}"; then
    # Passing output is collapsed; a failure prints open so it is the first thing read.
    echo "::group::✓ ${commands[$i]}"
    cat "$logs/$i.log"
    echo "::endgroup::"
  else
    status=$?
    failed=1
    echo "✗ ${commands[$i]} (exit $status)"
    cat "$logs/$i.log"
    # 124 = `timeout` ended it, 137 = it ignored SIGTERM and was killed; either way the log above is what it printed so far.
    if [ "$status" -eq 124 ] || [ "$status" -eq 137 ]; then
      echo "::error::${commands[$i]} timed out after ${limit}"
    fi
    echo "::error::${commands[$i]} failed (exit $status)"
  fi
done

rm -rf "$logs"
exit "$failed"
