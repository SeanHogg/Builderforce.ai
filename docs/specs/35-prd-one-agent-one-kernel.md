# PRD 35 — One agent, one kernel

| | |
|---|---|
| Status | In progress. This document holds **only what is left to complete**. Everything finished is in DONE.md (2026-10-31), under its original section numbers, which is why the numbers below have gaps. Checked 2026-10-31. Board: epic 5979, one ticket per workstream. |
| Owner | Agents program. Model roles are in CLAUDE.md. |
| Design reference | [`docs/design/one-agent-one-kernel.html`](../design/one-agent-one-kernel.html), the picture: end state, both matrices, retention ledger, telemetry. Live copy: https://claude.ai/artifact/Ggc3G5y2ZLkJsVe1jDHag8 |
| Roadmap | `ROADMAP.md` › Cloud and IDE agent runs › "ONE execution core" |

**The goal.** Many entry points → ONE agent (`packages/agent-run`) → ONE kernel (`packages/agent-loop`). An entry point decides *where* a run gets its model, files, shell, storage and people, never *how* the run behaves. Cloud runs, @-replies, canvas and on-prem tickets already run on `runAgent`. **VS Code, web and Rovr chat, which carry nearly all traffic, and on-prem channels do not.**

## 4. What is left

```
WS2f container shell ─┐
WS4 chat adapters ────┼─► WS7 enforce + delete + done
WS5 channels ─────────┘
```

### WS2f — The container shell

- **Owns.** `packages/agent-run/src/policy/tools/**` and `api/container/sandboxCore.mjs`.
- **Problem.** Long shell commands block a cloud run. The container's `run_command` (`sandboxRun`) ignores `cwd`, `background` and `yieldMs`.
- **Do.** Make it honour all three, with a `process`-style poll that returns a job handle. A foreground command keeps the 10-minute ceiling.
- **Accept.** A cloud run starts a background command, polls it, and runs a command in a named working directory. The `tool-output-policy` and exec tests pass unchanged.

### WS4 — VS Code + Rovr / Web chat adapters (highest-traffic, telemetry-gated)

- **Owns.**
  - `brain-embedded/src/run/webAdapter.ts`.
  - The `brain-embedded/src/runStore/runLoop.ts` policy (moved, then deleted).
  - `clients/vscode/src/run/vscodeAdapter.ts` and the `brainRunHost.ts` call site.
- **Do:**
  - The run store becomes `RunStore` + `HumanChannel` + `EventSink`. That keeps single-flight,
    Stop, the confirm gate and the live trace.
  - The local-first transport and `xmlToolCalls` become `ModelTransport`.
  - Send the entry-point label (`vscode` / `web` / `rovr`).
- **Accept.**
  - Conformance passes.
  - The brain-embedded, VS Code and frontend tests pass unchanged.
  - The VSIX is packaged and installed.
  - **Ship gate:** a week of VS Code telemetry is at or better than §8.1. If it regresses,
    revert to the previous VSIX and route the failure back to the planning model.

### WS5 — On-prem channels

- **Owns.** The `agent-runtime/src/builderforce/agent-loop/agent-loop.ts` policy (moved) and its call sites.
- **Do.** Channels and cron call `runAgent` through `agent-runtime/src/run/onPremAdapter.ts`, as tickets already do.
- **Accept.** Conformance passes. The agent-runtime tests pass unchanged (§5.1).

### WS8 leftover — Split `bfApi.ts`

`clients/vscode/src/bfApi.ts` is over its size limit and must be split. Do it before or with the WS4 VS Code adapter.

### WS7 — Enforce, delete, close (last)

- Flip `check:one-execution` to enforce, with an empty allowlist.
- Run conformance across all four adapters in CI.
- Delete every source a WS2 module ported from that its adapter has not already deleted, including the `brain-embedded/src/runSteering.ts` twin.
- Close the rows marked **needs characterization test** in [`retention-ledger.md`](../../packages/agent-run/docs/retention-ledger.md), and run the tests listed as §5.1 exceptions unchanged through their adapter.
- Check every §3.3 row.
- The planning model moves the ROADMAP entry to DONE.md.

## 3.3 Done means

| Check | Passes when |
|---|---|
| Conformance suite | One scripted task (fake model, in-memory provider) through all four adapters gives the same `RunEvent` trace and `RunOutcome`. The cloud adapter runs it one step per tick and still matches. A board-dispatched variant with `signoff` set is included. |
| `check:one-execution` | Nothing outside `packages/agent-run` imports `runAgentLoop` or any `policy/*` module. |
| Adapter size | Each adapter < ~300 lines, only builds ports. Two loop-bearing files remain: `runLoop` (175 lines) and `agent-loop.ts` (383 lines). |
| Parity | Every pre-existing behaviour test passes **unchanged** (§5.1). `check:tests-unchanged` enforces; the test count does not drop. |
| Matrix | The design's final matrix holds: one policy module per row, entry points differ only by port. |
| No lost capability | Every §7 row's old tests pass against its new home before the old home is deleted. |
| Telemetry | Every entry point writes the uniform outcome row (§8.2); VS Code stays at or better than baseline (§8.1). |
| Efficiency | The §8.4 reference scenario replays through every adapter within its budgets: first spawn by parent turn 5, ≤15 parent turns, 0 covered-read stubs for unseen lines, 0 repo-resolution errors, 0 shell reads of workspace files, and no readiness claim left unkept for more than 2 turns. A stop settles the run in ≤2 s with no child process left, and a mid-run steer reaches the next model call. |

## 5. Rules for every agent on this program

1. **Port, then delete.** Port the missing behaviour into the agent, prove it, delete the old
   copy in the same workstream. No parallel copies, and no "duplicate remains" entries.
2. **Tests run unchanged.** Existing behaviour tests are the parity oracle. You may retarget
   an import from a deleted module to its replacement. You must not change an input or an
   expected value. A failing test means you fix the source. If a behaviour change is
   genuinely intended, stop and ask the planning model. The full procedure is §5.1.
3. **No new loop, no policy in an adapter, no `entryPoint` branching.** `RunPolicy.entryPoint`
   is a telemetry label only.
4. **No god classes.** Under ~400 lines per module, one reason to change.
5. **Model roles** are a hard rule, and CLAUDE.md states them. Never a full vitest sweep.
6. **Commits.** One branch per workstream: `feat/agent-run-ws<N>`. No Co-Authored-By line.
   Bump the version of every package you change, and never reuse a version. Wait for CI
   before pushing over a running build.
7. **Docs.** Only the planning model edits ROADMAP.md, DONE.md and this PRD. Put contract or
   scope requests in your hand-off note.
8. **Hand-off note** (end of every workstream, in the PR description):
   - what moved where (as §7 rows);
   - which tests prove it, with their pass output;
   - files deleted;
   - contract requests;
   - telemetry deltas, where relevant.

### 5.1 Proving every capability with tests

Every capability moves under the same five steps. A workstream is not done until each §7 row it
owns has been through all five.

1. **Baseline on the old home.** Before porting, run the row's tests against the code that
   exists today and record the pass output in the hand-off note. A test that is not green on
   the old home is not an oracle. Report it to the planning model before going further.
2. **No test, write one first, against the old home.** If a capability has no test, write a
   characterization test that pins today's observable behaviour: inputs, tool calls, events,
   the outcome. It must pass on the old home, and it lands in the same branch **before** any
   porting commit. From then on it is an existing test and follows rule 2. Never write the test
   against the new home first. A test written to fit new code proves nothing about parity.
3. **Port, then run the same tests on the new home.** The same files, the same assertions.
   Rule 2 is the only allowed edit: an import moved from a deleted module to its replacement.
4. **Run them through every entry point that has the capability.** A capability that more
   than one entry point uses also gets a conformance case (§3.3). The same scripted task gives
   the same `RunEvent` trace and `RunOutcome` on each adapter, and on the cloud adapter at
   `maxSteps: 1`.
5. **Delete the old home only after steps 3 and 4 are green.** Deletion happens in the same
   workstream.

Not allowed in a test file on this program:
- changing an input, a fixture's content or an expected value;
- deleting a test or a test file, or merging tests so fewer cases run;
- adding `.skip`, `.only`, `.todo` or `it.fails`, or wrapping an assertion in a conditional;
- loosening a matcher: `toEqual` → `toMatchObject`, an exact string → `stringContaining`,
  `toHaveBeenCalledWith` → `toHaveBeenCalled`, an exact count → `toBeGreaterThan`;
- adding mocks that stub out the behaviour under test.

A test that reaches into a deleted module's internals, such as a private helper or an SDK
option object, is retargeted to the **public seam that carries the same behaviour**. It keeps
the same inputs and the same expected values. If no seam can carry them, it goes to the
planning model. It is never rewritten to fit.

Checked by reviewers and CI:
- The Opus or Fable review gets the test-file diff on its own and rejects any hunk that isn't
  an import line.
- The Sonnet verify agent reports the test count per file before and after. A drop fails the
  workstream.
- WS1 adds `check:tests-unchanged` (report mode, enforced in WS7). It diffs every test file
  touched on a `feat/agent-run-ws*` branch against main and fails on any changed line that
  isn't an `import` / `vi.mock` path, and on any new skip marker.

## 8.1 Telemetry baseline (the WS4 ship gate)

Failure rate 4.4% (20 of 452). Steps per run ≈ 43 (failed runs ≈ 62). Prompt-cache hit 23%.
WS4 ships only if a week after cut-over stays at or better than these. Reproduce with
`scripts/telemetry-baseline.cjs` (WS6). How to attribute rows: VS Code = `tenant_api_key_id`
whose key kind is `vscode` (its `surface` is clamped to `web`); cloud = `surface='cloud'`
with `execution_id`; @-reply = `use_case='brain_agent_reply'`. Telemetry tables live on
`NEON_TRANSACTIONAL_DATABASE_URL`. Queries are read-only and never print the connection URL.

## 8.4 Reference scenario (the live check on WS4's VSIX)

The 2026-10-25 run (§2.1) becomes a scripted conformance case and a live regression check.

**The task.** "Review `docs/specs/35-prd-one-agent-one-kernel.md` and update it using
sub-agents." The scripted version runs in a multi-repo workspace root with a 45 KB markdown
PRD.

| Measure | 2026-10-25 run | Budget |
|---|---|---|
| Parent turns to finish | 79+ (unfinished) | ≤ 15 |
| Turn of the first spawn | never | ≤ 5 |
| Reads of the PRD | 8 (4 windows + 2 `sed` + stubs) | ≤ 2, or outline + sections |
| Covered-read stubs for lines never served | ≥ 1 | 0 |
| `repo_errors` | 2 | 0 |
| Foreground commands over 2 min | 1 (10 min) | 0 |
| PRD edited | no | yes |
| Planning model | Flash (silent fallback) | stated by `model_preflight` before turn 1 |
| Time from a typed "write the update now" to the model seeing it | never: held until the run ends | the next model call; a foreground command running at the time is aborted |
| Time from Stop / a typed "STOP" to the run settling | never: the 5 m+ command kept running | ≤ 2 s, with the child process gone |
| Turns from a readiness claim ("I have everything I need") to a change, spawn or hand-off | never: chat #6 claimed and kept reading (run #562: 105 turns, `⚠ SPUN`) | ≤ 2 (WS8p) |

The live check runs on WS8's VSIX and again on WS4's. A miss routes to the planning model.
