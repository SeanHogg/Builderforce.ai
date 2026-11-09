# PRD 45 — Deterministic run gates and loop economics

**Status:** Approved — decisions OD-1–OD-3 made 2026-11-08 (§6); revised after an Opus design review the same day ·
**Owner:** agent runtime · **Written:** 2026-11-08
**Surfaces:** VS Code (VSIX / Brain) first. The gate *decisions* are pure and shared, so on-prem and cloud can bind the same
rules later; this PRD only wires the VSIX.
**For:** the agent or engineer implementing this. Every claim names the file it was checked in. Read §3 before touching
code — most of what you need already exists, and the seams are specific.

---

## 1. Why

Two VS Code sessions on 2026-11-08 show the agent shipping work that a deterministic check would have refused, and
spending most of its tokens re-sending context instead of working.

**Chat #214 ("A2A")** — `local/kimi-code/kimi-for-coding`, 69 turns, 3.02M prompt / 33.6k completion tokens.
It committed and pushed ~900 lines to `main` (`41b0ff264`, `4df6b756e`) containing:

- a call to `runEmbeddedAgent` missing the required `timeoutMs` and `runId`
  (`agent-runtime/src/agents/embedded-runner/run/params.ts`). **A typecheck cannot see this:** the caller declares the
  function as `(params: Record<string, unknown>) => …`. Only a test that exercises the code, or a reviewer, catches it;
- zero tests for three new source files;
- unused code (`spawnSync`, `messageToText`) and a header describing a surface that does not exist;
- a "typecheck passed" claim from `npx tsc --noEmit | grep … | head; echo DONE`, which exits 0 whatever `tsc` does;
- a review it recorded on itself (`builtin_reviews_record` → `complete`) and the ticket moved to `done`;
- one further finding, tracked out of source control (operator has it).

**Chat #216 ("Visualizer")** — 31 turns, 2.08M prompt / 18k completion tokens, prompt peak 93k.
- 16 planning turns reading ~30 whole files (5–18 KB each); it said "I have enough to act" three times and kept reading.
- 15 code turns with **one edit each**, each re-sending ~80k of prompt (~1.2M tokens for 11 edits).
- A 14 KB rewrite of `Towers.tsx` introduced a rules-of-hooks violation, caught only because one turn happened to be routed
  to another model; the file was then re-read and rewritten.
- Repeated narration every turn ("I'm mid-implementation across the four views… Continuing…").
- Ticket titled "Code change (1 file)" while ~8 files changed.

Any model does this. **The host must decide what "verified", "reviewed" and "done" mean, from checks it runs itself, and
refuse side effects without them** — and the loop must stop paying a full prompt for every single tool call.

## 2. Goals and non-goals

**Goals**

- G1. No base-branch push, pull request, ticket→`done` or review→`complete` without host-recorded evidence for every
  file in the outgoing commits, plus an approving review from a different model (OD-1).
- G2. A broken edit is reported on the edit's own result within seconds.
- G3. Evidence cannot be manufactured: only host-run checks count, keyed by the bytes they saw.
- G4. Halve prompt tokens per unit of work on runs like #216 (measured, §8).
- G5. Gate decisions are pure modules; the VSIX supplies ports. Hosts that bind no ports (web Brain, parity harness)
  behave exactly as today.

**Non-goals**

- Fixing the A2A extension (separate Gap Register entry). It is the test case, not the scope.
- Catching design errors deterministically ("this isn't really the A2A protocol"). That is the OD-1 reviewer's job.
- A model-maintained plan checklist (`update_task_state` stays off on the VSIX; see B5).
- Wiring on-prem or cloud. Their existing gates are unchanged.
- Any frontend UI.

## 3. What exists today (checked — reuse, do not rebuild)

| Piece | Where | Notes |
|---|---|---|
| Brain run composition | `brain-embedded/src/run/runPrepared.ts:76-89` | `modules: { compaction, model }`. Do **not** add `finish`: the VSIX excludes the `finish` tool (`clients/vscode/src/fileTools.ts:55`), so runs settle in prose. |
| Brain run policy | `brain-embedded/src/run/webAdapter.ts:113` | `levers: []`, `verify: 'none'`, `approvalGates: []`. The R10 comment says gating belongs in the Brain's own preflight. |
| Call preflight | `brain-embedded/src/runStore/callPreflight.ts` (290 lines) | Router unwrap and alias resolution end at ~line 72. `stampRunChat`, then the human confirm gate (`needsConfirm` → `requestRunConfirm`) at ~163-166. `brainPlatformTools.ts:99` only delegates here; `execute()` also reaches it when the kernel skipped preflight (`brainPlatformTools.ts:116-121`). |
| Call runner / result shaping | `brain-embedded/src/runStore/callRunner.ts:121-190` | Results are shaped and advisories attached **before** `trimToolResult`. Ticket completion is already guarded here (`:147-161`) via `brain-embedded/src/completionGuard.ts` (`canCompleteTicket`, `TICKET_UPDATE`). |
| Host request | `brain-embedded/src/runStore/runTypes.ts` (~line 98) | Host-supplied ports: `runTool`, `needsConfirm`, … New ports go here. |
| End-of-run gates | `brain-embedded/src/runStore/deliveryGates.ts` read by `brainDelivery.ts` | "The run's ONE gate" (`webAdapter.ts:143`). Includes the placeholder ledger. |
| Self-review ship flow | `brain-embedded/src/selfReviewShip.ts` | Review → commit → push → ticket closes. Keep the flow; change its review step (OD-1). |
| Ship evidence | `brain-embedded/src/shipVerification.ts` | `gitCommandPattern()` at `:85`; `shippedToBaseBranch`. Tickets close after a verified push via `completeShippedTickets` — so the **push gate is the real done gate**. |
| Ticket titling backstop | `brain-embedded/src/runStore/runBackstops.ts` | Where B9 goes. |
| Post-edit note format (D7) | `packages/agent-run/src/policy/guards/postEdit.ts:72-83` | `postEditNote` / `withPostEditNote`. Reuse the format. |
| Sandbox verify | `packages/agent-run/src/policy/verify/sandboxVerify.ts` | `runSandboxVerify` behind `VerifySandbox`/`VerifyShell` ports gives honest exit codes. It uses `planInRunVerify` (`inRunVerify.ts`), whose plan includes `${runner} run test` (`:90`) — the **full suite**; filter it (§4.4). |
| Progress / readiness | `packages/run-guards/src/progressDetector.ts`, `readinessClaim.ts`; VSIX via `brain-embedded/src/runStore/progressGuard.ts` | `UNKEPT_READY_AT = 2` (`readinessClaim.ts:16`). `unkept_ready: 4` is a **rank** (`SIGNAL_RANK`, `:37-44`), not a threshold. The ladder (1st trip steer, 2nd escalate, 3rd pause, `:248-256`) is shared by every signal. Built fresh per run; **no persisted state**. |
| Device levers | `brain-embedded/src/runStore/deviceLevers.ts:9` | `deviceLeverOn(id)` = manifest default + `process.env` (`COST_LEVER_<ID>=off`), tenant `null`. Levers with rollout < 100 are therefore **off** on the VSIX (C3 rollout 10 → off). |
| Cost levers | `packages/cost-levers/src/index.ts` | `c8_token_compression` (`:82`), `c9_price_tier_budget` exist — pick the next free id. |
| Outline tool | `file_outline` in the VSIX tool host (`clients/vscode/src/fileTools.ts:125` labels it) | Reuse its executor for B2. |
| LSP diagnostics | `clients/vscode/src/prefetch/lspDiagnostics.ts` | Open documents only. |
| Sub-agents / review stage | `clients/vscode/src/subagentTool.ts`; `clients/vscode/src/stageModels.ts:7,46` (`builderforce.models.review` → `verify` stage); delivery gates' `entersVerify` | OD-1 builds on these. |
| Working-transcript fold | `brain-embedded/src/run/brainFold.ts` → `buildWorkingTranscript` from `@seanhogg/builderforce-memory/working` | B6/B7 belong in builderforce-memory. |
| Repo guard runner | `scripts/run-checks.mjs` + `{api,frontend}/scripts/checks.manifest.mjs` | |
| String edit | `packages/agent-tools/src/edit.ts` `applyStringEdit` | One replacement per call; returns an excerpt. |
| Tool result caps | `packages/tool-output-policy/src/caps.ts:19` | `read_file` cap is 16,000 chars. |
| Plugin HTTP dispatch | `agent-runtime/src/gateway/server/plugins-http.ts` `createGatewayPluginRequestHandler`; `agent-runtime/src/plugins/registry.ts`, `plugins/http-registry.ts` | `registerHttpHandler` carries no path. Callers: a2a, bluebubbles, googlechat, nostr, zalo. |
| Package wiring | `clients/vscode/tsconfig.json:31` aliases `run-guards` | The esbuild alias must match; `scripts/check-source-package-graph.mjs` enforces it. |

## 4. Design

### 4.1 Principle

Evidence is a host fact keyed by the **bytes on disk**. Gates hash the files themselves at gate time; they never trust
the model's prose, the model's commands, or a record of what the model said it wrote. A refusal is an ordinary tool
result the model reads and acts on.

Every gate is **inert unless the host binds its port** (§4.5). The web Brain and the parity harness bind none, so they
are unchanged.

### 4.2 Evidence ledger (pure)

New: `packages/run-guards/src/evidence/ledger.ts`. run-guards is already imported by `brain-embedded` and `agent-run`;
`clients/vscode` reaches it through its tsconfig alias (add the esbuild alias too).

```ts
export type CheckKind = "diagnostics" | "typecheck" | "test" | "guard";

export interface CheckRecord {
  kind: CheckKind;
  name: string;                 // "lsp", "pnpm --filter @builderforce/agent-tools typecheck", "check:source-package-graph"
  outcome: "pass" | "fail" | "unavailable";   // unavailable = no such check here, or it timed out (OD-3)
  exitCode: number | null;      // the process exit code the HOST captured; null for lsp/unavailable
  findings: readonly string[];  // ≤ 20 lines "path:line:col severity message (code)"
  at: number;                   // epoch ms, passed in (module stays clock-free)
}

export interface EvidenceLedger {
  record(absPath: string, contentHash: string, check: CheckRecord): void;
  /** Evidence recorded against exactly this content hash. */
  for(absPath: string, contentHash: string): readonly CheckRecord[];
  /** A write the run made: drops evidence for older hashes of this path (memory only — correctness never depends on it). */
  noteWrite(absPath: string): void;
}
export function createEvidenceLedger(): EvidenceLedger;
```

Rules:
- **Keys are absolute paths.** `edit_file` paths are workspace-relative; `git_commit` paths are repo-relative with a
  `repo` argument (`packages/agent-tools/src/git-tools.ts:443`). Normalise both through one helper.
- **Gates hash the bytes at gate time.** Files changed by sub-agents, `run_command`, `delete_file`, the human in the
  editor, or an earlier run are all handled the same way: hash now, look up evidence for that hash, run checks if none.
- **Deleted paths** need no checks of their own; the owning package's typecheck (which runs for any change in the package)
  covers what imported them.
- **Lifetime: one run.** The ledger lives on the run context (`BrainRunContext`) and is not persisted. A resumed run or
  the next run re-checks — cheap, because the host verifier caches results by `(absPath, hash, check name)` in process
  memory (one module, §4.4).

### 4.3 Gate decisions (pure)

New: `packages/run-guards/src/evidence/gates.ts`. All take facts, return a verdict, and do no I/O.

```ts
export type GateVerdict = { ok: true; unavailable: readonly string[] } | { ok: false; reason: string };

export interface EvidencePolicy {
  required: Readonly<Record<string, readonly CheckKind[]>>; // by extension, e.g. ".ts": ["diagnostics","typecheck","test"]
  newSourceNeedsTest: boolean;                              // a NEW source file must ship with a test in the same push
  checkTimeoutMs: number;                                   // per check; a timeout records "unavailable", never "pass"
}
export const DEFAULT_EVIDENCE_POLICY: EvidencePolicy;

export interface OutgoingFile { absPath: string; hash: string; isNew: boolean; deleted: boolean }

/** The push / pull-request gate — the real done gate (tickets close after a verified push). */
export function outgoingGate(files: readonly OutgoingFile[], ledger: EvidenceLedger, policy: EvidencePolicy): GateVerdict;

/** OD-1. */
export interface ReviewVerdict { reviewerModel: string; verdict: "approved" | "changes_requested"; diffHash: string; findings: readonly string[] }
export function reviewGate(review: ReviewVerdict | undefined, authorModels: readonly string[], currentDiffHash: string): GateVerdict;

/** Early feedback only — the outgoing gate is what actually holds. */
export function shellPublishHint(command: string): string | null;
```

- A required check passes when its `outcome` is `pass`. `unavailable` passes **and is reported** in the verdict's
  `unavailable` list so the approval prompt can say so (OD-3). `fail` refuses.
- `newSourceNeedsTest`: a new `x.ts(x)` needs a new or changed test file in the outgoing set whose name starts with `x.`
  (`x.test.ts`, `x.foo.test.ts`). **This, plus OD-1, is what catches chat #214's missing parameters** — a test that calls
  the code fails at runtime where the typecheck could not.
- `reason` names the file, the failing check and its first findings, and what to do:
  *"git_push refused: agent-runtime/extensions/a2a/src/inbound.ts is new and has no test in this push. Add
  inbound.test.ts covering it, commit, and push again — the host runs the checks."*
- `reviewGate` refuses when there is no review, the reviewer model is one of `authorModels`, the verdict is
  `changes_requested` (findings returned as the reason), or `diffHash` differs from `currentDiffHash`.
- **Move** `gitCommandPattern` from `brain-embedded/src/shipVerification.ts:85` into run-guards and update its importers
  (`selfReviewShip.ts`, `shipVerification.ts`). No re-export, no second copy.

**Ticket completion:** extend `brain-embedded/src/completionGuard.ts` `canCompleteTicket` (already enforced in
`callRunner.ts:147-161`) with one more condition: when the git port is bound, the run has no unpushed or uncommitted
changes that failed `outgoingGate`. Do not write a second done check.

### 4.4 Host ports

Added to the host request in `brain-embedded/src/runStore/runTypes.ts`, next to `needsConfirm`. All optional.

```ts
export interface VerifierPort {
  /** Fast tier, ≤ 3 s: language-server diagnostics for exactly these files. Null = unavailable on this host. */
  diagnostics(absPaths: readonly string[]): Promise<CheckRecord | null>;
  /** Full tier for these files: owning packages' typecheck + targeted tests + repo guards. Cached by (path, hash, check). */
  full(absPaths: readonly string[]): Promise<ReadonlyMap<string, readonly CheckRecord[]>>;
}

export interface GitPort {
  /** Files in commits not yet on the upstream (`git log @{u}..HEAD`, plus the HEAD tree's bytes for each path). */
  outgoing(repo: string): Promise<{ files: OutgoingFile[]; diffHash: string; baseBranch: boolean }>;
}
// diffHash = sha-256 of `git diff --binary <merge-base(@{u}, HEAD)>..HEAD`.

export interface ReviewerPort {
  /** OD-1: one review sub-run on a different model, given the diff and the evidence summary only. */
  review(input: { repo: string; diff: string; evidence: string; authorModels: readonly string[] }): Promise<ReviewVerdict | { refused: string }>;
}
```

**VSIX implementation** — new folder `clients/vscode/src/verify/`, one concern per file, none over ~200 lines:

- `pathDiagnostics.ts` — `vscode.workspace.openTextDocument` each path (not shown), wait for
  `onDidChangeDiagnostics` for that URI or 3 s, read `getDiagnostics`. Extract the line formatter from
  `prefetch/lspDiagnostics.ts` into a shared `formatDiagnostic()` used by both.
- `typecheck.ts` — `runSandboxVerify` with VSIX `VerifyShell`/`VerifySandbox` ports, its plan **filtered to typecheck
  scripts only**. The `VerifyShell` port runs through the same process runner the host uses for `run_command`, returning
  the real process exit code. On Windows it must launch `.cmd` shims (`pnpm.cmd`, `npm.cmd`); never a bare
  `child_process.spawn("pnpm")` without a shell.
- `targetedTests.ts` — for each changed `x.ts(x)`, co-located `x.test.ts(x)` / `x.*.test.ts(x)`; run only those files with
  the package's runner (`vitest run <files>` or `jest <files>`, read from its `test` script). Never the full suite.
- `repoGuards.ts` — if the owning project has `scripts/checks.manifest.mjs`, run `scripts/run-checks.mjs` with it.
- `cache.ts` — the one in-process cache keyed `(absPath, hash, checkName)`.
- `gitPort.ts`, `reviewerPort.ts` (§6 OD-1), `index.ts` composing them.

`clients/vscode` passes the three ports where it builds the Brain host request (find the existing `needsConfirm:`
assignment and add them beside it).

Known limit, stated in the refusal text when it applies: the fast tier only sees the edited file. Dependents in the same
package are covered by the full tier's package typecheck. Dependents in **other** packages are not checked; the reviewer
and CI remain the backstop.

### 4.5 Where each gate fires

| Point | Seam | What happens |
|---|---|---|
| After a successful `edit_file` / `write_file` | `callRunner.ts` result shaping (`:121-190`), before `trimToolResult` | `ledger.noteWrite`; `verifier.diagnostics([path])`; errors appended in the D7 `postEditNote` format. Advisory only. |
| `git_push` (base branch) and `open_pull_request` | `callPreflight.ts`, **after** routing (~72) and **before** the confirm gate (~163) — one call into new `brain-embedded/src/runStore/shipGates.ts` | `git.outgoing` → hash → `verifier.full` for files without evidence → `outgoingGate`; then `reviewer.review` → `reviewGate`. Refusal returns `{ ok:false, error: reason }` without asking the human. |
| `git_commit` | same | **No refusal.** Runs the full tier early on the committed paths so the push is fast, and returns failures as an advisory on the commit result. (Commits are local and reversible; the push is the act that leaves the machine.) |
| `run_command` (incl. `background: true`) | same | `shellPublishHint` adds an advisory pointing at `git_push`/`open_pull_request`. Not a refusal: the outgoing gate catches shell commits at push because it reads the real commits. |
| `builtin_reviews_record` with `complete` | same | Refused unless a `reviewGate`-approved review exists for the current diff; on pass the host attaches the reviewer and evidence summary to the payload. |
| Ticket → `done` | existing `completionGuard` in `callRunner.ts` | Extended per §4.3. |
| Approval prompt | `requestRunConfirm` | Pass the gate verdict through the confirm request (new optional `evidence` field); `describeTool` in `fileTools.ts` can't see it because it builds the label from args alone. The prompt then says "checks passed · reviewed by <model>" or "no checks could run for N files". |

`shipGates.ts` holds the orchestration; `callPreflight.ts` gains one call. A push to a non-base branch is not gated
(it can't land on main without a pull request, which is gated).

**Directive.** Edit only the Brain's `selfReviewShipDirective`: the host runs the checks and the reviewer at push, and a
refusal is expected feedback. Leave `VERIFY_STEP` (`packages/agent-tools/src/live-subagent-tools.ts:49`) and
`unshippedChangeNudge` unchanged — they are shared.

### 4.6 Plugin HTTP routes authenticate by default (agent-runtime)

Plugin authors must not be able to forget auth.
- `registerHttpHandler(handler, { auth?: "gateway" | "public" })`, default `"gateway"`, stored on the handler entry in
  `plugins/registry.ts` (and the equivalent in `plugins/http-registry.ts`).
- `createGatewayPluginRequestHandler` (`gateway/server/plugins-http.ts`) runs `authorizeGatewayConnect` before calling a
  `"gateway"` entry; a failed check moves on to the next entry, so a public webhook later in the list still answers.
  This is decided per entry because handlers carry no path.
- Classify every existing caller. A webhook may be `"public"` only if it verifies its own signature or token; record
  which check it uses in a comment at the registration. Any handler that has neither goes to the operator's local
  security file, not to source control.
- Opus review (auth).

### 4.7 Loop economics

| # | Change | Seam | Detail |
|---|---|---|---|
| B1 | Earlier readiness steer | new `readinessAdvisory` in `run-guards`, fed from `RunProgressGuard.noteTurnText`/`endTurn` (`progressGuard.ts`) | On the **first** unkept readiness claim, a one-off advisory on the next turn: *"You said you have what you need. Make the edit now; read only files you will change."* It does **not** trip the ladder; the ladder, `UNKEPT_READY_AT` and other signals are unchanged. |
| B2 | Outline-first reads | decision in `packages/tool-output-policy`; content from the existing `file_outline` executor | `read_file` without `offset`/`limit` on a file > 16,000 chars (the current cap) or > 300 lines returns the outline plus the first 40 lines and says how to request a range. New cost lever (next free `cN_` id, **rollout 100**, so it is on for the VSIX). Setting `builderforce.agent.outlineFirstReads` (boolean, default `true`, in `clients/vscode/package.json` `contributes.configuration`): at activation and on configuration change the extension sets/clears `process.env.COST_LEVER_<ID>=off`, which `deviceLeverOn` already reads. No call-site checks. |
| B3 | Several edits in one call | `packages/agent-tools/src/edit.ts` + the `edit_file` schema + the VSIX executor | `edit_file` also accepts `edits: [{ path, old_string, new_string, replace_all? }]` (≤ 20). All-or-nothing; on failure name the first edit that didn't match. Reuse `applyStringEdit`; return each file's excerpt. Single form unchanged. |
| B4 | Batching nudge | new advisory signal `serial_single_calls` in `run-guards` | After 2 consecutive turns that each made exactly one read-only call, the next turn's note says to batch independent calls. Advisory; never trips. |
| B5 | Host-derived progress line | `brain-embedded/src/run/brainTurnTail.ts` | One deterministic line per turn from the run's own trace: files changed so far, their check state, and what the push gate still needs (`3 files changed · 2 checked · push needs: test for inbound.ts`). No model cooperation, no new tool, `update_task_state` stays off. |
| B6 | Fold superseded reads | `@seanhogg/builderforce-memory/working` `buildWorkingTranscript` (repo `C:\code\agentic\builderforce-memory`) | When an edit/write to path P succeeds, earlier `read_file` results for P in the **model transcript** become `"(read of P superseded by the edit at step N — re-read if needed)"`. The trace keeps everything. Ships with the memory package's contract snapshot and a `regression:` test; bump and publish memory, then bump `brain-embedded`'s dependency. |
| B7 | Fold repeated narration | same | Assistant text *preceding tool calls* whose word-set overlap with the previous such text is ≥ 0.8 becomes `"(progress note)"`. Never a final answer or a turn without tool calls. Same tests and release. |
| B8 | "Tools advertised" counter | new module extracted from `brain-embedded/src/chatDiagnostics.ts` (987 lines — do not grow it) | Chat #216 reported 1 tool advertised per turn while 15+ distinct tools were called. Find what it measures, fix it in the extracted module, `regression:` test. |
| B9 | Ticket title from the real diff | `brain-embedded/src/runStore/runBackstops.ts` | Re-title "Code change (N files)" from the final changed-path count at ship. |

## 5. Sequence (VSIX)

```
edit_file x.ts            → callRunner: noteWrite; diagnostics([x.ts]) → "x.ts:52:9 error TS2345 …" on the result
edit_file x.ts (fix)      → diagnostics clean → no note
git_commit [x.ts]         → shipGates: full([x.ts]) → typecheck pass; advisory "x.ts is new: push needs x.test.ts"
write_file x.test.ts; git_commit [x.test.ts]
git_push (main)           → shipGates: git.outgoing → hashes → full() for x.test.ts → targeted test pass
                          → outgoingGate ok → reviewer.review (model ≠ author) → approved, diffHash matches
                          → confirm prompt "checks passed · reviewed by <model>" → push dispatches
                          → completeShippedTickets closes the ticket (existing)
```

## 6. Decisions (operator, 2026-11-08)

- **OD-1 Independent review — YES.** Before a base-branch push or a pull request, `ReviewerPort.review` runs one review
  sub-run through the existing sub-agent path (`clients/vscode/src/subagentTool.ts`; a child is a clone of the parent's
  catalog), handed the diff and the evidence summary only.
  - **Reviewer model:** the `builderforce.models.review` stage pin (`stageModels.ts`, the `verify` stage) if it is not one
    of the author models; otherwise the first model from the run's available models (stage/role pins, then the BYO
    catalog) that is not an author model; otherwise refuse with how to add one (a BYO account or a review-stage pin).
  - `changes_requested` returns the reviewer's findings to the author as the push's refusal.
  - `selfReviewShip.ts` keeps orchestrating review → commit → push → close; its review step calls the reviewer instead of
    the author recording its own verdict.
- **OD-2 Outline-first reads — ON by default, with a setting to turn it off** (B2).
- **OD-3 No verifier available — pass with `unavailable`**, shown in the approval prompt, never reported as verified.
  Timeouts count as `unavailable`. The OD-1 reviewer is still required.

## 7. Workstreams and done-checks

Order matters; each lands green alone. Each: implement → typecheck + the named tests only → fresh review over the diff →
fix → commit. **Opus review:** A1–A4 (gating, cross-package), A5 (OD-1), A6 (auth). Sonnet review for the rest.

| WS | Scope | Done when |
|---|---|---|
| **W0** Baseline | Replay chats #214 and #216 with `api/scripts/chat-replay-baseline.cjs` (journal replay, not the aggregate `telemetry-baseline.cjs`) | Numbers written into §8 |
| **A1** Ledger + gates | §4.2, §4.3; move `gitCommandPattern` | Unit tests for every verdict, including `regression: tsc piped through grep is not evidence`, `regression: new source without a test is refused (chat #214)`, `regression: a file changed by run_command is still checked at push`, `regression: reviewer on an author model is refused` |
| **A2** VSIX verifier | §4.4 `verify/*` | With a fake `vscode` and a temp package: diagnostics for an unopened file; failing script's exit code captured; plan filtered to typecheck; targeted tests only; Windows `.cmd` launch covered; timeout → `unavailable` |
| **A3** Post-edit diagnostics | §4.5 row 1 in `callRunner.ts` | `regression: hooks-in-map violation reported on the edit result (chat #216)` |
| **A4** Ship gates | `shipGates.ts`, the `callPreflight.ts` call, `completionGuard` extension, `requestRunConfirm` evidence field, ports in `runTypes.ts`, wiring in `clients/vscode` | New parity scenario `brain-embedded/src/run/parity/scenarios/gates.ts` that **binds fake ports** and replays #214: push refused (no test), `run_command "git commit && git push"` still refused at the next `git_push`, review `complete` refused without a reviewer, ticket `done` refused. Existing scenarios (`ends.ts`, `review.ts`, …) bind no ports and pass **unchanged** |
| **A5** Reviewer (OD-1) | `reviewerPort.ts` + `selfReviewShip.ts` review step | Same-model reviewer refused; diff changed after review refused; no second model → refusal with the "add a model" text; `changes_requested` findings reach the author |
| **A6** Plugin route auth | §4.6 | `regression: a plugin handler registered without "auth" rejects a request with no token`; `regression: a "public" webhook still answers`; every existing caller classified |
| **B1–B9** | §4.7 | One unit test each; B2, B3, B6, B7 each add a `regression:` test naming chat #216 |
| **W9** Measure | Replay #214 and #216 again | §8 targets met; results in §8 |

Rules:
- `callPreflight.ts`, `callRunner.ts`, `selfReviewShip.ts`, `chatDiagnostics.ts`, `runPrepared.ts` gain at most a call into
  the new modules. No new file over ~400 lines.
- Existing tests run unchanged; never edit an assertion to make a gate pass.
- Policy is data: `EvidencePolicy`, lever manifest entries, the advisory thresholds.
- Extension strings follow the extension's existing pattern; no frontend changes.
- Lockfiles: if a package's dependencies change, refresh every lockfile that carries it.

## 8. Success measures

| Measure | Baseline (W0) | Target |
|---|---|---|
| Base-branch pushes on the VSIX without passing (or reported-unavailable) evidence and a different-model review | unknown (live telemetry behind gates; measure at W9) | 0 |
| #214 replay: prompt tokens | 3,023,666 (measured, session = lifetime — #214 ran entirely on 2026-11-08; matches narrative 3.02M) | — |
| #214 replay: completion tokens | 33,643 (measured; matches narrative 33.6k) | — |
| #214 replay: prompt peak | 70,714 (measured, max single-call prompt) | — |
| #214 replay: turns (model steps) / code turns / exactly-one-edit turns | 70 turns / 10 edit turns / 1 exactly-one-edit turn (measured; narrative "69 turns" ≈ the 69 journaled code-role calls) | — |
| #214 replay: median tool calls per turn | 2 (measured, 70 active turns) | — |
| #214 replay: defects reaching main (missing params via a failing test, no tests) | 2 — git-verified at `4df6b756e`: `inbound.ts` calls `runEmbeddedAgent` without `timeoutMs`/`runId`; 6 new source files, 0 tests; plus unused `spawnSync`/`messageToText` | 0 |
| #216 replay: prompt tokens | session 4,109,351 (measured, 2026-11-08) — the plan phase alone was 2,083,188 ≈ narrative 2.08M; lifetime 16.4M after the chat kept re-running on 11-09 | ≤ 1.0M |
| #216 replay: completion tokens | session 32,241 (measured); lifetime 173,974 | — |
| #216 replay: prompt peak | 93,201 session (measured, ≈ narrative 93k); 107,847 lifetime | — |
| #216 replay: code turns for the same edits | 66 edit turns / 12 exactly-one-edit turns (measured, lifetime) — narrative 15 ≈ the 12 single-edit turns | ≤ 5 |
| #216 replay: median tool calls per turn | 2 (measured, 294 active turns) | — |
| Median tool calls per turn (VSIX, 7-day telemetry) | 2 (measured, 2026-11-03..2026-11-09, 3,788 active turns across 49 chats; replaces narrative ~1.5) | ≥ 2.5 |
| Readiness claims followed by ≥ 2 read-only turns | #216: 4 (measured, 7 claims) — narrative 3; #214: 0 | ≤ 1 |

> **W0 harness** (measured 2026-11-09): `api/scripts/chat-replay-baseline.cjs` — replays the VSIX
> `local-first-v3.journal` READ-ONLY and prints these §8 baselines. Chats identified by content
> fingerprint (the "#NNN" display number is not stored locally): **#214** = serverId 55221
> ("I see messages being sent back and forth between…", 2026-11-08T21:20Z, kimi-for-coding,
> names commits `4df6b756e`/`41b0ff264`); **#216** = serverId 56654 ("REview the Visualizer's Map,
> Graph, Tower, and 3D…", 2026-11-08T22:47Z, mentions `Towers.tsx` + the verbatim "mid-implementation
> across the four views" narration). "Session" = the chat's creation-day (UTC) window, matching when
> PRD 45 was written.
