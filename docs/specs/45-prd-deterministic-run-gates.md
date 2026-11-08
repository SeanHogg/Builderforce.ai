# PRD 45 — Deterministic run gates and loop economics

**Status:** Proposed · **Owner:** agent runtime · **Written:** 2026-11-08
**Surfaces:** VS Code (VSIX / Brain) first; the gate *decisions* are shared so on-prem and cloud bind the same rules.
**For:** the agent or engineer implementing this. Every claim below names the file it was verified in. Where something was
not verified, it says so. Read §3 before you touch code.

---

## 1. Why

Two VS Code sessions on 2026-11-08 show the agent shipping work that a deterministic check would have refused, and
spending most of its tokens re-sending context instead of working.

**Chat #214 ("A2A")** — `local/kimi-code/kimi-for-coding`, 69 turns, 3.02M prompt / 33.6k completion tokens.
It committed and pushed 900 lines to `main` (`41b0ff264`, `4df6b756e`) that contain:

- a call to `runEmbeddedAgent` missing the required `timeoutMs` and `runId`
  (`agent-runtime/src/agents/embedded-runner/run/params.ts`), hidden from `tsc` by a local `Record<string, unknown>` type;
- zero tests, unused code (`spawnSync`, `messageToText`), a header describing a surface that does not exist;
- a "typecheck passed" claim from `npx tsc --noEmit | grep … | head; echo DONE`, which exits 0 whatever `tsc` does;
- a self-recorded review (`builtin_reviews_record` → `complete`) and the ticket moved to `done`.

**Chat #216 ("Visualizer")** — 31 turns, 2.08M prompt / 18k completion tokens, prompt peak 93k.
- 16 planning turns reading ~30 whole files (5–18 KB each); it said "I have enough to act" three times and kept reading.
- 15 code turns with **one edit each**, every turn re-sending ~80k of prompt (~1.2M tokens for 11 edits).
- A 14 KB rewrite of `Towers.tsx` introduced a rules-of-hooks violation; it was caught only because one turn happened to be
  routed to a different model, and the file was then re-read and rewritten.
- Repeated narration every turn ("I'm mid-implementation across the four views… Continuing…").
- Ticket titled "Code change (1 file)" while ~8 files changed.

The model is not the fix. Any model will do this. **The host must decide what "verified", "reviewed" and "done" mean, from
checks it runs itself, and refuse side effects without them.** And the loop must stop paying a full prompt for every
single tool call.

## 2. Goals and non-goals

**Goals**

- G1. No `git_commit`, `git_push`, ticket→`done` or review→`complete` without host-recorded evidence for the changed files.
- G2. A broken edit is reported on the *edit's own result*, within seconds, not at commit time.
- G3. The model cannot manufacture evidence: only host-run checks count; a model's `run_command` never does.
- G4. Halve prompt tokens per unit of work on runs like #216 (measured, §8).
- G5. One set of gate decisions (pure modules) shared by every surface; surfaces only supply ports.

**Non-goals**

- Fixing the A2A extension itself (tracked separately in ROADMAP; it is the test case, not the scope).
- Judging *design* correctness (e.g. "this isn't really the A2A protocol"). That stays with review (§6, OD-1).
- Changing which model runs which role.
- Any frontend UI. Gate notes surface in existing tool results and approval prompts.

## 3. What exists today (verified — do not rebuild these)

| Piece | Where | State on the VSIX |
|---|---|---|
| Brain run composition | `brain-embedded/src/run/runPrepared.ts:76-89` | `modules: { compaction, model }` only — `finish` is the default hook with **no ports** |
| Brain run policy | `brain-embedded/src/run/webAdapter.ts:113` `brainRunPolicy` | `levers: []`, `verify: 'none'`, `approvalGates: []` (R10: gating belongs in the Brain **preflight**, not the kernel hook — read the comment there) |
| Brain preflight | `brain-embedded/src/run/brainPlatformTools.ts:99` | runs router, `ask_user`, `hand_off`, confirm gate, dedupe **before** dispatch — this is where VSIX gates go |
| Self-review ship flow | `brain-embedded/src/selfReviewShip.ts` | by design the agent reviews its own diff, commits and pushes; the approval prompt is the human's review. **Keep the flow; gate it on evidence.** |
| Ship evidence (post-push) | `brain-embedded/src/shipVerification.ts` | proves a push landed; `gitCommandPattern()` detects shell git verbs — reuse it |
| Finish gates (pure) | `packages/agent-run/src/policy/finish/gates.ts` | placeholder, source policy, CI, claim — ports bound only by `api/src/application/runtime/cloudAdapterHooks.ts:137` |
| In-run verify plan (pure) | `packages/agent-run/src/policy/verify/inRunVerify.ts` | selects `typecheck`/`test` scripts from package.json — **zero consumers** |
| Post-edit check D7 | `packages/agent-run/src/policy/guards/postEdit.ts` | behind lever `d7_deterministic_handlers`; off on the VSIX (`levers: []`) |
| Progress / readiness detector | `packages/run-guards/src/progressDetector.ts`, `readinessClaim.ts` | wired on the VSIX via `brain-embedded/src/runStore/progressGuard.ts` (device lever `a3_progress_detector`). `UNKEPT_READY_AT = 2`, trip threshold `unkept_ready: 4` → pauses with "Continue with guidance" (that is what chat #216 hit) |
| LSP diagnostics | `clients/vscode/src/prefetch/lspDiagnostics.ts` | reads diagnostics for **open** documents only |
| Repo guard runner | `scripts/run-checks.mjs` + `{api,frontend}/scripts/checks.manifest.mjs` | the one list of repo guards; concurrent; one exit contract |
| Tool result shaping | `packages/tool-output-policy` via `brain-embedded/src/toolResultBudget.ts` | pages `read_file` by line at the 6 KB budget; full results survive in the trace |
| Single-string edit | `packages/agent-tools/src/edit.ts` `applyStringEdit` | one `old_string → new_string` per call; returns a post-edit excerpt |
| Task state (C3) | `packages/agent-run/src/policy/tools/taskState.ts` | `update_task_state` with goal/decisions/filesTouched/nextStep; no checklist field. **Not verified** whether C3 is on for the VSIX — check `@builderforce/cost-levers` device defaults |

## 4. Design

### 4.1 Principle

Evidence is a **host fact**, keyed by file content. Gates read evidence; they never read the model's prose.
Every gate refusal is a normal tool result the model reads and corrects — never a crash, never a silent drop.

### 4.2 The evidence ledger (pure, shared)

New: `packages/run-guards/src/evidence/ledger.ts` (run-guards is already a dependency of both `brain-embedded` and
`agent-run`; no new package).

```ts
export type CheckKind = "diagnostics" | "typecheck" | "test" | "guard";

export interface CheckRecord {
  kind: CheckKind;
  /** What ran, e.g. "lsp", "pnpm --filter @builderforce/agent-tools typecheck", "check:source-package-graph". */
  name: string;
  /** Captured by the HOST process, never parsed from model-run shell output. */
  exitCode: number;
  /** ≤ 20 lines, each "path:line:col severity message (code)". */
  findings: readonly string[];
  at: number; // epoch ms, supplied by the caller (module stays clock-free)
}

export interface FileEvidence {
  path: string;          // repo-relative, forward slashes
  contentHash: string;   // sha-256 hex of the bytes the checks saw
  checks: readonly CheckRecord[];
}

export interface EvidenceLedger {
  /** A file changed: any evidence for an older hash is void. */
  noteWrite(path: string, contentHash: string): void;
  record(path: string, contentHash: string, check: CheckRecord): void;
  /** Evidence for the file's CURRENT hash only. */
  current(path: string): FileEvidence | undefined;
  snapshot(): readonly FileEvidence[];          // persisted with run state
}

export function createEvidenceLedger(resume?: readonly FileEvidence[]): EvidenceLedger;
```

Rules:
- `record` for a hash that isn't the file's latest `noteWrite` hash is dropped (stale check finishing late).
- The ledger is persisted alongside the run's existing guard state so a resumed run keeps its evidence
  (follow how `RunProgressGuard` state is persisted; do not add a table).

### 4.3 Gate decisions (pure, shared)

New: `packages/run-guards/src/evidence/gates.ts`.

```ts
export type GateVerdict = { ok: true } | { ok: false; reason: string; missing: readonly string[] };

export interface EvidencePolicy {
  /** Check kinds a code file needs, by extension. Data, not branches. */
  required: Readonly<Record<string, readonly CheckKind[]>>; // e.g. { ".ts": ["diagnostics","typecheck"], ".tsx": [...] }
  /** A NEW source file must arrive with a test file in the same change set. */
  newSourceNeedsTest: boolean;
}

export function commitGate(paths: readonly string[], newPaths: readonly string[], ledger: EvidenceLedger, policy: EvidencePolicy): GateVerdict;
export function pushGate(unpushed: readonly { sha: string; gated: boolean }[]): GateVerdict;
export function doneGate(changedPaths: readonly string[], ledger: EvidenceLedger, reviewRecorded: boolean, policy: EvidencePolicy): GateVerdict;
export function reviewCompleteGate(changedPaths: readonly string[], ledger: EvidenceLedger, policy: EvidencePolicy): GateVerdict;
export function shellBypass(command: string): GateVerdict; // refuses `git commit|push` via run_command
```

- A check "passes" when `exitCode === 0` and, for `diagnostics`, no `error` finding on that file.
- `reason` is the text the model reads. It must name the file, the failing check and the first findings, and say what
  to do: *"git_commit refused: Builderforce.ai/agent-runtime/extensions/a2a/src/inbound.ts has no passing typecheck
  (TS2345 at 52:9 …). Fix it, then commit again — the host re-runs the checks."*
- `shellBypass` uses `gitCommandPattern` from `shipVerification.ts`. Move that helper into run-guards and re-export it
  from its old path is **not** allowed (no duplicate) — move it and update both importers (`selfReviewShip.ts`,
  `shipVerification.ts`).

### 4.4 The verifier (host port)

Contract, in `packages/run-guards/src/evidence/verifier.ts` (types only):

```ts
export interface VerifierPort {
  /** Fast tier, ≤ 3 s: language-server diagnostics for exactly these files. */
  diagnostics(paths: readonly string[]): Promise<CheckRecord | null>;   // null = unavailable here
  /** Full tier: the owning package's scripts + targeted tests + the repo guards for these files. */
  full(paths: readonly string[]): Promise<readonly CheckRecord[]>;
}
```

VSIX implementation: new `clients/vscode/src/verify/` (one file per concern, none over ~200 lines):

- `pathDiagnostics.ts` — open each path with `vscode.workspace.openTextDocument` (not shown in an editor), wait for
  `vscode.languages.onDidChangeDiagnostics` for that URI or 3 s, then read `getDiagnostics`. Extract the line formatting
  from `prefetch/lspDiagnostics.ts` into a shared `formatDiagnostic()` and use it in both (no second copy).
- `packageScripts.ts` — finds the nearest `package.json` per path and asks `inRunVerify`'s plan which scripts to run
  (this is `inRunVerify`'s first consumer). Runs them with `child_process.spawn`, **no shell pipeline**, capturing the real
  exit code and the last 20 lines.
- `targetedTests.ts` — for each changed `x.ts(x)`, the co-located `x.test.ts(x)` / `x.*.test.ts(x)` if present; runs them
  with the package's runner (`vitest run <files>` or `jest <files>`, from the package's `test` script). Never the full suite.
- `repoGuards.ts` — if the owning project has `scripts/checks.manifest.mjs`, runs `scripts/run-checks.mjs` with it.
- `index.ts` — composes the four into `VerifierPort`.

The full tier runs at gate time, not per edit. Cache per (path, contentHash) through the ledger — a second gate on the
same bytes does not re-run anything.

### 4.5 Where each gate fires (VSIX)

All in a new `brain-embedded/src/run/shipGates.ts`, called from the existing preflight in `brainPlatformTools.ts`
(add one call there; do not grow that file's logic).

| Call | Before dispatch | On refusal |
|---|---|---|
| `edit_file` / `write_file` (after success) | `ledger.noteWrite`; then `verifier.diagnostics([path])`; failures appended to that call's result as one advisory note (reuse `withAdvisory`) | n/a — advisory only |
| `git_commit {paths}` | `verifier.full(paths)` for paths without current evidence → `commitGate` | tool result `{ ok:false, error: reason }` |
| `git_push` | `pushGate` over unpushed commits (a commit is `gated` iff made by a gated `git_commit` this run or matched by ledger evidence for every path in it) | same |
| `run_command` | `shellBypass(command)` | same, naming `git_commit` / `git_push` |
| `builtin_tasks_update {status:"done"}` | `doneGate` over the ticket's changed paths | same |
| `builtin_reviews_record {verdict:"complete"}` | `reviewCompleteGate`; on pass, the host **attaches** the evidence summary to the review payload | same |
| `finish` | bind `createFinishHook({ read, verify, scanPlaceholders })` in `runPrepared.ts` `modules` | existing finish-gate behaviour |

When `verifier.full` returns nothing usable (no package.json scripts, language server unavailable): the gate passes with
`evidence: "unavailable"` recorded, and the approval prompt for `git_commit`/`git_push` (`clients/vscode/src/fileTools.ts:146`)
says *"no checks could run for N files"*. It is never reported as verified. See OD-3.

Update `selfReviewShipDirective` to tell the model the commit runs checks for it and that a refusal is expected feedback —
and delete the instruction to run its own typecheck before committing, if present.

### 4.6 Safe by construction (agent-runtime gateway)

Plugin HTTP routes must be authenticated by default, so a plugin author cannot forget to. In the gateway's plugin
dispatch (`agent-runtime/src/gateway/server-http.ts`, the `handlePluginRequest` branch), authenticate **every** plugin HTTP
route with `authorizeGatewayConnect`, unless the registration declares `auth: "public"`. The operator has the detail of
why this is urgent (out of source control). Add `auth?: "gateway" | "public"`
(default `"gateway"`) to the plugin HTTP registration types in `agent-runtime/src/plugins/types.ts` / `registry.ts`.
Audit every existing `registerHttpHandler` / `registerHttpRoute` caller and mark the genuinely public ones (webhooks with
their own signature checks) `public` explicitly. This change touches auth — it gets the Opus review.

### 4.7 Loop economics

| # | Change | Where | Detail |
|---|---|---|---|
| B1 | Readiness steer earlier | `run-guards/src/progressDetector.ts` threshold table | On the **first** unkept readiness claim, steer (not pause): *"You said you have what you need. Make the edit now; read only files you will change."* Keep the pause at the existing trip threshold. Thresholds stay data. |
| B2 | Outline-first reads | `packages/tool-output-policy` (decision) + the VSIX `read_file` host (content) | `read_file` with no `offset`/`limit` on a file > 4 KB returns the file's outline (exported symbols with line ranges, from `@builderforce/agent-tools/symbols`) plus the first 40 lines, and says how to request a range. Behind a new cost lever `c8_outline_first_reads` in `@builderforce/cost-levers`, on by default for the VSIX. |
| B3 | Multi-edit in one call | `packages/agent-tools/src/edit.ts` + the edit tool schema | `edit_file` accepts `edits: [{ path, old_string, new_string, replace_all? }]` (up to 20) in addition to today's single form. Atomic: all apply or none; on failure the result names the first edit that didn't match. Reuse `applyStringEdit`; each file's excerpt is returned. Schema stays backward-compatible. |
| B4 | Batching nudge | `run-guards` new advisory signal `serial_single_calls` | After 2 consecutive turns that each made exactly one read-only call, the next turn's note says to batch independent calls. Advisory only; never trips. |
| B5 | Host-held checklist | `taskState.ts` | Add `plan?: { step: string; done: boolean }[]` (≤ 12 items, inside the existing 600-token cap). Rendered as one line in the per-turn tail: `Plan 3/7 ✓ — next: wire shape into Towers`. Confirm C3 is on for the VSIX; turn it on if not. |
| B6 | Fold superseded reads | the Brain fold (`brain-embedded/src/run/brainFold.ts`) | When `edit_file`/`write_file` on path P succeeds, earlier `read_file` results for P in the **model transcript** become `"(read of P superseded by the edit at turn N — re-read if needed)"`. The trace keeps the full result. |
| B7 | Fold repeated narration | same | Assistant text *preceding tool calls* whose word-set overlap with the previous turn's preceding text is ≥ 0.8 is replaced in the model transcript by `"(progress note)"`. Never touch a final answer or a turn without tool calls. |
| B8 | Diagnostics honesty | `brain-embedded/src/chatDiagnostics.ts` | Chat #216 reported **"1 advertised per turn"** while 15+ distinct tools were called. Find what the counter measures and fix it, with a regression test. |
| B9 | Ticket title from the real diff | wherever `tickets_from_delta` titles "Code change (N file)" | Re-title at ship time from the final changed-path count. |

## 5. Sequence (VSIX, one change)

```
model: edit_file x.ts            → host applies → ledger.noteWrite(x.ts, h1)
                                 → verifier.diagnostics([x.ts]) → error at 52:9
                                 → result + note "x.ts:52:9 error TS2345 …"
model: edit_file x.ts (fix)      → noteWrite(x.ts, h2) → diagnostics clean → no note
model: git_commit [x.ts]         → no full evidence for h2 → verifier.full([x.ts])
                                 → typecheck exit 0, x.test.ts missing for NEW file → commitGate refuses
model: write_file x.test.ts      → noteWrite → diagnostics clean
model: git_commit [x.ts, x.test.ts] → full([…]) → all pass → commit dispatches (approval prompt shows "checks passed")
model: git_push                  → pushGate: every commit gated → push dispatches
model: builtin_reviews_record complete → reviewCompleteGate passes → host attaches evidence summary
```

## 6. Open decisions (operator)

- **OD-1 Independent review on the VSIX.** Today the agent reviews its own diff (`selfReviewShip.ts`) and the approval
  prompt is the human review. Option A (recommended): before `git_push` to a base branch, run one review sub-run on a
  *different* model from the plan pool, handed the diff only; `complete` requires its approval. Option B: evidence-only
  plus the human prompt (this PRD's default until decided). Deterministic gates catch "doesn't compile / no tests";
  only a review catches "isn't really the protocol it claims".
- **OD-2 Outline-first default.** On by default for the VSIX (recommended) or opt-in.
- **OD-3 No verifier available.** Pass with `evidence: unavailable` shown in the approval prompt (recommended), or refuse.

## 7. Workstreams and done-checks

Do them in this order; each lands green on its own. Each is: implement → verify (typecheck + the named tests only) →
fresh review over the diff → fix → commit. A4–A6 and A7 get an Opus review (gating, auth, cross-package).

| WS | Scope | Done when |
|---|---|---|
| **W0** Baseline | Replay chats #214 and #216 with `api/scripts/telemetry-baseline.cjs`; record prompt tokens, turns, calls per turn | Numbers recorded in this PRD §8 |
| **A1** Ledger + gates | §4.2, §4.3 in run-guards; move `gitCommandPattern` | Unit tests for every gate verdict, incl. `regression: tsc piped through grep is not evidence`, `regression: stale check for old hash is dropped` |
| **A2** VSIX verifier | §4.4 | Tests with a fake `vscode` and a temp package: diagnostics for an unopened file; exit code from a failing script is captured; full suite never runs |
| **A3** Post-edit diagnostics | §4.5 row 1 | `regression: hooks-in-map violation reported on the edit result` (chat #216) |
| **A4** Side-effect gates | §4.5 rows 2–6 in `shipGates.ts` | New parity scenario `brain-embedded/src/run/parity/scenarios/gates.ts` replaying #214: commit refused for the missing-param file; `run_command "git commit …"` refused; review `complete` without evidence refused; ticket `done` refused. Existing parity scenarios (`ends.ts`, `review.ts`) pass **unchanged** |
| **A5** Finish ports | bind `createFinishHook` in `runPrepared.ts` | A finish with a placeholder stub is refused on the VSIX |
| **A6** Directive | `selfReviewShipDirective` text | Snapshot test updated with the new contract |
| **A7** Plugin route auth | §4.6 | `regression: a plugin route registered without "auth" rejects a request with no token`; every existing route classified |
| **B1–B9** | §4.7 | Each has one unit test; B2/B3/B6/B7 each have a `regression:` test naming chat #216 |
| **W9** Measure | Replay #214 and #216 again | §8 targets met; results added to §8 |

Rules for the implementer:
- Never grow `brainPlatformTools.ts`, `runPrepared.ts` or `selfReviewShip.ts` beyond a call into the new module.
- No file over ~400 lines; split instead.
- Tests that cover existing behaviour run unchanged; never edit an assertion to make a gate pass.
- Thresholds, required checks and lever defaults are data (`EvidencePolicy`, the detector table, `cost-levers`).
- No new user-facing frontend strings. Extension-side strings follow the extension's existing pattern.

## 8. Success measures

| Measure | Baseline (W0) | Target |
|---|---|---|
| Commits on the VSIX without passing evidence (or explicit `unavailable`) | — | 0 |
| #214 replay: defects reaching `git_push` (missing params, no tests) | 2 | 0 |
| #216 replay: prompt tokens | 2.08M | ≤ 1.0M |
| #216 replay: code turns for the same edits | 15 | ≤ 5 |
| Median tool calls per turn (VSIX, 7-day telemetry) | ~1.5 | ≥ 2.5 |
| Readiness claims followed by ≥ 2 read-only turns | 3 in #216 | ≤ 1 |
