# 🔨 Make — Build

> **Domain PRD — open work only.** Consolidated 2026-11-17 from the per-PRD specs that used to live in
> `docs/specs/NN-*.md`; every section was verified against the code that day. This file holds only
> what is left to build. Finished sections are archived word for word in `DONE.md` ("✅ RESOLVED 2026-11-17 — PRD NN:
> finished sections archived on consolidation"), with their § numbers kept, so a citation such as
> `PRD 38 §4.3` resolves to the `## PRD 38` section here (open) or to DONE.md (shipped).
> A gap in a PRD's numbering is a shipped section. Outstanding work is tracked in `ROADMAP.md` under **🔨 Make**.

**Holds:** Agent runs and the one kernel, cloud/IDE runtime, autonomous delivery, knowledge graph / packs / local-first, canvas runtimes and studio, previews, hosting and the customer app platform.

## Contents

- [PRD 09 — Cloud Agent Validation & Hardening](#prd-09--cloud-agent-validation--hardening)
- [PRD 23 — Manager PR Review, Acceptance Evidence, and Ticket Recovery](#prd-23--manager-pr-review-acceptance-evidence-and-ticket-recovery)
- [PRD 37 — Coordinated Role Participation & Execution Verification](#prd-37--coordinated-role-participation--execution-verification)
- [PRD 45 — Deterministic run gates and loop economics](#prd-45--deterministic-run-gates-and-loop-economics)
- [Agent framework registrations — legacy table contract step](#agent-framework-registrations--legacy-table-contract-step)
- [PRD 41 — Offline understanding and the run delta](#prd-41--offline-understanding-and-the-run-delta)
- [Design — Local-first closure: G03, G21 + G23, G27](#design--local-first-closure-g03-g21--g23-g27)
- [Design — Web, Rovr, and VSIX local-first architecture and batch sync review](#design--web-rovr-and-vsix-local-first-architecture-and-batch-sync-review)
- [Design — Deterministic knowledge index (LEANN-style)](#design--deterministic-knowledge-index-leann-style)
- [Design — Deterministic-first PreFetch](#design--deterministic-first-prefetch)
- [PRD 38 — The knowledge graph (any directory; code and docs first)](#prd-38--the-knowledge-graph-any-directory-code-and-docs-first)
- [PRD 43 — One 3D stage for every knowledge camera](#prd-43--one-3d-stage-for-every-knowledge-camera)
- [PRD 31 — Build, run and ship a real app on Builderforce](#prd-31--build-run-and-ship-a-real-app-on-builderforce)
- [PRD 18 — hired.video → Builderforce.ai port (Canvas runtimes and the Studio → Canvas port)](#prd-18--hiredvideo--builderforceai-port-canvas-runtimes-and-the-studio--canvas-port)

---

## PRD 09 — Cloud Agent Validation & Hardening

> Consolidated 2026-11-17 from `docs/specs/09-prd-cloud-agent-validation.md`. Verified against code 2026-11-17: Mostly built.
> Finished sections are archived in DONE.md ("PRD 09: finished sections archived on consolidation");
> section numbers are kept, so a gap in numbering is a shipped section.

### §2.2 Operator decisions (2026-11-08) — still binding

| Id | Decision |
|----|----------|
| E2 | The per-execution non-root container plus the egress allowlist is the command boundary. There is no command allowlist. The `/sandbox/fs` path guard (G3) is defence in depth UNDER this boundary. |
| E3 | No step cap on cloud runs. A runaway is bounded by the kernel failure-streak breaker, the stall ladder and the per-run spend cap. |
| D4 | A run with no bound repository is legitimate (research and docs deliverables). It ends with `pr_skipped: no_repository`; there is no `needs_host` status. |
| W9 | Full clone stays (agents need history). A repo-size ceiling with a clear error is required. |

### §3 Validation matrix
Each cell must produce a green run AND a reconstructable telemetry trail on the ONE cloud engine: Dispatch · Clone + branch · Produce file changes · Live steering mid-run · Cancellation · Finalize → push → PR (or `pr_skipped: no_repository`) · Teardown · Telemetry reconstructable. None is yet proven by a live run (needs §5).

### §4 Open gaps

1. **GAP-D2 (P0)** — The dispatch → `CloudRunnerDO` handoff has no assertion for a drop between "recorded" and "first tick". *Acceptance:* a start-timeout plus a test for the dropped-handoff race.
   **Remaining (verified 2026-11-17):**
   - The only start-timeout is the reaper's 15-min `QUEUED_DEADLINE_MS` (`api/src/application/runtime/staleExecutionReaper.ts:85`); no test drives the recorded-but-never-ticked race.
5. **GAP-W5 (P1)** — An empty-diff finalize must not open an empty PR. *Acceptance:* skip the PR and mark the execution `no_changes`.
   **Remaining (verified 2026-11-17):**
   - The PR is already skipped (`cloudFinalize.ts:94` opens only when `writtenPaths.size > 0`); the execution is not marked `no_changes` (0 hits).
6. **GAP-W6 (P1)** — PR open/update has no merge-base check. *Acceptance:* surface mergeability on the execution.
   **Remaining (verified 2026-11-17):**
   - Nothing in `api/src/application/runtime` reads mergeability; nearest PR code `openOrAdoptRunPr.ts`.
7. **GAP-W7 (P1)** — A revoked or expired provider token surfaces as a raw provider error. *Acceptance:* typed `provider_auth_failed` with a re-auth prompt.
   **Remaining (verified 2026-11-17):**
   - `repos/githubClient.ts:67` classifies 401/403 as `unauthorized` and `:131` retries an App token once; nothing maps that to a typed execution outcome or a re-auth prompt.
8. **GAP-W9 (P2)** — A huge repo can exhaust the sandbox. *Acceptance:* a repo-size ceiling checked before the clone, failing with a clear, typed error.
   **Remaining (verified 2026-11-17):**
   - `api/container/sandboxGit.mjs:169-186` clones full history with no size check.
9. **GAP-W10 (P1)** — `builderforce/task-<taskId>` has no collision handling if a human created that branch. *Acceptance:* detect and suffix, or refuse with a clear message.
   **Remaining (verified 2026-11-17):**
   - No collision check near `ticketBranchName` (`api/src/application/repos/commitFileAsPendingChange.ts`).
10. **GAP-W12 (P2)** — Assert the workspace lives outside the checkout so it can never be committed.
    **Remaining (verified 2026-11-17):**
    - Workspaces are per-execution dirs (`api/container/server.mjs:302-308`) but nothing asserts or tests it.
11. **GAP-D4 (P1)** — A run with no bound repository ends `pr_skipped: no_repository` (emitted by `cloudFinalize.ts`), never a failure and never `needs_host`. *Acceptance:* test for the no-repository terminal path.
    **Remaining (verified 2026-11-17):**
    - `cloudFinalize.ts:178-182,259-266` records a `pr_skipped` event with a free-text reason, and only when files were written; make the reason the typed `no_repository` on every no-repo run and add the test.
12. **GAP-E6 (P1)** — No model-selection validation up front. *Acceptance:* pre-flight model-entitlement check.
    **Remaining (verified 2026-11-17):**
    - `ENTITLEMENT_REFUSALS` (`dispatchCloudRun.ts:136`) has no model entitlement; `domain/tenant/premiumModelAccess.test.ts` has no source module.
18. **GAP-B1 (P0)** — Cloud execution uses tenant plan limits, not a per-cloud-agent ceiling. *Acceptance:* per-cloud-agent budget ceiling.
    **Remaining (verified 2026-11-17):**
    - The per-run spend cap exists (`agentIdentity/agentRunIdentity.ts:74-78`, `domain/containment/runLimits.ts`); a cumulative per-cloud-agent ceiling does not.
20. **GAP-G1 (P0)** — The isolation model (non-root container, egress allowlist, credentials in the Worker) must be documented as the operator-facing boundary and red-teamed. *Acceptance:* a documented isolation model plus a red-team checklist run against a deployed sandbox.
    **Remaining (verified 2026-11-17):**
    - No isolation doc in `docs/`. Egress allowlist is built but off: `SANDBOX_EGRESS_ENFORCE` (`sandbox/egressAllowlist.ts:20`) is unset in every `wrangler*.toml`; turn on after a live probe (raw TCP/DNS blocked, HTTPS via proxy to an allowed registry).
21. **GAP-V1 (P0)** — `pnpm qa:cloud-agents` (in `api/`) runs the offline suite; the §5 golden path is OPEN.
    **Remaining (verified 2026-11-17):**
    - No cloud-agent spec under `qa-e2e/tests`.

### §5 Golden-path E2E (the operator's self-validation button)

A scripted run under `qa-e2e/` that:

1. Creates a throwaway ticket bound to a sandbox repo (and a variant with no repository: expects `pr_skipped: no_repository`).
2. `POST /executions`; asserts dispatch and the tick loop starting (GAP-D2).
3. Asserts the clone and branch.
4. Waits for at least one `file.change`; asserts attribution to the cloud agent.
5. Sends a steering message mid-run and asserts it lands; then steers after completion and asserts a follow-up run starts.
6. Lets it finish; asserts PR opened or `no_changes` (GAP-W5).
7. Reconstructs the run from telemetry by `execution_id`; asserts ledger == snapshot.
8. Asserts workspace teardown, including a forced-cancel variant.

**Acceptance for GA:** every P0 gap closed, the §3 matrix all-green, and `pnpm qa:cloud-agents` passing three consecutive times.

---

## PRD 23 — Manager PR Review, Acceptance Evidence, and Ticket Recovery

> Consolidated 2026-11-17 from `docs/specs/23-prd-manager-pr-ticket-recovery.md`. Verified against code 2026-11-17: Mostly built (dry-run; not live).
> Finished sections are archived in DONE.md ("PRD 23: finished sections archived on consolidation");
> section numbers are kept, so a gap in numbering is a shipped section.

### §0 The rule
A ticket is not complete because an agent stopped, a PR exists, or a narrative says the work is done. It is complete only when the requested outcome is present, the change is verified, required reviewers have recorded evidence, and the PR has reached its policy-approved terminal state.

### §5.3 PRD and implementation accounting
3. A PR must not open when the run produced only a PRD or documentation unless the ticket is explicitly classified as documentation work.
5. Completion evidence distinguishes source, test, configuration, migration, and documentation changes.

**Remaining (verified 2026-11-17):**
- `api/src/application/runtime/cloudFinalize.ts:94` (via `openOrAdoptRunPr.ts`) opens a PR for any written path; route it through `delivery/deliverableEvidence.ts` `classifyDeliverablePaths` (already used by `manager/evaluateTicketReadiness.ts:209`).
- `deliverableEvidence.ts` knows none/docs_only/implementation only; add source/test/config/migration.
- Task PRDs live at `docs/specs/tasks/task-<id>.md` (`repos/commitPrdToRepo.ts:23`), not `specs/tasks/`.

### §5.4 Reconciliation must create work, not labels
| Classification | Required action |
|---|---|
| Shared infrastructure failure | Quarantine under one infrastructure incident; do not blame every PR |
| No check evidence / unlinked | Quarantine for human investigation |

**Remaining (verified 2026-11-17):**
- `reconciliation/prReconciliationService.ts:214-226` only journals `queue_infrastructure` / `quarantine_investigate`; no incident is opened and nothing groups shared failures.

### §5.5 Error recovery
- HTTP 401/403 credential failures open or update one credential incident and enter a cooldown.
- HTTP 429 honors provider reset/retry metadata and does not spend the entire dispatch ceiling on one ticket or model.
- Shared CI failures fan into one infrastructure repair item.
- A circuit breaker exposes `blocked_reason`, `next_retry_at`, and the operator action required.

**Remaining (verified 2026-11-17):**
- The cooldown exists (`reconciliation/githubCredentialCooldown.ts`); no credential incident (0 hits).
- `blockedReason`/`nextRetryAt` exist in manager triage (`manager/triageStage.ts`, `returnToImplementation.ts`) but not on the reconciliation/credential breaker.

### §7 Rollout sequence (steps 4–10 open)
4. Enable one canary Manager sweep with auto-merge and auto-close disabled.
5. Prove one green PR: reviewer dispatch → exact signoff → acceptance → merge → ticket close.
6. Process the green PRs.
7. Repair conflicted/failed PRs one stable head at a time.
8. Consolidate and close the high-confidence backlog candidates.
9. Resolve shared infrastructure failures once, then re-evaluate affected PRs.
10. Enable policy-approved merge/closure only after the dry-run and canary agree.

**Remaining (verified 2026-11-17):**
- Canary flag built (`manager/managerCanary.ts`), off everywhere; dispositions are computed nightly (`cronSweeps.ts:511`) and applied only via `POST /api/admin/backlog-dispositions/apply` (`backlogDispositionRoutes.ts`). Operator go-live decision.

### §8 Acceptance criteria (open)
- [ ] A PRD-only implementation run opens no PR.
- [ ] Internal PR state reconciles to GitHub with no stale-open surplus.
- [ ] Every non-Done ticket has a keep, close, consolidate, or quarantine disposition with evidence (computed; not yet applied).
- [ ] Manager canary completes one end-to-end PR/ticket lifecycle before project-wide enablement.

### §9 Out of scope (working rules)
- Merging red, conflicted, or unreviewed PRs merely to reduce the count.
- Marking abandoned work "Done" to improve completion metrics.
- Closing unlinked tickets because they are old.

---

## PRD 37 — Coordinated Role Participation & Execution Verification

> Consolidated 2026-11-17 from `docs/specs/37-prd-coordinated-role-participation.md`. Verified against code 2026-11-17: Shipped, three small gaps.
> Finished sections are archived in DONE.md ("PRD 37: finished sections archived on consolidation");
> section numbers are kept, so a gap in numbering is a shipped section.

### §5.10 Incident-management linkage — process-improvement loop
Aggregate accountability gaps across incidents (e.g. via the existing quality/DORA lenses) to answer "which stage's sign-offs correlate with incidents?". Feed durable findings into project memory / Evermind lessons so future runs of that ticket type tighten the gate.

**Remaining (verified 2026-11-17):**
- Per-ticket gaps exist (`api/src/application/kanban/accountabilityGaps.ts`) and incidents link implicated tickets (`incident/IncidentService.ts:599-615`); no cross-incident aggregation read model exists.

### §8 API + MCP surface
- MCP: add `kanban.handoff` (record a hand-off).

**Remaining (verified 2026-11-17):**
- `builtinMcpService.ts:3886-3894` has no `kanban.handoff`; hand-offs are emitted only by `manager/coordinateTicket.ts` (`ticket.handoff`). Build it or drop the requirement.

### §13 Phase 5 — convergence
Reconcile the task-status flow and `SwimlaneCoordinator`/`ticket_runs` around the manifest as the single source of truth.

**Remaining (verified 2026-11-17):**
- `swimlane/evaluateAutoRun.ts:801-885` routes `lifecycleManaged` boards through the Coordinator, but `swimlane/SwimlaneCoordinator.ts` / `ticket_runs` is still a separate engine.

---

## PRD 45 — Deterministic run gates and loop economics

> Consolidated 2026-11-17 from `docs/specs/45-prd-deterministic-run-gates.md` (and its triage log `45-triage-backlog-2026-11-13.md`). Verified against code 2026-11-17: Mostly built.
> Finished sections are archived in DONE.md ("PRD 45: finished sections archived on consolidation");
> section numbers are kept, so a gap in numbering is a shipped section.

### §4.5 Directive
Superseded 2026-11-19 by [PRD 48 §2](../../DONE.md) (shipped, archived in DONE.md): `selfReviewShipDirective` and `unshippedChangeNudge` are replaced by `shipDirective(policy)` / `shipNudge(policy)`, and the wording fix below lands there. `VERIFY_STEP` stays shared and unchanged.

**Remaining (verified 2026-11-17):**
- `brain-embedded/src/selfReviewShip.ts:56-58` still says "in this session YOU are its reviewer" and tells the author to record `builtin_reviews_record` `complete` itself, which `shipGates.ts:336` now refuses without an approved independent review (OD-1).

### §7 W9 Measure
Replay/measure #214 and #216 again; §8 targets met; results in §8.

### §8 Success measures (open targets)
| Measure | Target |
|---|---|
| #216: prompt tokens | ≤ 1.0M |
| #216: code turns for the same edits | ≤ 5 |
| Median tool calls per turn (VSIX, 7-day telemetry) | ≥ 2.5 |
| Readiness claims followed by ≥ 2 read-only turns | ≤ 1 |

A replay of the pre-gate journals re-derives the W0 baseline only; the targets are scored on a fresh post-gate run of the same task.

**Remaining (verified 2026-11-17):**
- No chat-scoped telemetry trace reader exists (triage item 6596): only the local-journal replay `api/scripts/chat-replay-baseline.cjs`. Either build the reader or score W9 with the replay script against a fresh post-gate run (6595).

---

## Agent framework registrations — legacy table contract step

> Consolidated 2026-11-17 from `docs/specs/agent-framework-registrations.md` (a reference doc; registrations are shipped). Only the contract step is open.

Do not drop `agents`, `skills`, or their old foreign-key columns until production contains no execution/dispatch row that lacks `agent_registration_id` and all released clients use `/api/agent-registrations`.

**Remaining (verified 2026-11-17):**
- Legacy routes return 410 with `Sunset: Wed, 31 Dec 2026` (`api/src/presentation/routes/agentRoutes.ts:18-36`); the drop migration (expand/contract push 2) is not written.

---

## PRD 41 — Offline understanding and the run delta

> Consolidated 2026-11-17 from `docs/specs/41-prd-offline-understanding-and-run-delta.md`. Verified against code 2026-11-17: Mostly built.
> Finished sections are archived in DONE.md ("PRD 41 — finished sections, archived 2026-11-17", plus the earlier PRD 41 entries of 2026-11-07/08/10); section numbers are kept, so a gap in numbering is a shipped section.
> Paths: `MEM` = `builderforce-memory/packages/memory/src`, `RD` = `Builderforce.ai/packages/run-delta/src`, `VS` = `Builderforce.ai/clients/vscode/src`.

### §A6 Packaged acceptance (extends G27)

The packaged VSIX is tested in a VS Code instance whose network namespace (Linux CI) or
firewall rule (Windows) denies all egress:

1. Fresh install, no secrets.
2. Open a fixture repo with about 2,000 files in 4 languages.
3. Assert:
   - L0–L3 complete;
   - the visualizer renders the graph;
   - one agent run completes on the bundled small local model fixture;
   - a run delta appears;
   - **zero requests reached any BuilderForce origin and zero reached npm**. Every attempt is
     counted by the host fetch guard and an OS-level socket counter.

This test is the gate for claiming offline in release notes.

**Remaining (verified 2026-11-17):**
- The harness exists (`qa-e2e/tests/vsix-offline-acceptance.spec.ts`, `qa-e2e/src/vsix-offline/{egress,launch,ns-listen}.ts`, d6ba59ae2) but no workflow runs it: `.github/workflows` has no `vsix-offline` / `offline-acceptance` job, so it gates nothing.
- No recorded passing run.

### §A7 The visualizer draws from the local projection — acceptance only

**Accept.**
- On a linked workspace of about 2,000 files, the map with network denied equals the map online: the same stations, lines and badge coverage, compared by a digest of the drawn model.
- With the API pinned to an older build, the map is unchanged.
- A review that hits a 429 on every sync request finishes, and the map opens.

**Remaining (verified 2026-11-17):**
- The replica stack and local drawing are built (`packages/agent-tools/src/knowledge/replicatedStore.ts`, `replicaPump.ts`; `VS/knowledge/knowledgeNotHere.ts`), but no drawn-model digest test with network denied exists (no `mapDigest`/`knowledgeLinkedDenied` test in `clients/vscode`).

### §B2 Change detection — targets

**Target:** a warm plan of the `agentic` tree in under 3 s; a cold plan in git under 30 s.

**Remaining (verified 2026-11-17):**
- Built (`MEM/knowledge/{contentHash,merkle,statManifest}.ts`); no perf test measures these targets.

### §B3 Extraction: one extractor per language, tree-sitter in Node hosts

- **Incremental parse.** Within an editing session, the extension keeps tree-sitter trees for
  open documents and applies `tree.edit()` on each change, so re-extracting a typed-in file
  costs only the edited region.
- **Grammar versions.** As built (WS4): the grammars come from ONE package, `tree-sitter-wasms`, so its
  version (with the `web-tree-sitter` runtime's) is every language's grammar version.
- **Threading.** The two builds of one grammar version must produce identical facts; the B8 oracle checks this.

**Remaining (verified 2026-11-17):**
- No `tree.edit()` incremental parse of open documents (no non-test `.edit(` in `packages/agent-tools/src/node-tree-sitter.ts` or `VS/knowledge`).
- WS4 (FileFacts v3 in `packages/agent-tools/src/knowledge/facts/fileFactsOf.ts`, `VS/knowledge/factIndex.ts`): finish the `FactIndex.restore()` candidate fix (`factIndex.restoreCandidates.test.ts`), then an Opus re-review (storage).
- `EXTRACTOR_VERSION = 7` (`MEM/knowledge/sources.ts:28`) is not released; release it in the next memory version and bump consumers.

### §B7 Analyzers — L3 tier residue

**Failure is recorded, never swallowed.** (built.) The L3 cache key includes the scope, and the result is cached in THE L3 result cache that the indexer's own L3 pass shares.

**Remaining (verified 2026-11-17):**
- L3 tier (`packages/agent-tools/src/delta/adapters/{l3Cache,sarifTools}.ts`, `VS/runDelta/l3*`): a tree-hash equality test, the `interrupted` label, checking the CodeQL flags against the docs, and a re-review.

### §B8 Determinism rules — rule 6, the oracle test

For a fixture repo and random sequences of edits, renames and deletes (property-based, seeded), the **canonical dump** of the store must be byte-identical across:
- the store after the incremental updates;
- a from-scratch build;
- a from-scratch build on a second OS in CI, with the fixture checked out with autocrlf on Windows.

This test gates every workstream in Part B.

**Remaining (verified 2026-11-17):**
- Single-OS oracles exist (`MEM/knowledge/rules/factGraph.oracle.test.ts`, `VS/knowledge/factIndex.oracle.test.ts`). No CI job compares the dump across Windows (autocrlf) and Linux over 500 seeded sequences.

### §B9 Consolidation: one understanding

- **`codebaseScan.ts` becomes a projection of the fact store.** `project-map.md`,
  `architecture.md` and `context.yaml` render from L0–L2 facts. `scan.json` and its
  whole-workspace `versionToken` are deleted. The narrative overview is an L4 query cached by
  the hash of its input facts.
- Its existing consumers (`setGroundingSummary`, `afterWorkspaceScan` →
  `workspaceFactsSync`) read the projection. Their tests run unchanged as the parity oracle.
- **`repo-map` stays the Worker host's extractor.** Its `FileFacts` shape converges on the
  B3 shape so a Worker-built graph and a VSIX-built graph differ only in the `extractor` tag.
  The VSIX stops importing repo-map's regex extract.

**Remaining (verified 2026-11-17):**
- Not started (WS5). `VS/codebaseScan.ts:262-270` still writes `scan.json` keyed by a whole-workspace `versionToken` (`:50`); the generated README (`:329`) still documents it.
- repo-map `FileFacts` convergence not done; `kind: 'consolidation'` has no producer.

### §B10 Who reads it

| Reader | Reads |
|---|---|
| Agent context pack / preSearch | L1–L2 facts. Deterministic answers ("where is X defined", "who calls X", "what layer") register as PREFETCH answer actions. |

**Remaining (verified 2026-11-17):**
- No PREFETCH answer action reads L1–L2 facts (nothing in `packages/prefetch/src`).

### §C1 / §C4 — contract size

**Remaining (verified 2026-11-17):**
- `RD/contract.ts` is 490 lines; split it (code-map cap ~400 lines).

### §C5 Dimension: Security (WS8)

The security dimension's rules, registries, taint-lite, capability delta, osv/gitleaks adapters, config rules and STRIDE template are on main (`RD/rules/*`, `RD/registry/stride.ts`, `packages/agent-tools/src/delta/adapters/{osv,gitleaks}.ts`); routes come from FileFacts through `RD/rules/support/routeDelta.ts:22`.

**Remaining (verified 2026-11-17):**
- Close the WS8 fix round: 3 taint fixes, 5 config false positives, 7 cleanups, `tagStride`, the `unsafeRegex` adjacent-quantifier case, the CORS test; then an Opus re-review (security).
- Done-check still unproven by a recorded run: a fixture that removes `requireAuth` from a route gives security `worse` with `guard-removed` and the route key in evidence.

### §C6–§C8 Performance, -ilities, quality (WS9)

Rules are on main (`RD/rules/{performance,ilities,quality}/`, `ioInLoop.ts`, `apiBreaking.ts`, `testSkipped.ts`, `matcherWeakened.ts`).

**Remaining (verified 2026-11-17):**
- Close the WS9 fix round: `namedPaths.ts` token caps (200 chars, 4 stars); H1, M2/M4, the M3 label; extract `plannedPathsOfRun` (absent); the LOW findings; a re-review.

### §C11 Presentation — telemetry

**Remaining (verified 2026-11-17):**
- `delta.card_opened` and `delta.finding_action` (§4 telemetry) are not emitted anywhere (`git grep` none); §10 "cards opened" and "Fix-with-agent clicks" cannot be measured without them.

### §C13 Narrative (optional)

If a model route exists, one call turns the canonical `RunDelta` (without code) into a short
paragraph, cached by `digest`. Rules:
- It is labelled "summary written by <model>".
- It may not contain a claim that is not traceable to a delta row. A post-check rejects text
  naming a file, rule or number not present in the delta.
- With no route, it is omitted.
- It never alters a verdict.

**Remaining (verified 2026-11-17):**
- Not built: nothing in `VS/runDelta` or `RD` produces a narrative.

### §C14 Where deltas are computed and stored — cloud runs and repository identity

- **Cloud runs.** The container sandbox executes the same `run-delta` package with the same
  analyzers. This is the ONE cloud runtime: the container is a sandbox, and the delta is a
  tool there. The result is attached to the run.

**Remaining (verified 2026-11-17):**
- `api/src/application/runDelta/persistCloudRunDelta.ts` (persistence half: R2 blob, rows, mirror record) exists but has NO caller; no cloud finalize path computes a delta in the sandbox.
- The server does not normalise repository identity on write: move `VS/repoIdentity.ts` into one shared source-only package and normalise `repository`, lifecycle `root` and `repos[]` in the API sync-apply path for run-delta, change-set and lifecycle kinds (write path only, operator decision 2026-11-10).
- Device lacks a board lifecycle-managed flag, so `VS/runDelta/releaseAuthority.ts:8` treats every board as managed; sync the flag to the device.

### §D3 Bayesian rule precision (replaces the fixed demotion threshold)

Each rule *r* has precision `θᵣ ~ Beta(α₀, β₀)`.
- **Prior.** Fitted by empirical Bayes (method of moments) across all rules of the same family and all consenting tenants.
- **Votes.** `finding-actioned` or `finding-waived` counts as a true positive (TP); `finding-marked-wrong` counts as a false positive (FP). Votes are counted **once per finding lineage, per voter**: the latest vote wins.
- **Posterior:** `θᵣ | data ~ Beta(α₀ + TP, β₀ + FP)`.
- **Demote** to `info` when the upper 90% credible bound falls below 0.6. **Restore** when the lower bound rises above 0.8.
- Per-repo posteriors shrink toward the global one.

**Remaining (verified 2026-11-17):**
- The maths is built (`RD/predict/rulePrecision.ts`) but only `RD/predict/ranking.ts` reads it. No vote source feeds it and no demotion is applied to findings in the engine or card.

### §D4 Calibration

A heuristic score *s* becomes a calibrated probability: Platt scaling below 1,000 labelled examples, isotonic regression at 1,000 or more. Quality is tracked with the Brier score, ECE (10 equal-mass bins) and reliability diagrams in the superadmin analytics. Every model is recalibrated when its ECE exceeds 0.05 on the trailing 30 days.

**Remaining (verified 2026-11-17):**
- `RD/predict/calibration.ts` is a library with no consumer; no model is calibrated in production and no reliability diagram exists.

### §D5 Run risk: just-in-time defect prediction

(Section text unchanged: D5.1 regularized logistic regression extending memory-engine `ml/classical/logistic.ts`, registered as `ml/tasks` `run_risk`, λ by rolling-origin CV; D5.2 top-3 explanations, person features never rendered; D5.3 replaces blast radius `v1` only when it beats `v1` on PR-AUC, Brier and effort-aware recall at 20% on ≥500 final-labelled runs, Popt reported; per-repo mixed-effects at ≥200 labels; digest-named canonical-JSON artifact; D5.4 Kaplan–Meier survival view per band.)

**Remaining (verified 2026-11-17):**
- Not started (WS18). No `run_risk` task, no `api/scripts/train-run-models.cjs`. *Blocker: needs at least 500 final WS16 labels.*

### §D7 Trends: statistical process control

Applied per repo and per metric in the trend view (C11.3): EWMA (λ = 0.2, `μ ± 3σ√(λ/(2 − λ))`), CUSUM (`k = 0.5σ`, `h = 5σ`), Bayesian online change-point detection (hazard 1/100). Each needs at least 20 runs of history and shows "learning baseline" before that. A signal is a trend annotation, with an optional notification. It is not a verdict.

**Remaining (verified 2026-11-17):**
- `RD/predict/spc.ts` is a library with no consumer; the trend view shows no annotations.

### §D8 Reliability growth: is the debt really going down?

Goel–Okumoto NHPP `μ(t) = a(1 − e^(−bt))`, fitted by maximum likelihood with a seeded bootstrap CI; shown only when the fit converges, ≥10 points and `b > 0`, else `not-applicable`.

**Remaining (verified 2026-11-17):**
- `RD/predict/reliabilityGrowth.ts` (with Chapman capture–recapture) has no consumer; no "≈ N undetected" prediction is produced for the Predicted block.

### §D10 What to look at first — D10.2 Similar past runs (k-NN)

- Uses standardized `RunFeatures` and Euclidean distance, `k = 10`, ties broken by `runId`, over final-labelled runs only.
- Renders as, for example, "7 of the 10 most similar runs needed no follow-up; 2 were reverted", with links to those runs.
- It needs at least 50 final-labelled runs in the repo, or in consenting tenants with the same language mix.

**Remaining (verified 2026-11-17):**
- `RD/predict/similarRuns.ts` and the `PredictedBlock.tsx:21,64` row exist, but no host produces a `similar-runs.outcomes` prediction (nothing in `VS/runDelta` or `frontend/src/components/runDelta`), and no `run_features` read-through feeds it.
- D10.1 exploration slots / inverse propensity weighting are not wired to click data.

### §D11 Presentation

The card gains a **Predicted** block under the verdict rows: risk; the outcome of similar runs; "≈ N undetected" per dimension; the count of unusual lines; an anomaly flag.

**Remaining (verified 2026-11-17):**
- The block is built (`packages/knowledge-graph-view/src/delta/PredictedBlock.tsx`) but only naturalness predictions reach it; risk (D5), similar runs (D10.2), undetected (D8) and anomaly have no producer.

### §D12 Model governance

- **Model cards.** Each model publishes a card: data window, n, tenants, metrics, known limits and intended use.
- **Drift.** PSI on each feature over 10 bins; PSI above 0.2 or ECE above 0.05 triggers recalibration; a failed recalibration disables the model (`model-disabled`).
- **Kill switch.** Per model, in the registry.
- **Audit.** Every prediction is logged with its model version and `inputDigest`, so any shown prediction can be replayed.
- **People.** People are scored only through D14, never as a side output of another model.

**Remaining (verified 2026-11-17):**
- No model cards or PSI drift found; lands with WS18.

### §D14 People scores for managers — D14.6 data-subject rights and D14.7 done-checks

- **Human scoring is off by default for enterprise plans** and on by default for others. Enabling it on an enterprise tenant shows a DPIA notice: lawful basis, purpose limited to coaching and capacity, and the works-council consultation the tenant owns.
- **Data-subject rights.**
  - A person can export their own scores, inputs and the audit rows about them (access).
  - On erasure, their person scores and person-feature values are deleted. Their identity in run roles is pseudonymized, so aggregate models are not invalidated. Audit rows keep the pseudonym.
- Every view of another person's score is audit-logged (viewer, subject, time). *As built: rows in `admin_audit_log` with event `person_score.viewed`, not a separate `person_score_views` table.*

**D14.7 Done-checks still open.**
- [ ] Erasure: after the person's erasure request, their scores and person features are gone and their run roles are pseudonymized.
- [ ] A manager cannot see a non-report's score (an RBAC test), and each view writes an audit row — confirm against `api/src/application/people/mayViewPersonScore.test.ts`.
- [ ] With the tenant setting off, every human-score endpoint returns 404 for that tenant. Agent scores are unaffected.

**Remaining (verified 2026-11-17):**
- Scoring, policy, routes and view are built (`api/src/application/people/{personScore,personScoreRead,mayViewPersonScore,teamPeopleScores}.ts`, `api/src/presentation/routes/personScoreRoutes.ts`, migration 1349, `frontend/src/components/teams/TeamPeopleView.tsx`).
- Missing: the DPIA notice on enable, the access/export path, and erasure with pseudonymisation (no `dpia`/`pseudonym` code in people modules).

### §7 Workstreams — open remainder

| WS | Open |
|---|---|
| WS4 | `FactIndex.restore()` fix, `factFindings`/vscode tsc against current memory, Opus re-review; `tree.edit()` incremental parse; release `EXTRACTOR_VERSION` 7 |
| WS5 | All of B9 |
| WS8 | Fix round + Opus re-review (C5) |
| WS9 | Fix round + re-review (C6–C8) |
| L3 tier | Tree-hash equality test, `interrupted` label, CodeQL flags, re-review |
| WS13 | Wire the A6 harness into CI as the offline release gate; cloud-run delta (C14) |
| WS17 | Wire D3 demotion, D4 calibration, D7 trend annotations and D8 undetected/growth into the card and trend view |
| WS18 | Blocked on ≥500 final labels (D5, D12) |
| WS21 | Similar-runs producer over `run_features`; IPW exploration |
| WS22 | DPIA notice, access/export, erasure + pseudonymisation |
| Ship | After WS4/WS8/WS9/L3 pass review: full typecheck of the run-delta family; split `RD/contract.ts`; a `release_notes` row (`new`); the Idea-to-Real post (Measure act); DONE.md moves |

The loop for every workstream: implement → verify (targeted typecheck, guards, the named test files) → review → fixes. Review goes to an **Opus** subagent where the WS table marks storage, security, migration, model governance or RBAC/privacy.

### §8 Done-checks — still open

**Part A**
- [ ] The packaged VSIX passes A6 with egress denied: zero BuilderForce and zero npm requests. The graph renders, a local-model run completes and a delta appears.

**Part B**
- [ ] Warm plan of the `agentic` tree takes under 3 s; cold plan in git under 30 s.
- [ ] Saving one file in a 16k-file tree: p95 under 200 ms to updated L1/L2 facts for that file. Global rules are skipped when the read fact kinds did not change (asserted by a trace test).
- [ ] Determinism oracle (B8.6): the `canonicalDump` of the incremental store equals the scratch build and equals a second OS (Windows with autocrlf), byte for byte, over 500 seeded edit sequences.
- [ ] `scan.json` and its version token are gone. `codebaseScan` tests pass unchanged against the projection.

**Part C**
- [ ] The same before/after on Windows and Linux CI gives the same `RunDelta.digest`.
- [ ] Static tier p95 under 10 s for runs touching 50 files or fewer on the `agentic` tree.

**Part D**
- [ ] The same features and model artifact give a byte-identical `Prediction` on Windows and Linux CI, offline.
- [ ] Rule precision: a rule with 3 votes is never demoted. A rule with 200 votes at 30% precision is demoted, and its per-repo posterior shrinks toward the global one — the maths is tested; the demotion is not applied anywhere yet.
- [ ] Risk model replaces `v1` only when it passes the D5.3 gate. The gate result is recorded in the model card.

### §10 Measure — still unmeasurable

**Remaining (verified 2026-11-17):**
- `offline.session`, `delta.card_opened` and `delta.finding_action` are not emitted, so Use and Value metrics and the 8-week kill condition cannot be evaluated.

### §11 Risks, §12 Operator decisions (working rules — kept)

§12 decisions 1–10 stand as written in the source (bundle analyzers; fact store in `.builderforce/cache/`; L0–L2 auto-index, L3 on demand only (2026-11-14); `health`/`evermind` on capability keys; C8.2 errors and `guard-removed` block autonomous finalization only; server tables with vectors; `engines.vscode ^1.101.0`; cross-tenant training opt-in, enterprise/paid default off; people scored only under D14; label windows 30 d / 7 d). The §11 risk table stands as written.

---

## Design — Local-first closure: G03, G21 + G23, G27

> Consolidated 2026-11-18 from `docs/design/local-first-closure-g03-g21-g23-g27.md`. Verified against code 2026-11-18: Mostly built. §1 (G03), §2 (G21 + G23), corrections C0–C9 and sequencing steps 1–3b shipped and are archived word for word in DONE.md ("Local-first closure: G03, G21 + G23, G27: finished sections archived on consolidation (2026-11-18)"); §3 (G27), its corrections C10–C11 and sequencing step 4 are open.

This design closes three ROADMAP › Local-first entries. Sources: the [Web, Rovr, and VSIX local-first architecture review](#design--web-rovr-and-vsix-local-first-architecture-and-batch-sync-review) below and [PRD 41 §B4](../../DONE.md) (archived).

### 3. G27: one scenario, three packaged drivers, the network denied at the OS

#### Today

- `packages/local-first/src/networkDenialScenario.ts` is already "one function for web, rovr,
  vsix", but it runs in-process [R14].
- `test-integration/runTests.ts` runs from source with `--disable-extensions`.
- The VS Code self-check runs once at activation, fetches `example.com`, and is not a command [R15].
- `fakeGateway.ts` fakes the LLM stream, not sync [R15].
- Web production is `next-on-pages` deployed with `wrangler deploy` [R16].
- Web has no production local record store: `bootLocalWorkManagement` is called only from tests
  [R16].
- There is no Rovr package job in CI [R17].

(Re-checked 2026-11-18: all still true. The self-check, `clients/vscode/src/networkDenialSelfCheck.ts:35-36`, now probes the sync push URL as well as `example.com`; it is still not a command. The web boot module `frontend/src/lib/localFirst/workManagementBoot.ts` exists but only tests import it.)

#### End state

**The scenario becomes a driver port** [R14]:

- `networkDenialScenario.ts` takes a `NetworkDenialDriver` with `boot`, `act` (create a local ticket
  and bind a chat), `restart`, `read`, `account` and `observed`.
- It asserts:
  - attempted = 0;
  - observed platform connections = 0;
  - the records survive a restart and present as `pending`;
  - after a grant against the fake sync server: one push and `synced`.
- The existing in-process use becomes one driver: the unit layer the three vitest files use. There
  is no second scenario file.

**Shared fake sync server.** `packages/local-first/src/acceptance/fakeSyncServer.ts` (Node `http`):

- It serves minimal `POST /api/sync/v1/push` and `pull`, recording every request.
- The same process also acts as the recording listener that platform hostnames resolve to.

**Network-account command** [R15]: `builderforce.diagnostics.networkAccount`.

- It is contributed and localized, and returns `platformRequestAccount()`.
- It shows the counts to a person who runs it.
- It is a real diagnostic, not a test hook.

**VS Code: the packaged VSIX** [R14][R15]. `test-integration/runTests.ts` gains a `--vsix <path>`
mode (same resolver, same cache):

1. Install the VSIX into a fresh `--extensions-dir`.
2. Launch without `--disable-extensions`, with a driver test extension whose `extensionDependencies`
   names the real extension.
3. The driver runs the scenario through real commands (local ticket create, chat bind,
   `diagnostics.networkAccount`).

In CI (Linux):

```
sudo unshare --net --mount -- sh -c 'ip link set lo up; mount --bind <hosts-file> /etc/hosts; exec sudo --preserve-env -u "$USER" xvfb-run -a node out-integration/runTests.cjs --vsix <path>'
```

- The temp hosts file resolves every platform hostname to 127.0.0.1, where the fake server records
  connections.
- VS Code itself is downloaded before the network is cut.

**Rovr: the packaged zip** [R17]:

- A CI job, `package-rovr`, runs `pnpm package` and uploads the zip.
- Playwright `launchPersistentContext` with `--load-extension=<unzipped>` and
  `--host-resolver-rules="MAP <platform hosts> 127.0.0.1:<recorder>"`, so the MV3 service worker's
  requests are observed too, not only the page's.
- The side panel opens as a tab at `chrome-extension://<id>/sidepanel.html`.
- Restart relaunches the same profile.

**Web: the production build** [R16]:

- Web local work is wired first (G05 web). `bootLocalWorkManagement` is booted through the same
  `next/dynamic` pattern as `PlatformPolicyBoot`.
- When the platform refuses, the existing ticket-create surface writes the local record and shows
  its presented status.
- The driver serves the `frontend-output` artifact with `wrangler dev --local`. Playwright uses
  `--host-resolver-rules` to the recorder, plus route recording for the page.

**CI.** Job `offline-acceptance`:

- It needs the VSIX artifact, `package-rovr` and the frontend build.
- It runs the three drivers.
- It is in the `needs:` of `publish-extension` and of `deploy-frontend` [R18].

#### Done-checks (G27)

- Each driver passes, and each fails on a deliberately injected platform request (a negative test).
- The scenario file is single.
- The CI gate is required by publish and deploy.

#### Rev 2 approval corrections for G27 (Opus, APPROVE WITH CHANGES). These override the sections above.

**C10 (G27 VS Code namespace command):**
```
sudo unshare --net --mount -- sh -c "ip link set lo up; sysctl -w net.ipv4.ip_unprivileged_port_start=0; mount --bind $HOSTS /etc/hosts; exec sudo -u $(id -un) env PATH=$PATH HOME=$HOME xvfb-run -a $(command -v node) out-integration/runTests.cjs --vsix $VSIX"
```
- The TCP recorder listens on :443 and :80 inside the namespace.
- The grant step points at the fake sync server through the API base setting
  (`http://127.0.0.1:<port>`), not through the hosts file.

**C11 (G27 Web).**
- A new localized route, `/[locale]/work/local`, renders with zero platform reads and boots
  `bootLocalWorkManagement` lazily on that route only.
- The driver serves `frontend-output` with `wrangler dev --local` and `frontend/wrangler.toml`.

#### Sequencing — the open step

| Step | Work | Depends on | Implementer | Review |
|---|---|---|---|---|
| 4 | G27 driver port, fake sync server, network command, VSIX `--vsix` mode, Rovr job + driver, Web local route + driver, CI gate | 3b | Sonnet | Sonnet |

**Remaining (verified 2026-11-18):**
- No driver port: `runNetworkDenialScenario(host: NetworkDenialHost)` (`packages/local-first/src/networkDenialScenario.ts:236-238`) still runs every host in-process; there is no `NetworkDenialDriver`.
- No `packages/local-first/src/acceptance/` folder, so no `fakeSyncServer.ts`.
- `builderforce.diagnostics.networkAccount` is not contributed in `clients/vscode/package.json`; `platformRequestAccount()` is read only by tests (`clients/vscode/src/deniedNetworkAcceptance.test.ts:112`, `networkDenialSelfCheck.test.ts`).
- No `--vsix` mode: `clients/vscode/test-integration/runTests.ts:95-99` still launches with `--disable-extensions`.
- A separate VSIX Playwright harness was built instead (`qa-e2e/tests/vsix-offline-acceptance.spec.ts`, its own egress recorder `qa-e2e/src/vsix-offline/egress.ts`, `ns-listen.mjs`). Either adopt it as the VSIX driver of the one scenario or retire it — not both.
- No `/[locale]/work/local` route (`frontend/src/app/[locale]/work/` absent); no production caller of `frontend/src/lib/localFirst/workManagementBoot.ts`.
- `.github/workflows/release.yml` has no `package-rovr` or `offline-acceptance` job; `publish-extension` needs only `[verify-extension, package-extension]` (`release.yml:372`) and `deploy-frontend` needs `[build-frontend, verify-frontend, verify-kernel]`.

---

## Design — Web, Rovr, and VSIX local-first architecture and batch sync review

> Consolidated 2026-11-18 from `docs/design/vsix-offline-first-architecture-review.md` (static review, 2026-10-18, with a follow-up status section the same day). Verified against code 2026-11-18: Mostly built. G01, G03, G06–G19, G21–G26 are built (VSIX durable store `clients/vscode/src/durableLocalFirstStore.ts`, sync routes `api/src/presentation/routes/syncRoutes.ts` at `/api/sync/v1`, named importers `api/src/application/sync/importers/*`, `installSyncCoordinator.ts`, `installRunRecovery.ts`); the 2026-10-18 baseline sections, the finished gap rows, delivery steps 1–5 and the implementation-status follow-up are archived word for word in DONE.md ("Web, Rovr, and VSIX local-first architecture and batch sync review: finished sections archived on consolidation (2026-11-18)"). Open: G02, G04 (chats across devices), G05, G20, G27, the shared offline memory scope, the residual API chatter (delivery step 6) and the acceptance gates. The recommendation and the target contracts stay here as reference.

### Recommendation (reference)

Inference and memory implementation scope: [Shared offline memory scope](#shared-offline-memory-scope--still-open) below. Reuse the existing `builderforce-inference` engines and `builderforce-memory` knowledge/cognition/retrieval components. Across all modalities, automatic generation prefers a compatible downloaded WebLLM model on usable WebGPU; local memory recall/cache can satisfy eligible requests first. Preserve explicit pins and workload requirements, coordinate GPU resources, and prohibit gateway fallback offline.

Make **Web, Rovr, and VSIX follow the same durable local-first application pattern**, with optional account sync independent of execution. This is a requirement for all three modalities, including Web domain editing. Retain the shared Brain loop, model transports, governance decisions, and outbox primitives. Add shared domain/application contracts, host-specific transactional local stores, and one versioned server sync protocol. Merely increasing queue delays or selecting a local model cannot provide the requested behavior.

Interpret “offline” as **no BuilderForce API connection**, as requested. Direct provider access, Git remotes, external MCP, and model downloads need separate capability policies; they are not automatically internet-free. A direct connected account can satisfy “no BuilderForce API” while still requiring internet. A fully disconnected run requires downloaded model assets or an installed local inference runtime. If none is available, expose setup requirements and keep the request local; never silently fall back to BuilderForce.

In every modality, default to local execution with account sync disabled. Signing in establishes an identity; an explicit Connect/Enable sync action starts account synchronization. Reconnection can resume previously enabled sync automatically. Internet connectivity alone must not enable sync. Connected mode should continue executing locally and synchronize in batches; permission to use gateway inference or cloud execution is a separate choice.

#### Common behavior across all modalities

Every supported domain operation follows the same path: presentation submits a command → shared application use case enforces domain rules → local transaction commits records and journal events → UI reads the local projection → optional sync imports/pulls account changes. Account connectivity must not select a different persistence implementation. All three use the same event identity, ownership, conflict, deduplication, import, and recovery semantics.

Host-specific capabilities remain explicit: VSIX has filesystem/Git tools, Rovr has tab/browser tools, and Web has browser workers and its available workspace tools. An unsupported capability returns a consistent capability result; it must not silently substitute a server operation. Shared architecture does not imply that every host can execute every tool.

| Concern | Shared requirement | Host-specific adapter |
|---|---|---|
| Persistence | Durable records plus atomic journal; same repository contracts | VSIX transactional host store; Web/Rovr IndexedDB |
| Execution | Shared application lifecycle and Brain engine; local history before network | Extension host, browser worker/page, side-panel lifecycle |
| Network policy | API-denied default; explicit sync and inference permissions | Host fetch/socket/frame/worker transport integration |
| Sync | One protocol/coordinator, destination binding, receipts, deltas, conflicts | VSIX process ownership; Web tab/worker lease; Rovr service-worker ownership |
| Offline startup | Installed assets and local data survive restart | Packaged extensions; Web service-worker/app-shell cache and versioned assets |
| Recovery | Interrupted execution is durable; unsafe actions never auto-replay | Host-specific suspension, shutdown, storage quota, and restart handling |

Web needs a cached executable application shell, routes, workers, localization, and already-installed model assets, in addition to IndexedDB domain storage. Initial website delivery/installation requires connectivity; subsequent offline startup must not depend on session validation, API-backed route loaders, redirects, or platform data fetches. Distinguish static application delivery from BuilderForce API access when measuring the zero-API contract. Browser storage eviction/quota and unavailable durable storage must be visible; an in-memory fallback cannot claim durable save.

### Gaps and required changes — still open

P0 blocks the requested offline contract or trustworthy synchronization. P1 is required for a complete, operable release. (Only the open rows are kept; the finished rows are in DONE.md.)

| ID | Priority | Observed gap / architectural risk | Required change |
|---|---|---|---|
| G02 | P0 | Requests originate from host API/auth/gateway clients, platform tools, webview fetch adapters, embedded frontend clients, streams, and meeting sockets. Gating only `bfApi` misses paths. | Enforce a shared platform transport policy before issuing requests, opening streams/sockets, or loading platform frames. Wire policy into host and webview; cover custom base URLs and redirects. |
| G04 | P0 | Server numeric IDs and positive/negative ID conventions are woven through run/UI contracts. Signed-out webview adapter even allocates positive in-memory chat IDs. | Introduce stable client entity UUIDs, independent internal run keys, and durable client-to-server mappings. Do not change a live run key when its record receives a server ID. Remap all relationships explicitly. |
| G05 | P0 | VSIX projects/tasks/objectives/session lists are API reads with short-lived memory caches. Task status/archive/delete and other CRUD remain remote operations. | Add durable local project/ticket repositories and local views with pending changes over the last synchronized snapshot. Support local project creation and later account/project binding. |
| G20 | P1 | Project memory/context, model pins/catalogs/analytics, limbic context, and insights still use platform reads. Fact publishing is best-effort and its latest digest is process-local. | Persist versioned snapshots; use local memory recall and local fact operations offline. Sync changed facts/outcomes in batches, with provenance and conflict handling. Move learning out of ordinary historical turn ingestion and dedupe it by completed run/policy. |
| G27 | P1 | Offline and sync behavior lack one cross-surface acceptance contract. Static review cannot establish actual production request volume. | Add network-denial and request-budget tests plus runtime request accounting. Test packaged assets, signed-in/signed-out entry points, and long-offline recovery across all three surfaces. |

**Remaining (verified 2026-11-18):**
- **G02.** The host `fetch` gate (`clients/vscode/src/platformPolicy.ts:79`, `classifyPlatformRequest`) and the webview realm's `fetch` + `WebSocket` gate (`clients/vscode/webview/src/platformPolicy.ts`, installed at `webview/src/main.tsx:35`, tested in `webview/src/platformPolicy.test.ts:65-136`) are built, and Web (`frontend/src/components/PlatformPolicyBoot.tsx`) and Rovr (`clients/chrome/src/background/serviceWorker.ts`, `clients/chrome/src/platform/guardedFetch.ts`) compose their policies. Still unclassified: `vscode` request APIs, child-process network, and the native meeting panel's own socket (`clients/vscode/src/meetings.ts:233` opens `new WebSocket(CFG.wsUrl)` in a separate webview without the gate; today it is reached only after the gated host `bfApi.joinMeeting` call, `meetings.ts:83`). Classify each or log it.
- **G04.** Stable client ids, mappings and the typed id rule shipped (`packages/local-first/src/entityId.ts`, [Typed entity ids](./platform.md#design--typed-entity-ids)). Open only for chats across devices: `isOwnRecord` (`packages/local-first/src/journalRules.ts:64`) filters other devices' records and `openableLocalChat` (`clients/vscode/src/sessionChats.ts:49`) does not pull the transcript. ROADMAP "VS Code chat history doesn't follow the person" (blocked on an operator decision).
- **G05.** Local repositories and the VSIX tree (`builderforce.localWork`, `clients/vscode/package.json:103`) exist, but three local ticket writers remain: `frontend/src/lib/localFirst/workManagement.ts` (320 lines), `packages/local-first/src/localWork.ts` (156), `clients/vscode/src/localTicketRepository.ts` (232). ROADMAP "Three local ticket writers".
- **G20.** `clients/vscode/src/cognition.ts:13` still recalls/remembers through `bfApi` (`recallProjectFacts`, `rememberProjectFact`); `brain-embedded/src/evermindMemory.ts:178,185` binds recall and answer to `/api/projects/:id/evermind/recall` and `/answer`.
- **G27.** See [Local-first closure §3](#3-g27-one-scenario-three-packaged-drivers-the-network-denied-at-the-os) above.

### Shared offline memory scope — still open

Folded from the supplementary review `offline-inference-and-memory-scope.md` (2026-10-18, static
review of `builderforce-inference`, `builderforce-memory` and this repo), which was then removed. Its
inference half (WebLLM-first ranking, GPU limits, model readiness, page-engine worker, distribution)
shipped with PRD 34 and the local-models work recorded in [DONE.md](../../DONE.md). The memory half
below is still open. **These gaps live in the `builderforce-memory` repository** (`packages/memory`,
`packages/memory-mcp`), plus the product bindings that call it; they are tracked in
[ROADMAP.md](../../ROADMAP.md) › Make › Local-first ("Offline memory, in builderforce-memory").

**Decision.** `builderforce-inference` owns inference engines; `builderforce-memory` owns local
knowledge, retrieval, cognition and memory-learning primitives. No modality implements its own engine,
fact reconciliation or retrieval. Memory and inference are integrated through narrow ports. A local
memory hit may satisfy an eligible request without loading an LLM. Today the product integration is
more remote-dependent than the package: VSIX `src/cognition.ts` routes recall/remember through
`bfApi`, and `brain-embedded/src/evermindMemory.ts` binds per-turn recall to the server. Those
bindings are replaced by shared local-memory services in every modality, with the server adapter
kept behind sync and explicit connected features.

| ID | Finding (2026-10-18) | Required scope |
|---|---|---|
| M03 | `MemoryEntry` has no account/tenant/project/repository/chat identity or server version; default database names are global to the origin. | Explicit scope values and partitions enforced by repositories, including personal and never-connected memory; scope preserved in snapshots and cache keys. Tags are not authorization. |
| M04 | No sync receipts, durable operation identity, base versions, conflict exchange or deletion tombstones. | Fact operations join the common sync protocol (G15/G18); evidence and base revision preserved; concurrent evidence conflicts stay explicit, not last-write-wins. |
| M05 | Cognition mutex/version/cache and `_writeSeq` are per instance; they cannot serialise tabs, windows, MCP processes or replicas. | Repository compare-and-set/transactions, durable revisions, locking where needed, cross-context invalidation. |
| M07 | SemanticCache L1 is process memory; remote L2 can be hit on every use; dense vectors/index are not persisted across restart. | Persist scoped answer cache/index with knowledge, embedding, model and tokenizer versions; remote L2 off when offline; rebuild derived indexes when a version changes. |
| M08 | Sessions fetch checkpoints/tokenizer URLs; `InferenceRouter` can pick a remote transformer bridge. | Offline asset resolver and explicit network capabilities for every memory path; no remote teacher, remote embeddings or automatic download when disconnected. |
| M09 | Local learning/checkpoint deltas exist, but no account-wide concurrent merge semantics. | Version base checkpoint, architecture, tokenizer, training config and contribution ids; sync experiences and immutable checkpoint manifests; never average weights or apply a delta to an incompatible base. |
| M10 | The memory package carries its own SSM/transformer router and graph facilities beside Brain's agent loop and local inference planner. | One execution owner: adapt memory hooks to the shared inference policy; no competing agent loop or fallback policy. |
| M11 | A recalled answer is not proof a current external action happened; Brain already restricts SSM generation on tool-capable runs. | Keep that guard locally; scope cache validity by knowledge/input/tool semantics; never satisfy a requested mutation with a cached action result. |

**Acceptance (memory).**

5. Each modality: a downloaded compatible WebLLM model is preferred when a usable GPU exists; no GPU,
   no assets, unfit tools or device loss produce the correct local alternative or a clear setup state;
   no API call is attempted; explicit pins obey policy.
6. Offline memory: remember/recall/forget and local model restoration survive restart; lexical recall
   works without a GPU; CPU semantic recall works with installed assets; GPU memory competes safely
   with generation; no network teacher or L2 leak.
7. Injected crashes, transaction aborts and concurrent writes across windows and MCP processes lose
   no acknowledged knowledge, recall nothing across scopes, resurrect no deletes, duplicate no
   learning, apply no incompatible checkpoint and evict no unsynced fact. Product restart and
   network-denial tests supplement the package unit tests.

**Remaining (verified 2026-11-18):**
- M01, M02 and M06 are built and archived (builderforce-memory `packages/memory/src/storage/{types,idbAdapter,nodeFileAdapter,fileTransaction,syncJournal}.ts`; `storage/factRetention.ts` evicts synced records only and purges TTL expiries through `deleteWithTombstone`).
- Partial: M03 (`memory/types.ts` `MemoryScope`, `storage/ScopedFactRepository.ts`), M04 (tombstones and the sync journal in `storage/factMutations.ts`; fact operations do not yet join the product's `/api/sync/v1` protocol), M05 (compare-and-set with `STORAGE_CONFLICT`, `ScopedFactRepository.ts:187-201`; no cross-context invalidation), M09.
- Open: M07 (`cache/SemanticCache.ts` L1 is still an in-process vector list with an injected remote L2), M08 (no offline asset resolver in `packages/memory/src`), M10 (the package still carries its own `agent/SSMAgent.ts` and `bridges/*`), M11.
- Product bindings still server-bound: `clients/vscode/src/cognition.ts:13`, `brain-embedded/src/evermindMemory.ts:178,185`. Acceptance 5–7 have no product-level test.

### API chatter inventory — still open

These are source-defined cadences, not measured production totals. They depend on authentication, focus, running work, configuration, and error state.

| Path | Current behavior | Offline-default / connected-batch target |
|---|---|---|
| Authentication / tenant exchange | Key probe, token exchange, refresh, workspace re-scope | Nothing offline. Authenticate once per enabled sync session; reuse valid tokens and coalesce refreshes. |
| Connection + assigned tasks | Startup calls; recurring 15-minute timer; focus can refresh assignments | Nothing offline. Include assignments in delta sync; connection state only when a connected feature needs it. |
| Attention | 10 seconds active, 60 seconds idle, 5 minutes background, plus focus/write refresh | Local run indicators from store; connected remote attention only when explicitly relevant. |
| Activity | Local 60-second heartbeat capture; batches of 25 or five minutes | Local capture may continue under product policy; upload only at permitted batch sync. |
| Brain turns / steps | Direct turn persistence plus per-chat step batching | All run writes local; background history batches independent of turn completion. |
| Tools / gates / context / model metadata | Per-run context; approximately 60-second tool/policy freshness; assorted model reads | Offline snapshots and local tools; refresh changed manifests during sync. |
| Sessions / trees | Session snapshot revalidates after 30 seconds when read; refreshes coalesce over two seconds | Read local projection; update it from delta sync. |
| Insights / meetings | Streams, reconnection, WebSockets and leave requests | Explicit connected features only. |
| Facts / outcomes / errors | Fact-by-fact publishing; outcome queue; opt-in error queue | Shared scheduling; changed records batched with domain-specific retention. |

Evidence: [activation timers](../../clients/vscode/src/extension.ts), [attention](../../clients/vscode/src/attention.ts), [activity](../../clients/vscode/src/activity.ts), [gateway](../../clients/vscode/src/gateway.ts), [insights](../../clients/vscode/src/insights.ts), [meetings](../../clients/vscode/src/meetings.ts), [errors](../../clients/vscode/src/errorReporter.ts).

#### Delivery sequence — the open step

6. **Remove residual chatter and ship with evidence.** Eliminate redundant pollers/refreshes in default mode; add sync operations UI, export/recovery, data retention, and request budgets. Reuse existing domain and outbox tests while adding failure-injection coverage.

**Remaining (verified 2026-11-18):**
- The cadences are still the 2026-10-18 ones: attention 10 s / 60 s / 5 min (`clients/vscode/src/attention.ts:178-182`); the 15-minute connection beat and assigned-task poll (`clients/vscode/src/extension.ts:807-816`). With the platform denied they are refused at the host fetch gate rather than not scheduled, and assignments are not part of delta sync.
- No request budget is enforced anywhere (no `requestBudget` in `clients/vscode/src`, `packages/local-first/src`).
- Sync operations UI shipped (`clients/vscode/src/sync/syncSummary.ts`); data retention for the server journal shipped (`api/src/application/maintenance/sweptTables.ts:602-607`).

### Proposed target contracts (reference)

#### Mandatory consolidation constraints: DRY, DDD, SOLID, and n-layer

These are acceptance requirements for the implementation, not optional cleanup. Consolidate responsibilities across the three modalities before adding another independent implementation. Share business semantics and application orchestration; retain distinct adapters where VS Code, browser storage, filesystem tools, and service-worker lifecycles differ.

Use explicit bounded contexts:

| Context | Owns | Boundary |
|---|---|---|
| Work management | Projects, tickets, hierarchy, status transitions, links, version/conflict rules | An execution references a ticket; it does not own the ticket aggregate |
| Execution | Run lifecycle, lineage, conversation events, tool activity, checkpoints, execution provenance | Inference and tool execution are ports; recording history cannot execute a command |
| Assurance | Audit definitions/versions, findings, evidence, report completion, remediation identity | Requests ticket creation through a work-management use case; does not manipulate its storage directly |
| Change evidence | Run-linked change sets, repository/base references, patch/blob manifests | Evidence import cannot apply code changes or pretend to push Git commits |
| Identity and governance | Destination bindings, offline policy snapshots, permissions, local authorization decisions | Domain policy consumes explicit identity/policy values, never reads tokens or UI selection |
| Synchronization | Delivery receipts, mappings, dependencies, cursors, reconciliation coordination | Calls owning contexts' import use cases; does not become a second owner of every domain's rules |

Treat these as logical boundaries first, not a mandate for one package, process, or service per row. Map onto existing modules and extract packages only where there is a demonstrated shared responsibility. Persistence/domain events remain versioned contracts owned by their context; do not expose database rows as public contracts or force unrelated aggregates into one generic entity shape.

The dependency rules are:

1. **Presentation:** React components, tree providers, native chat registration, and status UI render projections and submit application commands. They do not fetch platform data, choose sync destinations, implement retry, construct storage adapters, or decide business transitions.
2. **Application:** Focused use cases such as StartLocalRun, ChangeTicketStatus, CompleteLocalAudit, ImportRunHistory, and SynchronizeWorkspace coordinate domain behavior and narrow ports. Share applicable use cases across modalities; keep host-only lifecycle orchestration in its adapter/composition layer.
3. **Domain:** Pure aggregates, value objects, transition rules, audit/remediation identity, conflict rules, and domain events. No VS Code, Chrome, React, fetch, credential storage, SQL, IndexedDB, or filesystem imports. Domain events describe facts; they are distinct from transport envelopes and executable commands.
4. **Infrastructure:** Transactional local repositories, API repositories, credential providers, inference transports, blob stores, platform connectivity guard, and host lifecycle adapters implement ports defined inward. HTTP routes translate/authenticate requests and invoke application services; they do not own reconciliation policy.
5. **Composition roots:** Wire adapters once in VSIX activation, Rovr service-worker/panel startup, Web bootstrap, and API bootstrap. Inject dependencies; remove hidden mutable singletons that decide identity or initiate network work at import time.

Application services depend on consumer-specific interfaces: a ticket repository is not a global platform client, and a history importer is not a general remote command executor. Repository implementations must preserve the same domain semantics. Expose explicit transaction/unit-of-work support for local record plus journal commits rather than relying on call order between independent adapters. Shared sync orchestration must support host ownership leases and scheduling as injected capabilities.

Consolidation map:

- Reuse `brain-embedded` / `packages/agent-loop` for the existing shared execution engine and model protocol. Consolidate panel/native application wiring and remove their network-versus-memory persistence split. Keep UI and host bridge roles narrow.
- Keep `packages/local-inference` and shared model stream responsible for inference mechanics. Define inference permission/fallback policy once and supply it to all callers, including scanners and child runs. An explicit connection policy must supersede a cached route.
- Evolve `packages/write-outbox` as a delivery primitive with a hard permission gate and appropriate durability guarantees. Put domain import, entity mappings, and conflict rules above it, not inside a generic queue. Use a host-neutral sync coordinator for the actual shared protocol.
- Extract reusable record/journal application contracts from Rovr's local-first pattern into the shared layer. Implement VSIX and IndexedDB adapters against those contracts; do not make VSIX import Chrome application code or copy its record store.
- Extract audit definitions, pure finding validation/fingerprints, and report completion rules from server-only orchestration where needed. Keep server authorization, persistence, and remediation dispatch behind ports. Both offline and server workflows consume the same canonical rules.
- Replace scattered host/webview API access with injected transport adapters governed by the same platform policy. Share protocol and request semantics; preserve server authentication/authorization as the authoritative boundary.

Explicitly reject these antipatterns: a global `if (offline)` scattered through features; separate ticket/audit implementations per modality; a universal repository/service with unrelated methods; a sync engine that duplicates domain transitions; a generic MCP/HTTP command replay queue; UI-owned durable records; module-load network side effects; identity taken from current UI state during replay; dual writes without an atomic journal; last-write-wins for every conflict; silent eviction of unsynced user work; cache TTL used as correctness-level deduplication; and requiring the network to confirm a successful local operation.

Add focused architecture checks for prohibited dependency directions and direct platform network calls outside approved adapters. Validate shared repository contracts against both local and server adapters where their behavior overlaps. Test domain invariants and transaction/crash boundaries; do not add tests that merely mirror trivial implementation details. Migrate incrementally behind existing interfaces and remove the superseded path in each completed slice, avoiding permanent parallel implementations.

Dependency direction: presentation → application use cases → domain contracts; infrastructure supplies local storage, inference, and sync transports. Both VSIX chat surfaces use one application service. Web and Rovr consume the same domain/sync contracts with their own storage/lifecycle adapters.

```text
Web UI / Rovr panel / VSIX panel-native-board
                 |
        local application services
                 |
     transactional local domain store
       records + journal + sync receipts
          |                    |
   local Brain/tools     sync coordinator (opt-in)
          |                    |
 allowed inference       batch push + delta pull
                               |
                    existing account domain services
                               |
                  Web and Rovr account projections
```

Store at least projects, tickets and links, chats/messages, executions and lineage, tool events, local approvals, audit definitions/runs/findings, change sets, memory operations, attachment manifests, server mappings, policy snapshots, sync cursors, receipts, and conflicts. A transactional embedded database is a good VSIX candidate; validate extension-host/platform/remote-workspace packaging before choosing a driver. IndexedDB adapters fit browser hosts. Memento remains appropriate for small UI preferences.

#### The batch sync wire contract

The versioned batch endpoint (`POST /api/sync/v1/push`) accepts:

```text
batchId, protocolVersion, deviceId, events[]
event = eventId, clientEntityId, entityType, operation, schemaVersion,
        localSequence, occurredAt, baseVersion?, dependsOn[], payload
```

(Drift fixed 2026-11-18: the source called this endpoint "proposed, not existing". It exists: `SYNC_ROUTE_BASE = '/api/sync/v1'`, `api/src/presentation/routes/syncRoutes.ts:26,44,51`, mounted from `api/src/index.ts:129`.)

Tenant/user permissions come from authenticated server context and are checked per entity/project. Client-supplied identifiers never grant access. Stable origin/platform/account bindings remain local and are verified before sending. Large evidence blobs use content-addressed, resumable uploads referenced by manifests; avoid embedding them in JSON history batches.

Return per-event `accepted | duplicate | conflict | rejected | dependency_pending`, resulting server ID/version, and a durable receipt. The client acknowledges only committed items. Persist mappings and receipts before dropping journal entries; a crash after server commit must replay safely. Resolve client references within a batch; park dependent items rather than creating broken links. Distinguish retryable service failures from actionable permanent refusals and retain rejected user data.

A companion delta pull returns changed entities, tombstones, versioned configuration/policy manifests, and an opaque cursor. Bootstrap uses bounded snapshots; expired cursors require a resnapshot merged with pending local mutations. Pull before reconciling edits to existing account records, push local operations, then catch up server-generated results. Keep concurrency checks authoritative on the server because another client may write at any time.

Conflict policy should be domain-specific: immutable messages/events append with dedupe; independent fields may merge under defined rules; competing ticket status/assignment/description edits surface a conflict; deletes use tombstones; audit findings preserve source evidence and shared remediation fingerprints. Never overwrite newer account state by replaying a stale full object. Reuse existing audit remediation identity logic so local tickets and server-created remediations do not duplicate one another.

Suggested connected sync cadence: a configurable coarse interval plus run-completion debounce, byte/item thresholds, reconnect, and Sync now. Coalesce these triggers into one session. At 15-minute cadence an eight-hour connected session has roughly 32 scheduled opportunities, compared with roughly 480 idle attention polls at a one-minute cadence; neither figure includes paging, authentication, work, or errors. Optimize measured requests, rows, and bytes, not just timer counts. Do not generate empty sync traffic when neither backlog nor an explicitly enabled remote refresh requires it.

#### Standing decisions and caveats (from the 2026-10-18 follow-up)

- **FNV-1a payload hash.** `hashSyncPayload` is a non-cryptographic identity check shared with the client. It detects accidental replay differences, not a hostile payload swap. Do not treat it as an integrity proof. (Still true: `api/src/domain/sync/syncProtocol.ts:60-72`.)
- ~~Who may bind a destination the first time — any signed-in member, or an admin?~~ **Decided 2026-10-19:** any tenant member with write access to the project (tenant role `developer` or above) may bind it on first push; reading (pull) needs any membership. The tenant is always taken from auth, and a `projectId` must be the tenant's project before the destination key is built. One named policy, `mayBindSyncDestination` in `api/src/application/sync/syncDestination.ts`, so it can be tightened to admins in one place. (Still true: `syncDestination.ts:40`.)

### Acceptance gates — still open

- Run the same repository, application-use-case, sync, ownership, conflict, and historical-import contract suites against Web, Rovr, and VSIX adapters. Each modality must pass local create/edit/read/restart/sync scenarios for its supported capabilities; Web is not exempt from durable offline domain editing.
- After Web installation/asset caching, disable network and reopen the application: the real working shell, local records, supported tools, and installed inference assets load without API-dependent bootstrapping. Test browser storage loss/full/unavailable states and multiple-tab ownership. Apply equivalent restart/suspension scenarios to Rovr and VSIX.
- Fresh packaged VSIX with no account starts a supported local-model run, creates/edits tickets, runs a supported audit, records changes, restarts, and retains complete history. Offline mode makes zero attempted BuilderForce requests, including on startup, focus, errors, retries, token expiry, explicit queue flush, shutdown, and reconnect.
- A signed-in VSIX in offline mode has the same zero-request property. A missing model, closed WebGPU panel, failed direct credential, cloud pin, child run, scanner, or model failover cannot trigger gateway use. No-model setup explains the missing prerequisite locally.
- Offline policy also covers embedded project/canvas/Evermind pages, uploads, streams/sockets, diagnostics, auth probes, and configured custom gateways. Direct provider/Git/MCP access follows its separately declared policy.
- Kill the host after local commit, between record and queue work, during upload, after server commit but before acknowledgement, and during local receipt persistence. User work survives; external commands and mutations are not executed twice.
- Accumulate more than 1,000 events and remain disconnected longer than 24 hours. No unsynced domain record is evicted; later retry produces one server entity/effect per event. Storage-full and corruption failures are visible and exportable.
- Start work under A, switch to B, change project, sign out/restart, and enable sync. Records/mappings remain bound to A. Never-connected records require a chosen account/project destination. Test distinct accounts in the same tenant and distinct API installations.
- Web edits a ticket while VSIX edits it offline; sync preserves both changes or reports a resolvable conflict. Cover parent/child tickets, chat links, deletes, archived records, removed membership, policy expiry, and dependency failures.
- Import a completed run/audit: it appears across Web/Rovr/VSIX with original timing/provenance, one set of findings/remediations, and no new agent execution, shell command, cloud audit, stale mention notification, or duplicate learning.
- Parallel windows/tabs/workers cannot lose pending mutations or double-process receipts. Test remote extension hosts, multi-root repositories, browser suspension, cursor expiry, resnapshot, client/schema version skew, oversized evidence, and resumable uploads.
- Measure an authenticated idle editor, active local run, long-offline catch-up, and connected mixed-surface work. Report attempted requests by category, bytes, retries, and server writes; enforce agreed budgets. Do not infer these metrics from source comments.

**Remaining (verified 2026-11-18):**
- Unit and in-process acceptance layers exist per host (`clients/vscode/src/deniedNetworkAcceptance.test.ts` (mocks `vscode`), `clients/chrome/src/platform/deniedNetworkAcceptance.test.ts`, `frontend/src/lib/localFirst/deniedNetworkAcceptance.test.ts`, `packages/local-first/src/networkDenialScenario.ts`), plus the separate packaged-VSIX harness `qa-e2e/tests/vsix-offline-acceptance.spec.ts`, which no CI job runs.
- None of the gates above runs against a packaged artifact in CI; that is the G27 work in [Local-first closure §3](#3-g27-one-scenario-three-packaged-drivers-the-network-denied-at-the-os).
- No request-budget measurement exists (last gate).

---

## Design — Deterministic knowledge index (LEANN-style)

> Consolidated 2026-11-18 from `docs/design/deterministic-knowledge-index.md`. Verified against code 2026-11-18: Shipped except the items below. Lines 1–225 were archived word for word on 2026-11-17 ("Design: deterministic knowledge index — finished sections archived on consolidation"); done-checks 1, 2, 3, 5, 7, 8, the workstreams and the open decisions are archived on 2026-11-18 ("Deterministic knowledge index (LEANN-style): finished sections archived on consolidation (2026-11-18)").

### Consumers — memory recall

- **Memory recall.** `memory_recall` with a project or root scope, and `answerFromMemory`,
  consult the index with expansion before text recall.

**Remaining (verified 2026-11-18):**
- The `knowledge.ask` gate row runs ahead of `answerFromMemory` (`brain-embedded/src/runStore/runMemory.ts:105-107`), but builderforce-memory `packages/memory-mcp/src` never touches the knowledge index (0 hits for "knowledge"), so the `memory_recall` tool does not consult it. ROADMAP "`memory_recall` ignores the knowledge index".

### Done-checks — remaining

4. **Fast:** p50 ≤ 20 ms and p95 ≤ 60 ms on 50k cards, measured on CPU with the warm
   embedder cache. The exact tier answers in under 1 ms.
6. **Better:**
   - On code, recall@10 on a labelled set mined from our own runs (the files actually
     opened after a question) beats today's ripgrep + definition preSearch.
   - On docs, recall@10 with `expand` beats recall@10 without it on a fixture of linked
     specs.
   - Prefetch shows fewer exploration turns on the savings ledger.

**Remaining (verified 2026-11-18):**
- No 50k-card benchmark and no p50/p95 assertion in builderforce-memory `packages/memory/tests/` (`knowledge-index.{test,determinism.test,exact.test}.ts` cover determinism, lean mode (`determinism.test.ts:72`), exact mode (`exact.test.ts:45`) and storage).
- No labelled code recall set and no expand-vs-none docs fixture; no exploration-turn comparison on the savings ledger. ROADMAP "The knowledge index's speed and recall are unproven".

### Open decision 2 follow-up

2. **Desktop `bf-index`.**
   - Option (a), proposed: in this program, it gets the shared comparator and its search
     stays brute force; full parity is a follow-up register entry.
   - Option (b): port the graph index to Rust now.

Option (a) was taken; the follow-up is open.

**Remaining (verified 2026-11-18):**
- `builderforce-inference/crates/bf-index/src/index.rs:296-303` has the shared comparator (quantized score desc, then path, then id); `vector_candidates` is still a brute-force scan over every cached vector. ROADMAP "Desktop `bf-index` search is still brute force".

---

## Design — Deterministic-first PreFetch

> Consolidated 2026-11-18 from `docs/design/deterministic-prefetch.md`. Verified against code 2026-11-18: Shipped except two measurements. Lines 1–144 were archived word for word on 2026-11-17 ("Design: deterministic-first PreFetch — finished sections archived on consolidation"); done-checks 1–4, 7 and 8 are archived on 2026-11-18 ("Deterministic-first PreFetch: finished sections archived on consolidation (2026-11-18)").

### Done-checks — remaining (PreFetch)

5. PREFETCH output appears only in the volatile tail; the cache-hit probe stays at ≥ 90%
   on turn 2.
6. The gate adds ≤ 30 ms p50 when tier 3 is skipped and ≤ 300 ms p95 with tier 3.

**Remaining (verified 2026-11-18):**
- Check 5, first half, is met: `brain-embedded/src/runStore/prefetchGate.test.ts:57` ("PREFETCH output goes to the volatile tail, not the transcript"). The turn-2 cache-hit probe is missing: no test in `packages/prefetch/src` or `brain-embedded/src/runStore/prefetchGate*.test.ts` measures it.
- Check 6: no latency measurement (`p50` / `p95` appear nowhere in `packages/prefetch/src`).

---

## PRD 38 — The knowledge graph (any directory; code and docs first)

> Consolidated 2026-11-17 from `docs/specs/38-prd-knowledge-graph.md`. Verified against code 2026-11-17: Mostly built.
> Finished sections are archived in DONE.md ("PRD 38: finished sections archived on consolidation");
> section numbers are kept, so a gap in numbering is a shipped section.

### A knowledge review of the `agentic` workspace fails — acceptance

Do 1–4 are built (memory ^2026.10.82 everywhere, `preloadExtracted` + bulk route, 429/`Retry-After` retry, too-large skip, analyzer failures caught). `batched` on the remote client is obsolete: linked-project writes go through the replica's BFKP sync pack (PRD 41 A11).

**Accept.** The review of the `agentic` workspace finishes and the graph opens.

**Remaining (verified 2026-11-17):**
- Never recorded as passing in DONE.md or ROADMAP.md; nearest fix is DONE.md 2026-11-08 "a large root's review starts walking at once". Read the result from review telemetry (the review timings in `packages/knowledge-graph-view/src/reviewTimings.ts` / the output channel) rather than a manual rerun.

### The visualizer, Option B+: acceptance

1. On the `agentic` workspace:
   - At most 5% of files are drawn as "No partition".
   - The server's source count equals the local count.
   - Pasting a screenshot of the review progress card filters to `ReviewProgress.tsx` → `labels.ts` → `useReviewRun.ts` → the review runner.

**Remaining (verified 2026-11-17):**
- Unpartitioned files now fall back to their community (`packages/knowledge-graph-view/src/placement.ts:19-36`), but no check measures the "No partition" share or compares server vs local source counts. Make both an automated check over a reviewed graph.

### Predicted measures: deterministic ML over the graph

**Who owns what.** The shared maths and per-file predictions belong to PRD 41 › Part D (builderforce-memory `stats` module, D13). This section owns only the graph and map formulas (P1, P4, P7) and the badges the map shows from Part D's results.

**Rules for every formula below:**
- **Where it lives.** builderforce-memory `packages/memory/src/knowledge/`, pure functions with tests, calling `stats` for shared primitives.
- **When it runs.** Inside `buildGraph`, so the cut graph and the outline carry the result.
- **What the UI reads.** Builderforce only reads the result. The view never computes a prediction.
- **Determinism.** Same graph and history → same numbers; fixed iterations and seeded order.
- **Missing inputs.** The badge is absent and the channel reads "Not set up", never a guess.
- **Display.** Every rate or prediction shows its n and interval (Part D D3, D11). A 1-of-1 never reads as 100%; a sample under 10 renders as "≈ x% (a–b)".

#### P1, P4, P7: what is left

- **P1 accept.** At most 5% of files in "No partition" on the `agentic` workspace (the acceptance check above).
- **P4 accept.** On held-out commits, recall@8 ≥ 0.5 (memory `coChangeRecallAtK`).
- **P4 uses.** "Run checks" includes the partners' tests: a host must read `FixStepRequest.partnerTests`.
- **P7 traces.** P(j|i) reads reference weights only. *Blocker: there is no station-level source of recorded run traces.*

**Remaining (verified 2026-11-17):**
- P4 view surfaces (PartnerList, Hidden coupling, What changed, done-when) are committed (`7674bbd64`); `partnerTests` is produced (`surface/coChange.ts:54`, `fixPorts.ts:44`) but read by no host (`clients/vscode/src`, `packages/knowledge-browser/src`: 0 hits). Wire it into the host's Run checks step, or drop the field.
- P4 recall@8 has not been measured on the `agentic` history.
- P7: `transitionTableOf` (`surface/transitionTable.ts:36`) is called without sequences (`KnowledgeGraphView.tsx:151`, `drawers/SimulatePanel.tsx:39`). Blocked as above.
- `runDeltaPorts.churnAt` builds `gitHistoryPort(root)` with no `onWarn` (`clients/vscode/src/runDelta/runDeltaPorts.ts:46`), so commit-cap and timeout warnings are lost on that path.

#### P2. The map shows PRD 41's predictions as badges

| Part D result | Badge or area value | Where the map shows it |
|---|---|---|
| D5 defect risk (calibrated) | `risk`, `riskBand` | Calibrated quintiles of risk replace the hand-weighted w1–w5 heat ramp. Risk orders "What is wrong?" and the Act cards, and feeds the Coverage drawer's "test this first". |
| D2.1 change entropy and owner entropy, D15 | `ownerEntropy`, area `busFactor` | The owner channel, plus a "single owner" risk in "What is wrong?". The bus factor is the smallest number of authors covering 50% of a station's changes. |
| D3 shrunk rates | area coverage rate and its interval | Stations, the Coverage drawer, the API drawer's tested-response share, and the Measure section's kill-condition metrics. |
| D7, D8 trends and reliability growth | per-project series | The Measure headline ("debt goes down") reads as a forecast with a direction and a range. |
| D9 cost estimate | pre-review model-call estimate | The review launcher warns before starting when the estimate exceeds the budget. |

**Accept.** Every badge is absent when Part D has no result for that file, and the channel then reads "Not set up". The AUC/ECE thresholds are PRD 41's.

**Contract.**
- New badge keys go into `OUTLINE_BADGE_KEYS`: `risk`, `riskBand`, `ownerEntropy` (`community`, `communityConfidence`, `coChange` already shipped as `communityId`/`communityConfidence`/`coChange`).
- Area values carry `busFactor`, the shrunk coverage rate and its interval.
- Adding these is a memory minor release; Builderforce then bumps and moves the API cache key.

**Not in scope.** Training neural models, any per-request model call, sending repository history off the machine.

**Remaining (verified 2026-11-17):**
- `OUTLINE_BADGE_KEYS` (builderforce-memory `packages/memory/src/knowledge/outline.ts:18-26`) has no `risk`/`riskBand`/`ownerEntropy`; no `busFactor` anywhere in memory. *Blocker: PRD 41 Part D has produced no result yet.* (`modularity` already ships in graph stats, `build.ts:211-221`.)

### The data pack (later)

A pack for json, yaml and csv. It has no date.

**Remaining (verified 2026-11-17):**
- Not started: builderforce-memory `knowledge/packs/` holds only `docs.ts`; the code pack is `packages/agent-tools/src/knowledge/codePack.ts`.

### 7. Measure

- **Use.** Reviews and graph opens per host per week, by entry-point attribution. Folders reviewed, split by pack.
- **Value.**
  - The share of opens that act on a finding (Fix with agent or Add fact).
  - `knowledge.ask` answers with `skippedLlm` on the savings ledger.
  - Exploration turns avoided on questions about reviewed roots.
  - Code-pack violations, clone groups and unused counts per project over time. **The headline is that debt goes down.**
- **Cost.** Model calls and spend per review, by pack. Re-review cost compared with the first review (it should approach zero for unchanged folders). p95 of `GET /knowledge-graph` and the cache hit rate. Client layout time at 400 and 2000 nodes.
- **Kill condition.** After eight weeks, if fewer than 10% of opens act on a finding *and* `knowledge.ask` answers under 5% of questions about reviewed roots, cut back to the code pack's Structure, Partitions and Live, and drop the docs judgement pass.

**Remaining (verified 2026-11-17):**
- No instrumentation for opens, entry-point attribution or act-on-finding share: `rg "knowledge\.(open|opened|reviewed)|kg\.open|actOnFinding"` over `api/src`, `clients/vscode/src`, `packages/knowledge-graph-view/src`, `packages/knowledge-browser/src` → 0. The `knowledge.ask` `skippedLlm` savings row exists (gate ledger, `brain-embedded/src/localChat/gateLedger.ts`). The kill condition cannot be read until open/act events exist.

---

## PRD 43 — One 3D stage for every knowledge camera

> Consolidated 2026-11-17 from `docs/specs/43-prd-knowledge-3d-stage.md`. Verified against code 2026-11-17: Mostly built.
> Finished sections are archived in DONE.md ("PRD 43: finished sections archived on consolidation");
> section numbers are kept, so a gap in numbering is a shipped section.

Owner: the knowledge-graph view (`packages/knowledge-graph-view`). Every camera except List is already a placement of the one stage (`surface/cameras.tsx:31-42`); the `kg.stage` flag is gone. What is left is retirement, renderer details and the automated done-checks.

### Part A — still open

Structured-cloning the graph into the worker, and the JSON parse in `useKnowledgeGraph`, are synchronous on the main thread. Measure both on the harness graph. If either exceeds 50 ms, send bytes (the knowledge pack form) instead of objects.

**Remaining (verified 2026-11-17):**
- `compute/client.ts:208` still posts `entry.graph` as an object; no measurement recorded.

### B3. The renderer — remaining items

- The three.js chunk is prefetched on idle while the graph loads.
- Shaders are warmed with `renderer.compileAsync` when the stage mounts.
- `labelPlacement` gets a spatial grid (today it is O(n²)) before Graph uses it.

**Remaining (verified 2026-11-17):**
- `rg "compileAsync|import\('three'\)"` over `src` → 0.
- `surface/transit/labelPlacement.ts` is still the pairwise placer; no grid.

### B6. Long tasks in the worker

Worker tasks are chunked. The protocol carries **priority and cancel**, so an interactive task (a spec refinement after zoom settles, or a selection) jumps ahead of `insightsOf` or a layout.

**Remaining (verified 2026-11-17):**
- Cancel exists (`compute/protocol.ts:144`); there is no priority — `compute/workerHost.ts:6` runs tasks "first come first served".

### B8. Retired on parity — remaining

**Delete:**
- `graph2d/Graph2D.tsx`;
- `map/MindMap.tsx` and `map/MindBranches.tsx`;
- `surface/TransitMap.tsx`'s SVG body and the transit marks (`surface/transit/StationMark.tsx`, `TowerMark.tsx`, `TerminusMark.tsx`, `HopPath.tsx`, `DocLinks.tsx`);
- `useCardAnchor.ts`;
- `usePanZoom.ts` and `useSvgScale.ts`, when no camera uses them.

**Helpers that tests import** (`towerGeometry`, `byDepth`) move into the spec builders. **Keep:** the pure models (layouts, stations, lines, `labelPlacement`, `cardPlacement`, `sequenceModel`, `captionPlacement.ts`, `layout2d.ts`).

**Sequence and the path strip.** The strip shows the path's own stage marks (B1a rule 8) and the SVG sequence body is deleted.

**No WebGL** (including software rendering, via `failIfMajorPerformanceCaveat`): the List camera. Log a telemetry event so any future snapshot fallback is decided by data.

**Remaining (verified 2026-11-17):**
- Every file in the Delete list still exists and is imported only by tests and `src/perf` (`perf/viewSteps.ts:22` imports `byDepth`, `towerBox` from `TowerMark`).
- `surface/PathStrip.tsx:21,89` still renders the SVG `SequenceView` (`surface/SequenceDiagram.tsx`).
- No-WebGL → List works (`stage/host/StageHost.tsx:12`); `failIfMajorPerformanceCaveat` and the telemetry event are absent (`environment.ts:13` plain `getContext`).
- Refresh memory `knowledge-view-must-match-design.md:17`, which still describes the superseded `towerSprite`.

### Tests — test migration

Test migration is an exception to "consolidation tests run unchanged" (operator approved 2026-11-08, for this PRD only). SVG-structure assertions (`path[data-edge]`, `[data-describes-link]`, `animate`, `circle[r="17"]`, `[data-tower-part="shadow"]`, `[data-stub-colour]`, `g[data-id]`) are each rewritten as a spec-builder assertion of **the same fact**, with a migration table in the PR. Every non-structural test runs unchanged.

**Remaining (verified 2026-11-17):**
- Still on SVG: `surface/transit/marks.test.tsx`, `surface/transit/TowerMark.test.tsx`, `surface/transit/TransitMap.card.test.tsx`, `TransitMap.relayout.test.tsx`, `TransitMap.tower.test.tsx`, `graph2d/Graph2D.test.tsx`, `map/MindMap.test.tsx`. Migrate with the B8 deletion.

### Done checks (automated) — remaining

- **A Playwright run** on the synthetic harness graph, for every graph camera:
  - `PerformanceObserver('longtask')` records **no main-thread task > 50 ms** from graph load to first frame;
  - frame timing over a scripted pan, zoom, tilt and orbit holds **60 fps**;
  - first frame **≤ 1 s** after the graph arrives;
  - camera switch **≤ 300 ms**.
- **The design-match audit**: a fresh Opus audit with screenshots at DPR 1 and 2, both themes, 360 px wide, diffed region by region against the mockup (claude.ai artifact `BfKJSBrTVErwTd7w2Xz6fx`, page `#page-dcb81aee8d83`, read with the Artifact tool). Checks line colour/width/casing, radius-14 joins, 6 px lanes, dash patterns 9/7, 3/5, 2/5, 5/4 and 2.5 px walls, 1.5 px describes links, label halos and fonts, band alternation, the 360 px document scroll.
- **Retirement.** The B8 files are deleted; `rg "<svg" src/graph2d src/map src/surface/transit` finds no scene SVG (icons and legends exempt).

**Remaining (verified 2026-11-17):**
- No Playwright/`longtask` harness in the package (`src/perf` is vitest-only).
- `<svg` still in `graph2d/Graph2D.tsx` and `map/MindMap.tsx`.

### Re-extraction after a config change, and descriptor redaction (from ROADMAP)

Wire `moduleAliasesDigest()` as the caller `extractorKey` (memory ≥ 2026.10.72) on every run, including Continue (empty string = no key). The extract pool echoes the key it extracted under through `extractJob(job, packs, workerKey)`; a mismatch is rejected and the file stays owed. Deploy-descriptor section text uses an allow-list blank-out; layer `@builderforce/secret-redaction` patterns on top once agent-tools resolves it as a source package.

**Remaining (verified 2026-11-17):**
- `rg extractorKey` over `clients/vscode/src`, `packages/agent-tools/src`, `agent-runtime/src` → 0; `moduleAliasesDigest` (`packages/agent-tools/src/knowledge/moduleAliases.ts:267`) has no caller.
- Redaction layering not done.

### Deferred to the editing PRD (not built here)

The `stage/store.ts` edit model, delta-driven incremental layout, and the gesture → edit → reconcile pipeline. The slot-patch API (B3, B7) is what that PRD builds on.

---

## PRD 31 — Build, run and ship a real app on Builderforce

> Consolidated 2026-11-17 from `docs/specs/31-prd-customer-app-platform.md`. Verified against code 2026-11-17: Partly built.
> Finished sections are archived in DONE.md ("PRD 31: finished sections archived on consolidation");
> section numbers are kept, so a gap in numbering is a shipped section.
> Reference app: hired.video (`C:\code\hired\hired.video`) is the acceptance fixture only; it still ports under PRD 18.
> Relaxes Operator decision 3 / R5 ("no choice of host, no choice of database") for **paid** tenants only.

Three loops on existing seams, not a second platform:
1. **Run loop:** clone → install → dev server → live preview in the Builderforce UI → agent edits → HMR reload → verify → commit/PR.
2. **Ship loop:** blueprint → provision → build → migrate → deploy → domain, into the **customer's own cloud** (connected account) or **Builderforce's own infrastructure** (paid).
3. **Sell loop:** list a repo-connected project (web or mobile) → launch on its own domain or install on a phone → end users sign up in the app's own auth.

Everything an agent can do in these loops is also an **MCP tool** (§4.7).

### §2 Operator decisions (binding) and decisions still owed

Binding (2026-09-26): (1) hired.video still ports; (2) **paid tenants may choose host and database**, gated with `planFeatures`, never a hard-coded refusal; (3) customers connect their own Cloudflare / GCP / Azure / AWS account and Builderforce provisions into it; (4) the marketplace lists **mobile apps (Expo)** and repo-connected apps; (5) every step is an MCP tool plus self-contained components. D8 (decided 2026-11-17): W9 commits to Python, PHP, Rust and .NET, and Python also runs LLM training on WebGPU.

| # | Decision still owed | Blocks | Recommendation |
|---|---|---|---|
| D1 | Buy **Workers for Platforms** (dispatch namespace) | W5 | Yes. |
| D2 | Separate Enterprise `TenantPlan`? | pricing | No; two `PlanLimits` booleans `ownInfrastructure`, `hostedCompute`, true on PRO/TEAMS. |
| D3 | Neon project per app vs branch per app | W5 | A project per app, metered through the consumption meter. |
| D4 | Enable **Cloudflare for SaaS** + `CLOUDFLARE_ZONE_ID` / `CLOUDFLARE_SAAS_API_TOKEN` | domains, W5 | Yes. |
| D5 | Register the **GitHub App** | repo connect + secret push | Yes; code complete. |
| D6 | Container **instance type** for run loops | W1 | `standard` at least. |
| D7 | Browser run tier (W9) = free-plan run loop; container tier paid | W9 phase 5 gating | Yes. |

**Remaining (verified 2026-11-17):**
- D1, D3–D7 still owed. Neither `ownInfrastructure` nor `hostedCompute` exists in `planFeatures` (rg empty); no `instance_type` on `[[containers]] AgentContainerDO` (`api/wrangler.toml:160-164`).

### §3 Principles (do not relax)

- **Ports, not branches.** Each new axis is a port with adapters (shaped like `hostingStrategy.ts`, `gameTarget.ts`). A new cloud is an adapter; a new framework is a detector entry; a new listing delivery is contract data.
- **One blueprint, many targets.** What the app *is* is detected once into an `AppBlueprint`; run, provision, deploy and list all read it. No surface re-derives it.
- **A plan before an apply.** Provisioning is `plan` (a diff shown to the human) then `apply` (idempotent, recorded). Destructive ops are confirm-gated.
- **The ledger is the truth.** Every resource Builderforce creates is one row in one table, holding the external id and never the secret.
- **Secrets have no read path.** Values leave the vault only toward a runtime (container env, Worker secret, GitHub sealed box), never toward a UI or model.
- **The customer's cloud stays theirs.** Connected-account deploys are reproducible without Builderforce; generated workflow and IaC files stay committed in their repo.

### §4 W1: Run loop (container + live preview + agent), highest leverage

1. **Ship the image.** `wrangler deploy` builds `api/container/Dockerfile`. Verify Docker on the `release.yml deploy-api` runner, set `instance_type` (D6), pass `/health`.
2. **Image contents.** `corepack enable` as root (pnpm/yarn), bun, python3 + build-essential, `wrangler`, `expo` CLI caching. **No Docker-in-Docker** on Cloudflare Containers: a `docker compose` repo runs on the on-prem runner or a BYO-cloud host (W4). Say so in the UI.
3. **Install step before the dev server**, from the blueprint's `packageManager` + `install` (lockfile → npm ci / pnpm i --frozen-lockfile / yarn / bun), per workspace root when the repo has no workspace tool.
4. **Candidate selection** comes from the blueprint's `devCommands` (W2), not a hard-coded list.
5. **Multi-process dev.** e.g. `wrangler dev` **and** `vite dev`, with the SPA's `VITE_API_URL` pointed at the local Worker. The preview proxy exposes N named ports (`/__preview__/<service>/…`), not one fixed `PREVIEW_PORT`; the port map is chosen per run.
6. **Secrets and env into the run.** `loadProjectSecretValues` → `/run` spec `env` (container only; `redactSecretValues` on all tool output). Non-secret `vars` from the blueprint. Dev database = a **Neon branch per run** when the project has a connected Neon (W4).
8. **The loop closes.** Agent tools `preview_status`, `preview_restart`, `preview_logs` (dev-server tail) and `preview_screenshot` (Browser Rendering against the preview URL, reusing `webScreenshot.ts`). The finish gate gains "the declared `verify` commands ran green".
9. **Human in the loop.** A human edit or steering message during a live preview lands in the same container, so "user changes with the agent → sees it → continues" is one session.

**Acceptance:** a fork of hired.video connected to a PRO project runs `wrangler dev` + `vite dev` in a container; the SPA renders in `LivePreviewPanel` with login working against the local Worker and a Neon branch; an agent's React edit hot-reloads in the panel; the agent calls `preview_screenshot` to confirm it and opens a PR whose `verify` (tsc for api + frontend) ran green in the container.

**Remaining (verified 2026-11-17):**
- W1.1: container declared with `instance_type = "standard-1"` (D6); live preview is off (`PREVIEW_INGRESS_ENABLED` unset — ROADMAP "Live container preview off").
- W1.2: `api/container/Dockerfile:7-13` installs only git/ca-certificates/bash/sudo on `node:24-bookworm-slim`.
- W1.3: install is hard-coded `npm install --prefer-offline` (`api/src/application/runtime/previewDevServer.ts:229`); not blueprint-driven, not lockfile-aware, single root.
- W1.4: the generated-Vite-marker bug is fixed (`previewDevServer.ts:238` keys on the user's `VITE_CONFIG_FILES`), but candidates remain a hard-coded list (`:230-240`) and `application/runtime` never reads the blueprint.
- W1.5: single `PREVIEW_PORT` (`api/container/server.mjs:82`); no named-service ports.
- W1.6: secrets reach the env (`previewDevServer.ts:225-226`); no blueprint `vars`, no Neon branch per run.
- W1.8: none of the four `preview_*` tools exists (rg empty); no verify-commands finish gate.
- W1.9: not demonstrated end to end; depends on W1.1.
- (W1.7 `LivePreviewPanel` is shipped — `frontend/src/components/preview/LivePreviewPanel.tsx`, mounted at `AgentExecutionPanel.tsx:969`, `ProjectAppPanel.tsx:103`; its service tabs fill in once W1.5 lands.)

### §4 W2: `AppBlueprint`, one detection of what the app is

- **Detectors are a registry** (`packages/app-detect/src/detectors/*`, moved from the API on 2026-11-19 for W11 so the VSIX and the web app can detect locally), each a pure function over a repo file listing plus a few file reads, **cached by commit SHA with `getOrSetCached`**. `wrangler.toml` / `wrangler.jsonc` needs a real TOML parser (`smol-toml`, zero-dep).
- **UI:** a blueprint card on the project page showing services, bindings and the database, plus "N secrets missing" (names from the blueprint minus names in `project_secrets`).

**Acceptance:** hired.video is detected as 2 services, the bindings in its `wrangler.toml` (3 DOs, R2, KV, AI, cron `*/5`), Neon Postgres with `drizzle push` + `run-sql-migrations.mjs` + seed, and the secret names from `wrangler.toml` comments + `.env.example`, with no `builderforce.json`.

**Remaining (verified 2026-11-17):**
- `detectors/wranglerDetector.ts:39-102` parses TOML with regexes that match only inline `x = [ … ]` arrays; hired.video declares `[[r2_buckets]]`, `[[kv_namespaces]]`, `[[durable_objects.bindings]]` (`hired.video/api/wrangler.toml:58,71,96`), so the acceptance detects 0 DOs/R2/KV. The AI binding test `content.includes('ai')` (`:85`) is a false positive on any file containing "ai". Replace with `smol-toml`.
- No `getOrSetCached` by commit SHA in `application/blueprint` (rg empty).
- No blueprint card / "N secrets missing" in `frontend/src` (rg empty).

### §4 W3: Cloud connections (the customer's own account)

- **Reuse:** `connector_connections` (sealed) + `providerOAuthConnect.ts`. Extend the existing `cloudflare` manifest; don't add a sibling.
- **Providers:** **Cloudflare** scoped API token (Workers Scripts, R2, KV, D1, Queues, Zone DNS, Workers Routes edit) validated with `/user/tokens/verify` plus a scope probe; Cloudflare OAuth when available. **Neon** API key. **GCP** OAuth `cloud-platform` or Workload Identity Federation. **Azure** ARM OAuth `management.azure.com` or a service principal. **AWS** IAM role with an external id via STS — no long-lived keys stored. **GitHub** App (D5) for repo-secret writes.
- Each connection records **verified capabilities**. The provision planner refuses up front with the missing scope named, never halfway through an apply.
- **UI:** a "Cloud accounts" group on the existing integrations surface, not a new page.

**Remaining (verified 2026-11-17):**
- Manifests exist for `cloudflare`, `gcp`, `azure`, `aws` (`api/src/application/connectors/defaults/devtools.ts:213,319,363,407`) but take pasted bearer/api-key tokens: no token verify, no scope probe, no recorded capabilities, no GCP OAuth/WIF, no Azure OAuth, no AWS STS role.
- No Neon API connection (Neon exists only as a Postgres data provider, `integrations/dataProviderCatalog.ts:781`).
- GitHub App unregistered (D5); no "Cloud accounts" group.

### §4 W4: Provisioning, the `InfraProvider` port + ledger

- **Port** (`application/infra/infraProvider.ts`): `capabilities()`, `plan(blueprint, target, ledger) → ProvisionPlan`, `apply(plan) → ledger rows`, `destroy(resource)`, `drift(ledger)`.
- **Adapters:** `cloudflare` (REST: Workers script upload with bindings metadata incl. DO migrations, R2, KV, D1, Queue, cron triggers, custom domain/route, secrets `PUT /workers/scripts/:name/secrets`); `neon` (project, branch, role, database, connection string → secret vault, never the ledger); `gcp-cloudrun`, `azure-functions`, `aws-lambda` reuse the generated-workflow adapters as their deploy half, with provisioning calling the cloud APIs for the database.
- **Ledger:** `infra_resources (id, tenant_id, project_id, connection_id NULL for BF-hosted, provider, kind, external_id, name, state, created_by_run, created_at, destroyed_at)`, unique `(provider, connection_id, kind, external_id)`.
- **Plan/apply is a human confirm** by default (creates/updates/destroys + estimated cost). A board lane can pre-authorize non-destructive applies (same governance shape as `allowAutoStaffLanes`).
- **Secrets push:** `pushSecrets(target)` to Cloudflare (REST), GitHub (sealed box; `tweetnacl` + `blakejs`), GCP Secret Manager or Azure Key Vault, recorded as a ledger event with **names only**.

**Remaining (verified 2026-11-17):**
- Entirely unbuilt: rg `InfraProvider|infra_resources` empty. The only "pushSecrets" is a string inside the generated GitHub workflow (`application/backend/adapters/githubWorker.ts:123,190`).

### §4 W5: Builderforce-hosted compute (paid)

- **Workers for Platforms (D1):** one dispatch namespace; each app's Worker is a user worker with its bindings; R2/KV created in the Builderforce account, namespaced per app. DOs on user workers (**verify cron + DO WebSocket hibernation support first — the largest technical risk**). The dispatch Worker routes `<sub>.builderforce.ai` and custom hostnames (D4).
- `project_sites.mode` gains **`'worker'`** (a column value, not a new table).
- **Neon per app (D3)** under the Builderforce org, metered by the consumption meter. Collections stay the free default.
- **Replace Operator decision 3** in `ProjectAppPanel.tsx` / `AppStatement.tsx` (and `ProjectAppPanel.test.tsx`) with a host/database picker that decides its own visibility from `ownInfrastructure` / `hostedCompute`; free tenants see it visible-disabled with the plan named.
- Isolation: no service bindings to Builderforce internals, outbound limits on the namespace, CPU limits per plan.

**Remaining (verified 2026-11-17):**
- Entirely unbuilt: `project_sites.mode` defaults `'static'` (`api/src/infrastructure/database/schema/growth.ts:72`) with no `'worker'`; the Operator-decision-3 copy still lives in `frontend/src/components/apps/ProjectAppPanel.tsx` / `AppStatement.tsx`. Blocked on D1, D3, D4.

### §4 W6: Build + deploy pipeline

- **Where builds run:** in the W1 container (`build` + `verify` from the blueprint) or the customer's GitHub Actions. The generated workflow is rewritten from the blueprint (per-service working-directory, right package manager, `NODE_OPTIONS` heap); the npm-at-root template is retired and every consumer migrates.
- **Order (load-bearing):** provision (idempotent) → push secrets → build → **migrate** → deploy worker(s) → publish SPA → attach domains → health check (`MonitoringService.watchDeployedBackend`) → release row. A failed migration stops the deploy; the previous release keeps serving.
- **Releases and rollback** extend `site_releases` to carry the worker version id.
- **Preview environments:** each PR gets a preview deployment + Neon branch, torn down on merge/close via ledger `destroy`.

**Remaining (verified 2026-11-17):**
- `api/src/application/ide/deployWorkflow.ts:96` still emits `npm run build` at the root; no blueprint-driven workflow, no ordered pipeline, no worker-version releases, no PR previews.

### §4 W7: Marketplace (repo-connected, own-auth, mobile)

- **Project-sourced listings.** `resolveListingTarget` accepts `source: { projectId }`; the snapshot is the project's **release**. `convertSessionToApp` gains an "adopt project" path.
- **Launch `external`:** a new `LISTING_LAUNCH_MODES` value opening the app's own origin in a new tab; paid external apps verify a signed launch token (tiny SDK).
- **Mobile kind:** `mobile-app`, from `['project', 'build']`, launch `install`, deliveries `app-store`, `play-store`, `testflight`, `apk`, `expo-update` (`exp://u.expo.dev/…` QR), `pwa`; fed by EAS (generated `eas.json` + Action, `EXPO_TOKEN` pushed by W4, artifact URLs via the OIDC deploy callback) and Capacitor (`capacitorWorkflows.ts`).
- Data-driven: a new kind is one registry entry + `marketplaceCreations.kind.mobileApp` in 5 locales + one `LaunchStage` branch per new launch verb.

**Remaining (verified 2026-11-17):**
- `LISTING_LAUNCH_MODES = ['play','open','run','preview','install']` (`packages/creation-canvas-contract/src/marketplaceListings.ts:38`) — no `external`.
- `resolveListingTarget` is session-sourced only (`api/src/application/marketplace/listings/target.ts:110-125`; `projectId` read from the app link).
- No `mobile-app` listing kind or EAS feed.

### §4 W8: Company → project in one step

`POST /api/projects` accepts an optional `companyId`, validated in the same use case as `linkProjectToCompany` (both sides in the tenant). The company workspace gets "New project" alongside "Attach". MCP `projects.create` gains `companyId`. One path, not a second writer of `company_id`.

**Remaining (verified 2026-11-17):**
- `companyId` is accepted and persisted (`api/src/presentation/routes/projectRoutes.ts:703,777,873`; `ProjectService.ts:200`) **without any check that the company belongs to the tenant** — a second, unvalidated writer of `company_id`. Route it through the `linkProjectToCompany` validation (`api/src/application/investor/companyWorkspace.ts:565`).
- No "New project" in the company workspace (`frontend/src/components/investor/*` has attach only).
- MCP `projects.create` has no `companyId` (`api/src/application/llm/builtinMcpService.ts:813-826`).

### §4 W9: Browser run tier (full-stack apps on our WebContainers runtime)

W1 runs the app in a cloud container. W9 runs the **same blueprint** in the user's browser on `@seanhogg/builderforce-webcontainers`: frontend, API and Postgres, with no container, no server and no per-hour cost. What is missing is *the application*: starting several services as one app, connecting them, and giving them a database.

**One flow, two targets.** A `RunTarget` port with adapters `browser` (W9) and `container` (W1). Both read the same `AppBlueprint`, feed the same `LivePreviewPanel`, and back the same `runtime.*` MCP tools. The target is chosen from the blueprint, never a user branch: **browser** when every service's runtime accepts the project and the database is Postgres-compatible; **container** for anything the browser runtime declines with a reason (`wrangler dev`/Miniflare, Docker, native-only addons, Nuxt) — the decline reason is shown, never a half-broken preview. **Free tenants get the browser tier**; the container tier stays `containerRuntime`-entitled (D7).

**Design decisions** (binding):
1. Build orchestration on top of the existing process manager; don't replace the runtime or emulate Docker/Linux.
2. The manifest *is* `AppBlueprint` (+ repo-root `builderforce.json`). W9 adds per-service `dependsOn`, `readiness`, `restartPolicy`, and a database `provider` (`pglite` in the browser, a Neon branch in the container). The webcontainers package takes a plain `ApplicationSpec`; the Builderforce adapter maps blueprint → spec; a standalone user passes the spec or the runtime reads the `services` section of `builderforce.json`.
3. Not a second detector: the runtime only accepts or declines a service (`RuntimeProvider.accepts(service) → ok | reason`); core `detectProject.ts` becomes the browser runtime's accept check for frontends.
4. Hybrid networking: ordinary HTTP frontend→API through virtual ports, and a project-scoped service map injected as env (`API_URL=http://localhost:8000`). The dev-server proxy (`/api/*` → the API's virtual port) comes from the blueprint's ports. App code never sees worker ids or preview URLs.
5. App-facing database contract is a real `DATABASE_URL=postgres://…@localhost:5432/…`. PGlite runs in its own Worker behind a MessagePort RPC; Node `net` gains a client `createConnection` to virtual TCP ports, and a Postgres wire gateway (`execProtocolRaw`) sits on that port, so unmodified `pg`, `postgres`, Drizzle and Prisma (driver adapters) work. `bfdb://` is a fallback only if the wire gateway fails its gate.
6. PGlite in a dedicated Worker, serialized queries with transaction-aware scheduling, storage outside the project VFS (IndexedDB, per project + database id) with export/import/reset/restore; not in source ZIP exports. The database outlives API and frontend restarts. Multi-tab: one leader-elected owner per project database. **Revised 2026-11-18 (security review):** the database Worker and its IndexedDB live on the **host (app) origin**, not in the relay frame. The preview origin is shared by every project's preview and runs untrusted code, so storage placed there could be opened by any project's code. Untrusted process code reaches the database only as wire-protocol bytes through the gateway, relayed across the host↔relay bridge. Storage and lock names come from an unambiguous key of (project id, database id). Preview code reaches only HTTP, never the database port.
7. Shared, copy-on-read VFS with a change journal **first**.
8. Python, PHP, Rust and .NET runtimes after phases 1–4, each a `RuntimeProvider` adapter (one registry entry), declaring supported project profiles and declining the rest with a reason.
9. Lifecycle state machine (discovered → preparing → starting → ready → running → stopping/stopped, failed), readiness before dependents start, restart policy per service. A failed API does not kill the frontend. Readiness: database = accepts a query; API = health URL answers; frontend = port open.
10. Use cases, not managers: `startApplication`, `stopApplication`, `restartService`, `serviceGraph`, `readiness`, `serviceEnv`, `databaseHost`, `pgGateway`, in `core`/`browser` behind a new `./app` subpath. `startPreviewRuntime()` unchanged; `startApplicationRuntime(spec)` is the new entry.

**Public contract** (`@seanhogg/builderforce-webcontainers/app`): `startApplicationRuntime(spec)` returns an app with `start()`, `stop()`, `restart(serviceId)`, `getService(id)`, `getUrl(serviceId)`, `logs(serviceId?)` (`ReadableStream`), `onStateChange(cb)`, `onError(cb)`, and `database(id)` → `export()`, `import(blob)`, `reset()`. Builderforce's `lib/browserRuntime/factory.ts` gains the browser `RunTarget` adapter: blueprint → `ApplicationSpec`, running `migrationCommand` / `seedCommand` against the browser database before the API starts.

**Phases** (each ships on its own with an automated exit test):

| Phase | Contents | Exit condition |
|---|---|---|
| 0 | Baseline via the webcontainers Phase-0 harness: process start-up and snapshot cost, virtual HTTP/WS latency, concurrent Node processes. | Numbers recorded; existing suite is the regression gate. |
| 1 | Shared copy-on-read VFS with a change journal. | Spawn cost flat in project size; Next first-page time measured against Phase 0. |
| 2 | `ApplicationSpec`, service graph, lifecycle, readiness, per-service env and logs, `startApplicationRuntime`. | A Node frontend and Node API start, stop and restart independently. |
| 3 | Service map, dev-server `/api` proxy, connection cleanup on stop. | Frontend calls the API with relative `fetch('/api/…')`; streaming and WS regression tests pass. |
| 4 | PGlite Worker, IndexedDB persistence, `net.createConnection` to virtual TCP, Postgres wire gateway, blueprint migrations, export/import/reset, multi-tab leader. | **Unmodified** Express + `pg` (and Drizzle) does CRUD with transactions and rollback; data survives API restart, frontend restart and reload; two projects stay isolated. |
| 5 | Builderforce wiring: `RunTarget` port, blueprint → spec, `LivePreviewPanel` reading either target, `runtime.*` tools routed by target. | A canvas app (Vite + Express + Postgres) runs in the panel on a free tenant; an agent edit hot-reloads; `preview_screenshot` sees it. |
| 6a | **Python** (Pyodide in a process Worker): ASGI/WSGI request-driven from the API's virtual port; `micropip`; Python `socket` → virtual TCP so `pg8000` reaches the gateway. | A FastAPI app does CRUD against the shared database via `/api`. |
| 6b | **PHP** (php-wasm): request-driven adapter; PDO `pgsql` built in; sockets bridged to virtual TCP; Composer pure-PHP. | A Slim or Laravel-lite app does CRUD. |
| 6c | **.NET** (Mono `browser-wasm`, Roslyn-in-Wasm builds): ASP.NET Core minimal APIs via an in-memory server adapter; `Npgsql` stream bridged to virtual TCP. | A minimal-API service builds in the browser and does CRUD. |
| 6d | **Rust**: `wasm32-wasip1`/`wasip2` on the WASI host; `wasi:http`-style handler; `tokio-postgres` over a WASI socket bridge. In-browser compile is a separate gate; until it passes, services arrive prebuilt (W6). | A prebuilt axum-on-WASI service does CRUD; an in-browser `rustc` gate result is recorded. |
| 7 | **Python training on WebGPU.** | A PyTorch-style LoRA fine-tune runs in the WebContainer with its math on WebGPU, writes an adapter, and the adapter loads in the existing inference path. |

**Python training on WebGPU (phase 7).** Constraints: PyTorch has no Wasm build; WebGPU runs in dedicated workers; the runtime refuses to require SharedArrayBuffer. Design:
- **ONE WebGPU tensor engine.** `@webdit/torch` gains a WebGPU backend and reverse-mode autograd. The WGSL kernels of the old main-thread `WebGPUTrainer` (LoRA forward, chain-rule backward, AdamW) **moved** into it — not copied; the browser trainer (`frontend/src/lib/training/**`) now runs on the engine. The engine owns GPU-resident tensors and the kernel registry (matmul, softmax, layernorm, attention blocks, cross-entropy, AdamW), buffer pooling, and mixed fp16/fp32 where `shader-f16` is available.
- **A `torch` module for Python**: a Pyodide package of thin handles to engine tensors via the JS FFI in the same Worker; tensor data never enters the Python heap. Supported: `torch.tensor`/`zeros`/`randn`, the ops above, `.backward()`, `torch.no_grad()`, `nn.Linear`/`Embedding`/`LayerNorm`/`Module`, `optim.AdamW`, `save`/`load` (safetensors), a `peft`-style `LoraConfig`. Outside that surface: a clear error naming the op, never a silent CPU fallback.
- **Async readback without SAB:** only readback (`.item()`, `.numpy()`, `.tolist()`) waits on `mapAsync`, bridged with JSPI where available, otherwise an awaitable `item_async()` in an `asyncio` loop; losses logged every N steps.
- **Scope:** LoRA/QLoRA of small causal LMs; frozen base quantized (4/8-bit) via the `./ml` model cache; only adapter weights + optimizer state trainable (fp32); VRAM budget from `createMemoryManager` so a run that cannot fit declines before it starts. Full-parameter training of multi-billion models goes to container/cloud.
- **Training is a service kind** (`kind: 'training'`): logs/loss/step metrics stream through `logs()`; checkpoints to project storage outside the VFS; stopping checkpoints first. Output adapter = `BrowserLoRAArtifact`.
- **Closes PRD 22 §3.2:** `AITrainingPanel`'s `WebGPUTrainer` migrates onto the same engine, in a worker.
- *Exit tests:* gradients match the `@webdit/torch` CPU reference within tolerance for every kernel; a LoRA run reduces loss deterministically under a fixed seed; VRAM within budget; zero interaction-thread long tasks during training; the adapter round-trips (train in Python → generate with it loaded).

**Acceptance (W9).** One project, press Run: (1) blueprint resolves to the browser target; (2) PGlite starts and migrations apply; (3) the API starts once the database is ready; (4) the frontend starts and calls the API via relative URLs; (5) the app renders in `LivePreviewPanel`. Then edit a component, edit API logic, restart the API: rows intact, nothing reinstalls, a page reload restores the data.

**Engineering targets (re-base on Phase 0 numbers):** each added service < 500 ms beyond its own boot; warm database < 1 s; API→database round trip < 10 ms; cooperative shutdown < 1 s; no database/runtime work on the main thread; zero regressions in the existing suite (`run()`, `bfsh`, installs, Vite/React/Vue/Svelte/Next, HTTP/WS/streaming, cookies, relay mode, ZIP export/import, WASI); durability defaults to normal flush, relaxed is opt-in and documented.

**Remaining (re-verified 2026-11-18, after merging `builderforce/task-6652`):**
- Phases 0–4 shipped in builderforce-webcontainers **v2026.11.1** (flat-cost spawns + journal with a phase 0–1 report; `./app` application runtime; virtual TCP; PGlite on the host origin behind a Postgres wire gateway, multi-tab owner + followers; unmodified `pg` + Drizzle verified). Phase 6a (Python on Pyodide, ASGI/WSGI, `pg8000` over virtual TCP) shipped in **v2026.11.2**. Phase 6b (PHP on php-wasm: `php -S` request-driven, Composer pure-PHP installs, PDO pgsql (`Bfwc\Pgsql\PDO`) over virtual TCP, shared interpreter worker) shipped in **v2026.11.3**.
- Python and PHP are wired into Builderforce's browser run target (webcontainers **^2026.11.3** in api/frontend/studio): blueprint kinds `python`/`php` (dev port 8000) in `creation-canvas-contract`; `blueprintToApplicationSpec` puts a service, its install and its migration on the runtime that owns the command (the runtime's own `isPythonCommand`/`isPhpCommand`; a shelled line stays on node, whose shell hands the child over); `BROWSER_RUNTIMES` gains `acceptsPythonService`/`acceptsPhpService`, re-judged on the loaded project files at start — before the current run is disposed or the shared runtime is booted — so a native-only wheel or a missing PHP extension is declined by name before anything starts (PHP judged against the PHP `PREVIEW_PHP_OPTIONS` boots; a shelled `pip …`/`composer …` line judged by its own runtime too); `browserRunTarget` registers `createPythonProvider` and `createPhpProvider` (`platform: runtime.phpPlatform`, the same `PREVIEW_PHP_OPTIONS` the runtime boots with); the API serves `python-worker.js`/`php-worker.js` beside `process-worker.js` on the preview origin (no CSP there, so Pyodide/php-wasm/Packagist/GitHub/jsDelivr need no allow-list). The API's `pythonDetector` (requirements.txt / pyproject / Pipfile) and `phpDetector` (composer.json) write `kind: 'python'`/`'php'` at the repo root and in `api/`/`backend/`/`server/`; a root holding both a `package.json` and a language manifest (Laravel + Vite) gets one install per runtime. Open: the FastAPI and Slim CRUD browser exit tests are not recorded.
- Phase 5: the code is in — `frontend/src/lib/runTarget/**` (the `RunTarget` port, registry, browser + container adapters, blueprint → `ApplicationSpec`, `runtime.*` tool router) and `LivePreviewPanel`/`useLivePreview` read the active target. Open: the exit test (Vite + Express + Postgres canvas app on a free tenant, agent hot-reload, `preview_screenshot`) is not recorded, and D7 free-plan gating is undecided.
- Phases 6c (.NET) and 6d (Rust) shipped in builderforce-webcontainers **v2026.11.4** together with the W10 runtime controls: .NET on Mono `browser-wasm` (Roslyn builds in the runtime, ASP.NET Core minimal APIs on an in-memory server, async `Npgsql` over virtual TCP; SDK pinned 10.0.115, per-file sha256 bundle manifest); Rust as prebuilt `wasm32-wasip1` reactors on the versioned `bfwc-wasi` guest ABI (axum + `tokio-postgres`). In-browser `rustc` gate recorded: **fails** (needs SharedArrayBuffer, which the runtime refuses), so Rust services arrive prebuilt (W6). Open: Builderforce is still on ^2026.11.3 — the bump to ^2026.11.4 (which makes `runtime` a required `startApplicationRuntime` option), serving `dotnet-worker.js`/`rust-worker.js` on the preview origin, and .NET/Rust providers + API detectors in the browser run target.
- Phase 7: the engine (`@webdit/torch` autograd + WebGPU backend + kernel registry), the Python `torch`/`peft` surface over `@webdit/torch/pyodide`, and the browser trainer on the engine in a worker are on main (PRD 22 §3.2 closed). The runtime side shipped in builderforce-webcontainers **v2026.11.5**: `type: 'training'` services (readiness `started`, restart `never`, checkpoint on stop), `runtime.pythonTraining`, the host-origin `createTrainingArtifactStore()` and the Python `bfwc.training` module. Builderforce (webcontainers **^2026.11.5**): blueprint kind `training` (no dev port) in `creation-canvas-contract`; `blueprintToApplicationSpec` maps it to `{ type: 'training', runtime: 'python' }` with no port and the runtime's defaults, after its root's install, never a frontend's backend; `BROWSER_RUNTIMES.python` accepts training services and never declines `torch`/`peft` (`previewPythonOptions.ts`: `PREVIEW_PYTHON_PROVIDES`); `browserRunTarget` registers `createPythonProvider(runtime, { training: runtime.pythonTraining, provides })`; the Worker-side factory `lib/training/torchPythonExtension.ts` returns `torchPythonExtension(createTorchBridge())`; `lib/training/trainingServiceAdapter.ts` reads a service's save (peft `adapter_model.safetensors` on `embed_tokens`, plus an optional `base_model.safetensors` + `tokenizer.json`) and packages it through `loraArtifact.ts` into the same `BrowserLoRAArtifact` the panel publishes; `AITrainingPanel` loads it (`PythonTrainingImport`). Users declare the service in `builderforce.json` (no detector). Open: (a) the runtime does not yet boot with `python: previewPythonOptions(RELAY_URL)` (`previewRuntime.ts`), so `runtime.pythonTraining` is undefined and the provider declines training services at start; (b) the torch extension is not built or served — `torch-extension.js` must be bundled from `torchPythonExtension.ts` and served beside `relay.html` on the preview origin (`browserPreviewOrigin.ts`; the Worker CSP only allows `'self'`/jsDelivr scripts), and on per-app origins the module URL must follow the app's origin; (c) `@webdit/torch` has no Python Evermind model or Evermind-checkpoint export, so a script must hand-build an `nn.Linear` named `embed_tokens` over the Evermind base's tied embedding (its `peft` wraps only `nn.Linear`) and save the base itself — a Python Evermind module + export helper and a template `train.py` are open; (d) the end-to-end exit test (train in Python in the tab → publish → generate) is not recorded — the conversion round trip is covered by `trainingServiceAdapter.test.ts` (fixture built to `peft_io.save_pretrained`'s format, not produced by it).

### §4 W10: Security Shield (mandatory protection for every browser-run app)

*Added 2026-11-18 from the "BuilderForce Security Shield — Technical Architecture & Implementation Plan" (protect mode, ingress + runtime monitoring), aligned against the builderforce-webcontainers runtime at v2026.11.3 and reviewed the same day. W9 runs the user's app in the browser; W10 makes everything that runtime executes protected by default — Node, Python, PHP and, once shipped, .NET — with no manifest switch to turn it off. The container tier (W1) keeps its own boundary: the non-root container + egress allowlist of make.md › PRD 09 G1. The concrete gap inventory from the audit and review (paths, evidence) is tracked out of source control in `SECURITY-FINDINGS.local.md`; this section states the controls that close it.*

**Objective.** Inspect every entry point, monitor activity inside the app, correlate across both, and stop high-confidence attacks with explainable deterministic rules — without breaking legitimate developer traffic (apps that legitimately send SQL, HTML, JS and shell-like text).

**Principles (binding).**
1. **Mandatory** — an app cannot disable or bypass the shield through its spec or `builderforce.json`; it may only tighten it.
2. **Enforce on the trusted side.** Process Workers and preview documents run the app's code, so nothing inside them (in-worker `fetch`/`http` hooks, `servedPorts`, env vars such as `BUILDERFORCE_SERVICE`, Postgres `application_name`) is a security boundary — at most it is telemetry. Enforcement lives on the page/host side (`ProcessHost`, `PortRegistry`, `ConnectionRelay`, FsSync, the database host), in the service worker for routing, and in the browser itself (origins, CSP).
3. **Identity is assigned, never claimed.** Every process gets an (application, service, process) identity minted by the runtime at spawn and kept on the page-side process record; children inherit their parent's identity on the page side; processes started outside an application (terminal, `npm install`, instant preview) carry a `workspace` identity — never `platform`, which is reserved for the host's own calls.
4. **Shared engine, isolated state** — one security engine per runtime host; per-application counters, policies, events and incidents.
5. **Deterministic enforcement; behaviour is evidence.** Known signatures, protocol violations and boundary violations block; behavioural signals raise risk and throttle, never block on their own. No LLM in the request path (LLM explanation of incidents is deferred).
6. **Fail closed at entry points, fail open on telemetry.** A dead enforcement engine holds or rejects protected traffic — never a silent allow-all; a dead event store never disables enforcement. Enforcement health and telemetry health are reported separately.
7. **Ports, not a parallel stack.** `@seanhogg/builderforce-webcontainers` stays independent of Builderforce: policy comes in through a policy port, events leave through a `SecurityEventSink` port, and the runtime emits reason codes only. Builderforce's adapter maps them to localized copy and to the platform's existing security records — no new incident store or dashboard.
8. **No god module.** The policy engine is an injected collaborator of `ProcessHost` (the existing `ConnectionRelay` / `ChildRelay` pattern), not inline checks in it; bounded event buffers reuse the runtime's existing ring buffer.

**Trusted chokepoints** (where each flow is decided):

| Flow | Decided at |
|---|---|
| Preview HTTP and WebSocket ingress | The service-worker router (routing, client binding) and `PortRegistry.request` / `ProcessHost.upgrade` (inspection) — the worker-side `servedPorts` endpoint is never trusted |
| In-runtime HTTP between services | `PortRegistry.request` (loopback never reaches the service worker, so it must be decided here) |
| Host API (`runtime.request`, `listenTcp`, `connect`) | The same decision functions, with the caller's identity |
| Virtual TCP between services | `ConnectionRelay.dial` → `PortRegistry.connect`, against port ownership and the app's service graph |
| Database | The gateway on the host origin (authentication, database ownership, protocol-aware statement policy) |
| Egress (process Workers and preview documents) | The browser: CSP on every worker script and on every routed preview response |
| Processes | `ProcessHost.spawnChild` / `ChildRelay` / `WorkerSupply` (quotas, attribution) |
| Filesystem | FsSync on the page side (per-app snapshot and broadcast scope, protected paths, journal-driven detection) |
| Lifecycle | `startPreviewRuntime` (shield start) and `startApplicationRuntime` / `superviseService` (identity, mandatory readiness) |

**Controls the shield must enforce** (each gets a failing fixture in Phase 0 and goes green in the phase named):
1. **Origin separation (P2).** Preview documents are served from an origin distinct from the relay frame and the process Workers (e.g. a per-preview subdomain); if that cannot ship first, the preview iframe drops `allow-same-origin`. Relay mode isolates apps from the host, not from each other — origin separation does that. **Decided 2026-11-18:**
- **The trust boundary is the application.** Each application gets its own origin, `https://<key>-preview.<domain>`, where `<key>` is derived page-side from (runtime id, stable application name) and never from app input. One app's preview, relay frame and Workers may share that origin, because they are all the same app's code.
- **One label under the zone, not a `preview.` subdomain.** `<key>-preview.builderforce.ai` sits under the existing `*.builderforce.ai` wildcard (DNS, Universal SSL certificate, the sites Worker's route), so it needs no second-level wildcard certificate; the sites Worker reserves the `<32 hex>-preview` label and hands those hosts to the API. The cost: these origins are same-site with `builderforce.ai` and every published site (no Public Suffix List entry can split them), so the separation is by origin (storage, DOM, service workers, CORS), not by site. That holds because platform auth is bearer tokens, not cookies, and published sites set host-only cookies; anything that ever adds a `Domain=builderforce.ai` cookie must account for it.
- **What the controls guarantee:**
  - No crossing between apps.
  - No crossing between an app and the workspace or the host.
  - No egress outside policy.
- **How they are enforced:**
  - **Origin is mandatory for applications:** per-app origins are required, and the only opt-out is the explicit `sharedPreviewOrigin: 'unprotected'`.
  - **The relay page cannot fetch:** it runs under `connect-src 'none'` with `frame-ancestors` set to the host only.
  - **Every SW response is stamped:** with the preview CSP and `nosniff`.
  - **Non-SW responses carry the default CSP:** the embedder sends it on every response from a preview origin that the SW does not serve.
  - **Attach takes no egress:** egress never comes from an attach message.
  - **The nonce recovers:** a stale nonce triggers a fresh re-attach instead of a lockout.
2. **Service-worker routing integrity (P2).** The service worker accepts attach/re-attach only from the relay client it registered, with a fresh per-attach nonce, and binds each preview id to the client that attached it; every routed request is checked against that binding.
3. **Ingress inspection on every path (P2).** Preview HTTP, WebSocket upgrades, in-runtime loopback HTTP and the host API all pass the same decision: normalisation, protocol and size validation (a request-body limit), bounded inspection, OWASP-CRS-derived signatures, per-app and per-source rate limits.
4. **Port ownership and the service graph (P3).** `PortRegistry.listen` records the owning (app, service); `dial` and `request` are allowed only along the app's declared `dependsOn` edges (or to its own ports).
5. **Authenticated database (P3).** The gateway authenticates every connection (cleartext or SCRAM over the virtual socket) with per-service credentials the runtime generates; it refuses a database name the app does not own (PGlite has one database, so "own" is the spec's name, not a namespace) and connections from services the graph does not allow. Frontend services never receive credentials.
6. **Egress CSP (P4).** Worker scripts are served with `default-src`, `script-src`, `worker-src` and `connect-src` allowlists — `connect-src` alone does not cover `importScripts`, dynamic `import()` or nested Workers. Own-origin `/__bfwc/` paths are excluded from `'self'` so a Worker cannot re-enter the service worker as if it were preview ingress. Because policy is per app, worker URLs carry a signed policy id, cache keys vary by policy, and warm spares are keyed by policy (a spare created before the app is known gets the most restrictive policy). Violations are reported through the CSP `report-to` endpoint on the API — never trusted from inside the Worker. The default allowlist is the hosts the runtimes and installers need (npm registry, Pyodide/PyPI wheel hosts, php-wasm, Packagist, jsDelivr, and NuGet's read hosts `api.nuget.org`/`globalcdn.nuget.org` for `dotnet restore` — never `www.nuget.org`, the push path; no crates.io host, since the Rust runtime runs prebuilt wasm and never fetches crates) plus GitHub (github.com, api.github.com, codeload, raw and objects.githubusercontent.com), so a repository can be pulled into the runtime and run straight from GitHub (operator decision 2026-11-18), plus the app's declared external APIs. GitHub's write paths need a token, and the runtime never hands GitHub credentials to app processes: the person's GitHub connection stays host-side, so app code can read public GitHub but never write as the person. Other write-capable APIs are never default. Preview documents get an equivalent CSP stamped by the service worker on every routed response. `blob:`/`data:` Workers inherit their creator's policy (CSP3); Safari behaviour is proven by a Phase 0 fixture.
7. **Origin storage and channels (P4).** The shared package cache moves to the page (host) side, or every entry is keyed and verified by the registry's `dist.integrity` before use, so one project cannot poison another's install. `BroadcastChannel`, IndexedDB, OPFS and Cache Storage on the process/preview origin are not shared across apps or projects (partitioned names, or not exposed to app code).
8. **VFS confidentiality and integrity (P4).** A process's snapshot and its `fs` broadcasts are scoped to its app's subtree plus read-only shared dependencies; writes outside the subtree are refused when the journal is applied; platform paths (`/.bfwc/**`, runtime files) are read-only to apps; generated credentials never land in a file another app can read.
9. **Process quotas and attribution (P4).** Per-app spawn count and depth quotas in `spawnChild`; every child, `detached` included, stays attributed to its app, so stopping or quarantining the app terminates the whole attributed set; restart loops beyond `restartPolicy` suspend the service.
10. **Relay mode required (P4).** Protect mode refuses to start apps in same-origin mode (processes there share the host origin and the database's tab channel); it is not merely "degraded".

**Design decisions on the proposal** (✅ adopted, ✏️ changed):

| # | Proposal | Decision |
|---|---|---|
| 1 | ✅ Data plane / intelligence plane / control plane, in `core/src/security/**` and `browser/src/security/**`. | Adopted as module boundaries behind a `./security` subpath (like `./app`). No AI dependency in the runtime. |
| 2 | ✏️ Intercept in `servedPorts.ts`, `workerSupply.ts`, `interpreterProcess.ts`. | **Changed:** those run inside, or hand out, untrusted Workers. Decisions are taken at the chokepoints above; worker-side hooks emit telemetry only. |
| 3 | ✏️ A dedicated Security Worker inspects every request. | **Split:** cheap deterministic checks (identity, ownership, size/framing, rate counters) run synchronously on the page side in the request path; bounded-payload signature inspection runs in the shared Security Worker over typed messages with transferable, bounded buffers, backpressure, timeouts and versioned policy snapshots. An analyzer timeout applies the deterministic result; it never waits unbounded and never defaults to allow. |
| 4 | ✏️ The shield starts with `startApplicationRuntime()`. | **Changed:** the chokepoints belong to the `PreviewRuntime`, which the terminal, `npm install` and instant preview share without starting an application. The shield starts in `startPreviewRuntime`; `startApplicationRuntime` mints app identities and will not start a service until enforcement health is `ok`. Identity rides a new field on the provider start context and the spawn API that app code cannot set; the readiness probe carries one too. |
| 5 | ✏️ "Cross-tenant" isolation of VFS and database. | **Reframed:** each project already runs in its own runtime with per-(project, database) storage keys and Web Locks, but a browser profile shares the preview origin's storage across projects, and apps on one runtime share the VFS, ports and database. Controls 1, 4, 5, 7 and 8 are the isolation W10 adds. |
| 6 | ✅ PostgreSQL inspection understands the wire protocol. | Adopted on the existing gateway frame reader: authentication, database ownership, statement classification of `Query`/`Parse`, per-service rate and transaction-duration limits — without breaking framing or transaction semantics. |
| 7 | ✅ Resource monitoring with enforceable quotas, not fake precision. | Adopted: spawn/byte/connection/request quotas from the runtime's own counters; Worker CPU/memory reported only where the browser measures them. |
| 8 | ✅ Risk score 0–100 for prioritisation; signatures and boundary violations enforced regardless of score. | Adopted. Thresholds start in **observe** and are calibrated on the test corpus before protect enforces them. |
| 9 | ✏️ Persistent event store, incident store and a four-view dashboard. | **Changed (DRY):** bounded in-memory buffers + an IndexedDB event ring on the host origin (redacted evidence only — never passwords, tokens, cookies or full bodies). Incidents leave through `SecurityEventSink`; Builderforce forwards them to `security_incidents` (`detection_source = 'runtime-shield'`) through a dedicated ingest route that is authenticated, rate-limited and records the event as **client-attested**. Only quarantines and signature blocks above a severity floor open incidents (a probe does not). Dedup needs a migration: the unique partial index on `(tenant_id, segment_id, source_ref)` today covers only `finding:%` refs and `segment_id` is nullable, so it is widened to `shield:%` with a non-null key. The finding-kind seam in `criticalFindingIncidents.ts` (also needed by run.md › PRD 08) is built, not assumed. The PRD 39 §4a SIEM export then ships them. App security shows in `LivePreviewPanel`'s service status (enforcement health, held services, last blocks) and the existing security/incident surfaces; the service-communication map is an addition to the run panel. |
| 10 | ✏️ Multi-tab: one coordinator for shared security state. | **Changed:** each tab has its own runtime, so **every tab enforces locally** — no other tab sits on a request path. Only persisted state (events, incidents, policy versions) is written through one owner per app, using a dedicated per-app Web Lock (the database lock does not exist for in-memory databases). |
| 11 | ✅ Modes `observe` / `protect` / `strict`. | Adopted. Protect is the default; an app may only tighten (strict). Observe exists for calibration and is platform-set, never app-set. |

**Contract** (`@seanhogg/builderforce-webcontainers/security`): `SecurityContext { applicationId, serviceId, processId?, requestId?, connectionId? }` (filled by the runtime), `SecurityEvent` (category `ingress | network | process | filesystem | database | resource`, rule id, severity, redacted evidence, reason code), `SecurityDecision { action: allow | monitor | throttle | reject | quarantine, riskScore, confidence, reasonCodes, policyVersion }`. `startPreviewRuntime({ security: { policy, sink } })`; `runtime.security()` returns `health()` (enforcement + telemetry), `events()` (a bounded `ReadableStream`), `incidents()` and `onDecision(cb)`; `app.security()` scopes the same to one application.

**Phases** (each has an automated exit test; latency re-based on the W9 Phase-0 harness):

| Phase | Contents | Exit condition |
|---|---|---|
| 0 | Turn every item in the gap inventory into a failing fixture, including the browser-specific ones (CSP inheritance for `blob:` workers, Safari); record baseline latency for HTTP, WS, dial and the gateway. | One red test per gap; baseline numbers recorded. |
| 1 | Identity minted at spawn (start context + spawn API + inheritance + `workspace`); port ownership; shield start in `startPreviewRuntime`; Security Worker + typed protocol; policy port and snapshot; event schema; `SecurityEventSink`; enforcement/telemetry health. | Every runtime starts with the shield; no app service starts before enforcement health is `ok`; a killed Security Worker holds new protected requests and recovers. |
| 2 | Controls 1–3. | Their fixtures go green; the attack corpus is blocked; the clean corpus passes. |
| 3 | Controls 4–5. | Unauthorised service→service and frontend→database connections are denied; unmodified `pg`/Drizzle apps still pass the W9 suite. |
| 4 | Controls 6–10. Python and PHP inherit them because they cross the same page-side chokepoints; .NET when shipped. | Every fixture is green across Node, Python and PHP. |
| 5 | Signature engine, behavioural signals, correlation keyed on request/connection/pid causality (never time proximity alone), risk scoring, reason codes. | A scripted multi-stage attack yields one correlated incident. |
| 6 | Automated response: throttle, deny, suspend service, quarantine app, recovery/restart — scoped to one app. | No response crosses an app boundary or stops an unrelated service. |
| 7 | Builderforce wiring: the adapter's sink → the ingest route → `security_incidents` (with the index migration and the finding-kind seam) → SIEM export; enforcement health and blocks in `LivePreviewPanel`; the communication map; drill-down from the existing security surfaces. Reason codes map to keys in all five catalogs; theme tokens; responsive. | An operator can open any automated block from the panel and see rule, evidence, action and outcome. |
| 8 | Scale and adversarial validation: many logical app contexts on one engine, concurrent load, queue pressure, multi-tab, evasion (encodings, fragmentation), regression suite in webcontainers CI. | Targets below hold under load; zero bypasses in supported paths. |

**Targets (proposed, re-based on Phase 0):** added latency p95 ≤ 5 ms for simple HTTP inspection and ≤ 15 ms with bounded payload inspection (measured separately from total request time); no unbounded queue anywhere; ≤ 256 KB retained per app context, excluding evidence, measured as the engine's own accounted state (counters, buffers, policy refs) since the browser cannot attribute heap per context; 100% of the agreed attack corpus blocked; < 0.1% false positives on the clean corpus; zero cross-app access and zero bypasses in adversarial tests; Security Worker failure recovers automatically with no allow-all window.

**Limits.** The shield sees only what crosses the runtime's origins, service worker, virtual network and runtime hooks — not arbitrary browser or OS traffic — and it ends when the tab's runtime ends.

**Remaining (verified 2026-11-18):** all of it. Nothing of W10 exists in the runtime yet; on the Builderforce side the ingest route, the index migration, the finding-kind seam and the `runtime-shield` detection source are unbuilt.

### §4 W11: The app manifest — infrastructure as code, environments, diagnostics and starter kits

Designed 2026-11-19. Users who treat the WebContainer as a full runtime platform want to **define the app's whole infrastructure as code**: services, background workers, cron jobs, Redis, queues, storage. They want to **test all of it locally in the browser**, then **promote the same definition** to permanent infrastructure. W9 gave the runtime multi-service apps (`ApplicationSpec`, the service graph, readiness, restart policy, PGlite). W11 adds the declaration, the missing resource kinds, environments, diagnostics, and starter kits that prove it all works.

**Gaps it closes (verified 2026-11-19):**
- `builderforce.json` is an unversioned `Partial<AppBlueprint>` with replace-whole-array semantics. Invalid JSON is dropped without a word (`builderforceJsonDetector.ts`).
- There are no scheduled jobs. `BINDING_KINDS.CRON` and `QUEUE` are metadata that no target runs.
- `AppServiceReadiness` has no `started`, so a worker with no port maps to `exit-zero`, a one-off.
- The blueprint holds one `database`, the browser hosts only Postgres, and nothing produces `redis://`.
- Every target lasts only as long as a session: the tab, or a preview container with 3-minute idle eviction.
- There is no production/non-production notion, no debug mode, and no diagnostics surface.
- There is no starter-kit flow, and no way to write a manifest for an existing app.

#### W11 decisions (binding, user 2026-11-19)

1. **D9 — the deployment target is a port.** Its adapters are **browser** (webcontainers, temporary), **cloudflare** (Workers, Cron Triggers, Queues, R2, D1, Containers; in Builderforce's account or the customer's) and **customer cloud** (AWS/Azure/GCP). The model is CI/CD: run and test the full infrastructure locally, then promote the same manifest to permanent infrastructure. This port **is** W4's `InfraProvider`, renamed. There is one port, never both.
2. **D10 — Redis in the browser** ships without Lua first. Lua `EVAL` (needed by BullMQ) is a later phase.
3. **The manifest** stays `builderforce.json`: JSON with a published JSON Schema, `version: 1`. YAML may come later, and only through the same parser.
4. **Environment tier.** Every environment is `production` or `non-production`. `debug` is allowed only on non-production, and a debug flag on production is a validation error. Non-production may expose diagnostics. "Built with Builderforce" becomes an expandable **diagnostics panel** that streams what the ecosystem is doing.
5. **Validation order: the manifest first, then starter kits.** Kits are the acceptance matrix. `/starter-kit <kit>` scaffolds an app whose manifest runs it. The reverse also exists: create a manifest for an existing app, then run it in the WebContainer.
6. **Graph on Postgres** (Apache AGE): a spike runs alongside W11 and does not block it.

#### Contract — manifest v1

The parser, validation, schema and the manifest-to-`ApplicationSpec` mapping live in **`@seanhogg/builderforce-webcontainers-core/manifest`**. The MIT runtime reads `builderforce.json` itself, as W9 decision 2 promised, and Builderforce consumes the same module from npm. There is one parser for the standalone runtime, the API, the web app and the VSIX. `AppBlueprint` imports these types for services, resources, jobs and environments, and keeps only identity and provenance of its own (one fact, one place).

```json
{
  "$schema": "https://builderforce.ai/schema/app.v1.json",
  "version": 1,
  "name": "acme-shop",
  "resources": {
    "db":    { "type": "postgres", "persistent": true, "extensions": ["vector"] },
    "cache": { "type": "redis", "persistent": true, "maxMemoryMb": 64 },
    "tasks": { "type": "queue", "engine": "redis", "on": "cache" },
    "files": { "type": "object-storage" },
    "mail":  { "type": "mail" }
  },
  "services": {
    "api":    { "runtime": "node", "root": "/api", "command": "npm start", "port": 8000, "uses": ["db", "cache", "files", "mail"],
                "readiness": { "http": "/health" }, "scale": { "min": 1, "max": 4, "metric": "concurrency" } },
    "worker": { "runtime": "python", "root": "/worker", "command": "rq worker", "uses": ["tasks", "db"], "restart": "always" },
    "web":    { "runtime": "node", "root": "/web", "command": "npm run dev", "port": 5173, "role": "frontend", "dependsOn": ["api"] }
  },
  "jobs": {
    "nightly": { "schedule": "0 3 * * *", "timezone": "UTC", "run": { "service": "worker", "command": "python digest.py" },
                 "concurrency": "forbid", "timeout": "10m", "missed": "skip", "availability": "always-on" },
    "poll":    { "schedule": "*/5 * * * *", "invoke": { "service": "api", "method": "POST", "path": "/internal/poll" } }
  },
  "ingress": { "routes": [ { "path": "/api", "service": "api" }, { "path": "/", "service": "web" } ] },
  "environments": {
    "local":   { "target": "browser", "tier": "non-production", "debug": true },
    "staging": { "target": "cloudflare", "connection": "cf-acme", "tier": "non-production" },
    "prod":    { "target": "aws", "connection": "aws-acme", "tier": "production",
                 "overrides": { "services": { "api": { "scale": { "min": 2, "max": 10 } } } } }
  }
}
```

- **Entries are keyed by id.** Duplicate ids become impossible, and `overrides` merge deep and per key (unlike today's whole-array replace).
- **`parseManifest(text) → { manifest, issues: ManifestIssue[] }`** returns typed issues, like `SpecIssue`. Today's unversioned `Partial<AppBlueprint>` files parse through the same function, on its legacy path. **An unreadable file is reported, never dropped**: the blueprint card shows each issue against its key.
- **`toApplicationSpec(manifest, envName) → ApplicationSpec`** is pure. Overrides apply first, then the tier environment. A service with no port and `restart: always` defaults to readiness `started`.
- **Resource types** are a registry: `postgres`, `redis`, `queue`, `object-storage`, `mail`, `graph`, `connection` and `external`. A new type is one registry entry. Each type's environment names are table data:

  | Type | Variables |
  |---|---|
  | `postgres` | `DATABASE_URL` / `<ID>_DATABASE_URL` |
  | `redis` | `REDIS_URL` / `<ID>_REDIS_URL` |
  | `queue` | `<ID>_QUEUE` plus its engine's URL |
  | `object-storage` | `S3_ENDPOINT` / `<ID>_BUCKET` plus credentials |
  | `mail` | `SMTP_URL` |

- **`connection`** names a Connected Account, such as Stripe or Slack, and its credentials reach the runtime from the vault. **`external`** names an OpenTofu, Terraform, Bicep or CloudFormation module that only a customer-cloud target applies. Its `outputs` become environment variables.
- **`availability: session | always-on`** applies to services and jobs. The dev loop runs everything while the session lives and labels always-on items "runs while this session is open". A deploy needs a target whose capabilities include always-on, or it declines with a reason.
- **Connections are referenced by id.** No secret is ever in the file.

#### Capability matrix — `DeploymentTarget.capabilities()`

| Resource | Browser | Cloudflare | Customer cloud (OpenTofu) |
|---|---|---|---|
| Services (Node / Python / PHP / .NET / Rust) | ✅ (W9) | Workers (Worker-compatible code); Containers (other processes) | Cloud Run / ECS / Container Apps |
| Background workers | ✅ in-session | Containers | ✅ |
| Jobs (cron) | ✅ in-session, leader tab | Cron Triggers | Cloud Scheduler / EventBridge / Container Apps jobs |
| postgres (+ `vector`) | PGlite | Neon / D1 not compatible → Neon | RDS / Azure PG / Cloud SQL |
| postgres `age` (graph) | spike | Neon: no → decline | Azure PG: yes; others decline |
| redis | RESP gateway (W11) | Upstash via connection | ElastiCache / Azure Cache / Memorystore |
| queue | engine `redis` | Queues | SQS / Service Bus / Pub/Sub |
| object-storage | S3 endpoint on the host origin | R2 | S3 / Blob / GCS |
| mail | catcher inbox | connection (Resend / SES) | connection |
| graph (Neo4j/Memgraph) | decline | decline | Aura via connection / container |
| `scale` + `ingress` | ≤ 3 replicas, round-robin in the port router | Workers autoscale (advisory) | min/max instances + load balancer |
| `external` modules | decline | decline | ✅ |

**Local stand-ins must speak the real protocol** (PGlite for Postgres, RESP for Redis, the S3 API for storage). A stand-in with different semantics is a decline, never a fake. Every stand-in has a **parity contract suite** that runs against both the stand-in and the real engine.

#### Environments, tier and debug

- **`tierEnv(runtime, tier, debug)`** is a pure function in core, driven by one data table of framework conventions. Its output layers below the service's own `env`. The table sets:
  - `BUILDERFORCE_ENV`, `BUILDERFORCE_TIER` and `BUILDERFORCE_DEBUG` for every runtime;
  - `NODE_ENV` for Node;
  - `APP_ENV` and `APP_DEBUG` for Laravel;
  - `ASPNETCORE_ENVIRONMENT` for .NET;
  - `FLASK_DEBUG`, `DJANGO_DEBUG` and `PYTHONDEVMODE` for Python;
  - `RUST_LOG` for Rust.
- **`diagnosticsLevel(env) → off | basic | verbose`** is the one gate. Production is `off`, non-production is `basic`, and non-production with debug is `verbose`. Every producer, transport and surface asks it; none re-derives it.
- **Production never ships the diagnostics script.** It is not injected at all, rather than injected and hidden. The owner's operations view still receives errors through the existing monitoring path.
- **Promotion** is `plan(staging) → plan(prod)`. Production applies are confirm-gated through the existing approval governance. CI runs the same browser target headless (Playwright driving the runtime), so the full-stack tests a user ran locally gate the deploy.

#### Diagnostics — one event stream, one panel

- **Event schema.** It lives in core `./diagnostics`: `DiagnosticEvent { at, env, source, serviceId?, traceId?, kind, severity, data }`. `source` is one of `service | job | http | database | cache | queue | storage | mail | shield | resource`. `data` is **redacted at the producer**.
- **Producers** (each emits only when the level allows):
  - the application runtime: state changes, log lines, restarts, job runs;
  - the virtual port router: method, path, status and duration. No bodies, and only allow-listed headers;
  - the pg gateway: duration and a statement fingerprint, never parameters;
  - the RESP gateway: command name and latency;
  - the memory manager: per-service estimates;
  - W10 `SecurityEvent`s, which are already redacted.
- **Every stream is bounded.** Ring buffers drop the overflow and count it, as `logs()` does today.
- **Transport in the browser.** The badge script asks the host page for a `MessagePort` over the existing preview bridge. The host checks `diagnosticsLevel` and streams events. There is no network hop.
- **Transport on cloud targets.** `/__bf/diagnostics` is served by the target's edge as Server-Sent Events. It needs a short-lived **signed debug token minted only for project members**: non-production does not mean public.
- **The badge.** `attributionScript` gains a `diagnostics` option. The pill gains an expand control that opens a drawer in the same closed shadow root, written in vanilla JS with no framework. Its tabs are **Services · Requests · Jobs · Data · Logs · Shield**. The DOM is bounded and virtualised. It follows light/dark, and at phone width the drawer is a bottom sheet.
- **The panel can exist without the link.** It mounts even when a host sets `attribution: false`, because diagnostics and attribution are separate concerns sharing one mount.
- **Labels are passed in by the host**, the same way `AttributionOptions.label` is. Builderforce supplies them from all five catalogs (`appDiagnostics.*`), and the standalone runtime defaults to English.

#### Starter kits and manifest init — the acceptance matrix

- **Kits are composed from parts**, so N + M parts cover N × M kits. **Parts are data** in `packages/ide-templates`, which is already "the ONE source" for scaffolds:
  - frontends: `react-vite`, `angular`, `vue-vite`, `svelte`, `next`;
  - backends: `node-express`, `laravel`, `dotnet-minimal`, `python-fastapi`, `rust-axum` (prebuilt, W9 6d);
  - extras: `postgres`, `redis`, `queue`, `jobs`, `storage`, `mail`.
- **Each part carries** a file tree under its service root, a manifest fragment, a `/health` endpoint, a **feature that exercises every resource it uses**, and a smoke script. The features are: CRUD on Postgres, a cache hit counter, enqueue → worker → result, a cron heartbeat row, upload/download, and send → inbox.
- **`composeKit(kitId, extras) → { files, manifest, issues }`** is pure. Fragment conflicts are issues, never silent overwrites.
- **`VANILLA_TEMPLATE` becomes the `react-vite` kit, and its callers migrate.** There are no parallel scaffolds.
- **Named kits are a list:** `react-node`, `angular-node`, `react-laravel`, `react-dotnet`, `react-fastapi`, `vue-node`. Any frontend × backend pair is accepted when its parts exist.
- **Command surface — `/` actions.** The composer's `/` menu (`PromptOptionsMenu`, the ONE `/` affordance) gains an **Actions** tab with a fixed list:
  - **Starter kit**: frontend × backend × extras, with a preview of the file tree and manifest;
  - **Create manifest from this app**;
  - **Run in browser**.

  Typing `/starter-kit angular-node --with redis,jobs` or `/manifest init` is parsed deterministically, with no model call, into the same action. The action registry lives in host-neutral `brain-embedded`, and brain-ui renders it. The web, canvas and VSIX composers share it.
- **`/help` is the default action (user, 2026-11-19).** A bare `/help`, a lone `/` followed by Enter, or an unknown `/command` lists **every available action** from the same registry. Each entry shows its typed syntax, a one-line description, its arguments (with the kits and extras taken from the `ide-templates` part registry, never a second list) and an example. `/help <action>` shows one entry in full.
  - `/help` is not hand-written copy. It is rendered from the registry entries, so an action added to the registry appears in `/help` with no other edit, and a test asserts that every registered action has help text in all five catalogs.
  - An action the current host or plan cannot run is shown disabled with the reason, never hidden (the RoleGate convention).
  - An unknown command answers "no such action" followed by the `/help` list, and never falls through to the model.
- **Each host writes through a `ScaffoldSink` port.**
  - Web/canvas writes the project's files through the files API.
  - The VSIX writes the workspace folder through `vscode.workspace.fs`.
  - Writing into a non-empty location needs a `useConfirm` approval. Existing files are never overwritten without it.
- **`/manifest init`** runs the blueprint detectors on the current files and calls `emitManifest(blueprint) → builderforce.json v1`. It shows the diff, writes on approval, then offers Run in browser. For this, **the detectors move (not copy) from `api/src/application/blueprint/detectors` into a host-neutral source package** (`packages/app-detect`, aliased wherever it is consumed). The VSIX and the web app then detect locally, and the API imports the same code. Wrangler `cron` and `queue` bindings map to jobs and queue resources. A new `docker-compose.yml` detector maps known images (`postgres`, `redis`/`valkey`, `minio`, `mailpit`) to resources and build contexts to services. Other images decline by name.
- **The kit matrix is the W11 acceptance.** In CI, every named kit (plus every extra on `react-node`) is scaffolded, its manifest parsed with zero issues, and the browser target accepts it. In the webcontainers CI (headless), each kit then:
  1. starts;
  2. returns 200 from `/health`;
  3. passes each resource smoke (jobs under a fake clock);
  4. sends diagnostics events at `verbose` on `local`;
  5. **injects no diagnostics script** under a `production` environment.

  The same matrix runs against `/manifest init` on the hired.video fork and the W9 fixtures.

#### Codemap

| Where | What |
|---|---|
| webcontainers `core/src/manifest/` | types, `parseManifest`, `validateManifest`, JSON Schema export, `toApplicationSpec`, `mergeOverrides`, resource-type registry |
| webcontainers `core/src/manifest/` (as built) | `tierEnv.ts` (convention table + `diagnosticsLevel`), `cron.ts` (`parseCron`, `nextFire`), `duration.ts`, `capabilities.ts`, `overrides.ts`, `toApplicationSpec.ts` |
| webcontainers `core/src/app/` | `jobDecision.ts` (Phase 5); `spec.ts` gains `jobs` and the `redis` engine (Phases 5–6) |
| webcontainers `core/src/diagnostics/` | `DiagnosticEvent`, the redaction helpers, the bounded ring |
| webcontainers `browser/src/app/` | `jobScheduler.ts` (single timer, leader via the extracted `navigator.locks` primitive), `redisProvider.ts`, `storageProvider.ts`, `mailProvider.ts`, replica round-robin in the port router, the diagnostics bridge |
| webcontainers `core/src/attribution.ts` | the `diagnostics` option and the drawer (split into `attribution/` once it passes ~400 lines: badge, drawer, tabs) |
| Builderforce `packages/creation-canvas-contract` | `AppBlueprint` imports the manifest types; `database` retired over expand/contract |
| Builderforce `packages/app-detect` (new, source-only) | detectors moved from the API, `emitManifest`, the compose detector |
| Builderforce `packages/ide-templates` | `kits/` parts + `composeKit`; `VANILLA_TEMPLATE` → `react-vite` |
| Builderforce `packages/brain-embedded` + `brain-ui` | the composer action registry and its deterministic parser; the Actions tab |
| Builderforce `api/src/application/infra/` | the `DeploymentTarget` port (W4's `InfraProvider`), the ledger, the cloudflare adapter, the OpenTofu emitter |
| Builderforce `frontend` | the Jobs tab in `LivePreviewPanel`; the blueprint card issues; `appDiagnostics.*` / `composerActions.*` in all five catalogs |

#### Phases (each ships on its own, with an automated exit test)

| Phase | Contents | Exit test |
|---|---|---|
| 1 | **Manifest v1**: parser, schema, typed issues, environments/tier/debug, `tierEnv`, `toApplicationSpec`; Builderforce detector and blueprint on it (expand migration) | Legacy and v1 files parse; a broken file shows issues; `debug` on production is an issue; hired.video's `*/5` cron appears as a job |
| 2 | **Manifest init**: `app-detect` package (move), `emitManifest`, compose detector, `/manifest init` action (web + VSIX) | detect → emit → parse round-trips with zero issues on the W9 fixtures and the hired.video fork |
| 3 | **Starter kits**: parts, `composeKit`, the six named kits, the `/` Actions tab, the typed command, `/help`, `ScaffoldSink` (web + VSIX) | Kit matrix steps 1–2 green for every named kit; `/help` lists every registered action with all five catalogs' text (registry-driven test) |
| 4 | **Diagnostics**: schema, producers, gate, browser bridge, badge drawer, labels | Matrix step 4 green at `verbose`; step 5 (production injects nothing) green |
| 5 | **Jobs + background workers**: cron, `jobDecision`, scheduler, leader tab, Jobs tab, `runtime.jobs.*` tools | Fake clock: `*/1` fires every minute, `forbid` holds, `missed: skip` after sleep, two tabs fire once |
| 6 | **Redis, no Lua** (D10) + `queue` on redis; kits gain `redis` / `queue` | Unmodified ioredis, redis-py and an RQ worker pass the parity suite; data survives restart and reload; two projects stay isolated |
| 7 | **Object storage, mail catcher, `scale`/`ingress`, Postgres `extensions`** (AGE from the spike) | S3 SDK upload/download parity; replicas expose an in-memory-session bug in a fixture |
| 8 | **Lua EVAL** | Unmodified BullMQ producer and worker |
| 9 | **`DeploymentTarget`**: browser adapter (wraps `RunTarget`), cloudflare adapter, OpenTofu emitter, promotion plan, `infra.*` tools; cloud diagnostics SSE behind signed debug tokens | A kit's `staging` plan → apply on a test Cloudflare account; the generated OpenTofu passes `tofu validate` per cloud |

#### Rev 2 — corrections from the design review (Opus, APPROVE WITH CHANGES, 2026-11-19). These override the sections above.

1. **`DeploymentTarget` is for durable infrastructure only** (plan/apply/destroy/drift), with adapters `cloudflare` and `customer-cloud`. Resource providers (neon, upstash) sit beneath it; they are not deployment targets.
   - Browser runs stay on the frontend `RunTarget`. There is no browser `DeploymentTarget` adapter.
   - **The capability matrix is data in core `manifest/capabilities.ts`** (resource type × target). `browserAcceptance.ts` and `DeploymentTarget.capabilities()` both read it, so nothing derives capabilities twice.
2. **Diagnostics never trust the previewed page.** Inside Builderforce (web and VSIX), the diagnostics view lives in **host chrome**: a tab beside the preview, and the launcher's own panel in the VSIX.
   - The in-page badge drawer stays, as the user asked. It is a module served beside the worker scripts, loaded with `script src` only when the level is not `off`.
   - It receives **only its own application's events**, through a port bound to (runtime nonce, project id), and **its threat model is stated in the docs**: anything it shows is readable by the app's own code, third-party dependencies included.
   - Phase 4 adds two negative exit tests: a frame from another project receives nothing, and a known injected secret printed to a log is scrubbed.
3. **Redaction.** The runtime scrubs the exact values it injects itself: database, RESP and S3 credentials, and vault values handed to it. Free-form logs are not claimed redacted beyond that.
   - The host injects its redactor (Builderforce: `packages/secret-redaction`) as a function. There is no second copy of the redaction logic in core.
4. **Composer commands, not actions.** `brain-embedded` (published, MIT, at `Builderforce.ai/brain-embedded`) holds a **composer command registry**: pure data, the deterministic parser and the `/help` model. "Action registry" already names the model's tools in `BrainActionsContext.tsx`.
   - **Hosts inject the entries.** The starter-kit entry is built by the host from `ide-templates`, a private source-only package that published packages may not import (source-package-graph rule 6).
5. **`PromptOptionsMenu` gains `'actions'`** in its `PromptOptionsTab` union, in `composerMenuRequest` and in its labels.
6. **Each extra ships in the phase that adds its runtime.** Phase 3 kits carry `postgres` only. `redis` arrives in Phase 6, `jobs` in Phase 5, and `storage`/`mail` in Phase 7. The Node `queue` part needs Lua (BullMQ) and lands in Phase 8; the Python `queue` part (RQ) lands in Phase 6.
7. **Release order.** Core gains a pure `./manifest` subpath (`sideEffects: false`). Phase 1 begins with a webcontainers release, and every consumer then adds the dependency: api, frontend, studio and **the VSIX**. `creation-canvas-contract` stays dependency-free and keeps its own blueprint types. The adapter between blueprint and manifest lives in `app-detect`.
8. **Reader compatibility, not migration.** `project_app_blueprints.blueprint` is a JSONB blob per (project, commit), and old rows stay. Old blueprints and unversioned `builderforce.json` files are read **permanently** through the parser's legacy path. Nothing is backfilled.
9. **Who decides production.** Builderforce-hosted surfaces (custom domains, marketplace listings, `<sub>.builderforce.ai`) **force `production`**, whatever the manifest says. Cloud diagnostics over server-sent events exist only on Builderforce-hosted and Cloudflare targets. Customer-cloud targets get none, which keeps them reproducible without Builderforce.
10. **Command parsing.** Only `^/[a-z][a-z-]*(\s|$)` is a command, so `/api/users returns 500` is a normal message, and `//` escapes a leading slash. A lone `/` still opens the `/` menu (its keyboard selection wins). `/help` is typed, or chosen from the Actions tab.
11. **Credentials for new resources.** `CREDENTIAL_POLICY` (`serviceEnv.ts`) widens from databases to every credentialed resource (Redis, S3, SMTP), so frontends never hold them.
    - Credentials are generated per client service: RESP `AUTH` and S3 keys follow the pg gateway pattern.
    - Data lives on the host origin under (project id, resource id).
    - Presigned S3 URLs reach the preview through the port router under the same policy.
12. **Exit tests, corrected.**
    - Phase 1 also proves a broken legacy file is *reported* (today it is dropped).
    - The `VANILLA_TEMPLATE` move keeps `scaffoldRepair` recognising projects already seeded.
    - Phase 9's `tofu validate` is a syntax check only, and the Cloudflare apply test is what proves the deploy.

#### Local launch from the VSIX (added 2026-11-19, user: test the support in the VSIX through a `/` command)

A VS Code webview cannot register the runtime's service worker, so the VSIX launches the app in a real browser through a **local launcher**. The launcher belongs to the MIT runtime, which makes it reusable outside the VSIX (e.g. as a CLI).

- **`createLocalLauncher({ projectDir, environment })`** is a Node module in webcontainers at `./launcher/server` (`node:http`, no dependencies). It serves three things:
  1. **the launcher host page** on `http://localhost:<port>/`;
  2. **the relay and runtime assets** (the service worker, `relay.html` and the process/language worker scripts) on loopback preview origins, `http://127.0.0.1:<port>` for the relay and `http://{key}.localhost:<port>` for each application, so control 1's per-app origins hold locally;
  3. **the project tree** at `/__bf/files`: read-only, bounded, excluding `node_modules`, `.git` and anything outside `projectDir`.

  **HTTPS, from a locally generated certificate authority (user, 2026-11-19).** All three kinds of origin are `https`. The runtime's https-only rule for previews stays exactly as it is, with no plain-`http` exception, not even for loopback.
  - **The authority.** The launcher creates a local certificate authority once, stored in the VSIX's global storage or `~/.builderforce/launcher-ca`, with the private key file at mode 0600. It is **name-constrained** (critical) to DNS `localhost` and `.localhost` and to IP `127.0.0.1`, so the key cannot vouch for any real site.
  - **The certificates.** A leaf certificate (valid at most 397 days) is issued per host on demand through SNI. Browsers ignore `*.localhost` wildcards, so each host needs its own. A name the Host allowlist refuses is refused at SNI as well.
  - **Trust needs your approval.** On the first `/launch`, the VSIX asks in a modal before trusting the certificate authority, and `/launch trust` repeats the step. It installs the authority in the **user** store: `certutil -user -addstore Root` on Windows, `security add-trusted-cert` into the login keychain on macOS, and printed steps on Linux, where the system store needs root.
  - **Declining still launches,** but the browser shows its certificate warning.
- **The launcher page** (in webcontainers `browser/src/launcher/`, plain DOM, labels injectable, English by default):
  1. reads `builderforce.json`;
  2. turns it into an application spec with `toApplicationSpec(manifest, environment)`;
  3. calls `startPreviewRuntime` (relay mode) and then `startApplicationRuntime` with every provider;
  4. shows each service's state and logs, the primary frontend in a frame, and the typed declines and issues when it cannot start.
- **VSIX `/` commands** go into the composer command registry and are run by the extension host:

  | Command | What it does |
  |---|---|
  | `/help` | Lists every command |
  | `/starter-kit <frontend>-<backend> [--with postgres]` | `composeKit`, then writes the kit into the workspace folder, with `useConfirm` approval when the folder is not empty |
  | `/manifest init` | Detects the app, writes `builderforce.json` after showing a diff |
  | `/launch [environment]` | Starts `createLocalLauncher` and opens its URL with `vscode.env.openExternal` |

  Each result is shown in the chat as a host message. None of them calls the model.

#### Risks

- **Browser lifetime.** Background tabs throttle and can be frozen or discarded. The scheduler runs in a worker, compares against the wall clock, catches up per `missed`, and labels every in-session job.
- **RESP engine fidelity.** Command semantics drift from real Redis. The parity suite against real Redis in CI guards it, and unsupported commands return an error naming the command.
- **Diagnostics leaking data.** Redaction happens at the producer. Production is off by construction. Cloud diagnostics need a member-only signed token.
- **Kit rot.** Framework versions move. Kits pin versions, and the matrix runs in CI, so a broken kit is red rather than silently stale.
- **AGE on PGlite.** Unproven, hence the spike. If it fails, graph stays cloud-only (Azure PG).

**Remaining (2026-11-19):** all of it. Design only.

### §4.7 MCP tool surface (spans W1–W10)

Each tool is added to the `builtinMcpService.ts` catalogs, grouped as data:

| Group | Tools |
|---|---|
| `runtime.*` | `start_preview`, `preview_status`, `preview_url`, `preview_logs`, `preview_restart`, `preview_screenshot`, `run_verify` — the same tools serve both run targets (W9); `preview_status` reports which target ran and why |
| `cloud_accounts.*` | `list`, `capabilities` (connect stays a human OAuth/token step) |
| `infra.*` | `plan`, `apply` (confirm-gated), `destroy` (confirm-gated), `list_resources`, `drift` |
| `secrets.*` | `list_names`, `missing`, `set` (value in, never out), `push` |
| `deploy.*` | `build`, `migrate`, `release`, `rollback`, `status` |
| `domains.*` | `claim`, `verify`, `status` |
| `marketplace.*` | `publish_project`, `publish_mobile`, `unpublish` |
| `projects.create` | + `companyId` |

**Remaining (verified 2026-11-17):**
- Only `app_blueprint.detect` / `app_blueprint.get` exist (`api/src/application/llm/appBlueprintToolCatalog.ts:78,105`). Every other group above is absent.

### §5 Sequencing and blockers

| Phase | Contents | Real blocker |
|---|---|---|
| 1 | W1 + W2 remainder + W8 remainder | Container image deploy + D6 |
| 1b | W9 phases 0–4 (webcontainers repo), in parallel | None |
| 1c | W9 phase 5 (`RunTarget`) | W2 blueprint; D7 for plan gating |
| 1d | W9 phases 6a–6d; phase 7 engine work in `@webdit/torch` in parallel (needs only 6a's Pyodide host) | None |
| 1e | W10 phases 0–3 (bypass fixtures, identity + port ownership, mandatory shield start, ingress, internal network + gateway auth) in the webcontainers repo, then phase 4 (egress CSP, quotas, VFS boundaries). Free-tier browser runs (D7) are not marketed as protected until phase 4's exit holds. | None. It is code. |
| 2 | W3 + W4 Cloudflare + Neon, W6 against the customer's account | A test Cloudflare account + Neon key |
| 3 | W7 project listings + `external` + mobile (EAS) | Stripe secrets for *paid* listings only |
| 4 | W5 hosted (WfP + Neon per app) | D1, D3, D4 |
| 5 | W3/W4 GCP, Azure, AWS | Test accounts per cloud |
| 1f | W11 phases 1–8 (manifest → init → kits → diagnostics → jobs → Redis → storage/mail/scale → Lua), in the webcontainers repo and Builderforce packages | None. It is code. |
| 2b | W11 phase 9 (`DeploymentTarget` = W4) | Same as phase 2: a test Cloudflare account |

**Program acceptance (against a hired.video fork, never production):**
1. Create a company, then a project under it, then connect the fork.
2. The blueprint matches the W2 acceptance.
3. The run loop works: an agent change is seen in `LivePreviewPanel`, and the PR is verified.
4. With the customer's Cloudflare + Neon connected: `infra.plan` shows 1 Worker, 3 DOs, 1 R2, 1 KV, 1 cron, 1 Neon project; `apply` succeeds; migrations run; the deploy serves on a custom domain.
5. A user signs up in hired's own auth (passkey + Google OAuth on hired's own origin).
6. The project is listed and launches in a new tab; an Expo sample app is listed with an `expo-update` QR that opens in Expo Go.
7. The same flow runs on Builderforce-hosted compute for a PRO tenant.

### §6 Risks

- **Workers for Platforms parity** with DO + cron + WebSocket hibernation — verify first (Phase 4 gate).
- **Browser tier (W9):** PGlite is single-connection (serialized, per-connection transactions); IndexedDB flush latency (benchmark both durability modes); browser memory caps (watch per service, bound result sets); the Worker boundary is not a security boundary against same-origin code (relay-origin isolation + HTTP-only preview code carry it). Mitigation: exceeding limits falls back to the container target with the reason shown.
- **Browser training (phase 7):** VRAM caps model size (LoRA/QLoRA on small bases); `torch` surface is a subset (unsupported ops error by name); JSPI and `shader-f16` not universal (test both readback bridges and an fp32 path); `device.lost` resumes from the last checkpoint.
- **Security Shield (W10):** false positives on developer apps that legitimately send SQL/HTML/shell text (start in observe, calibrate on the clean corpus, signatures stay narrow); added latency on every request (sync checks on the page side, bounded async inspection, p95 budgets re-based on Phase 0); a stalled Security Worker must hold, not open, protected traffic (enforcement and telemetry health are separate); CSP on worker scripts can break an installer whose host isn't allowlisted (default allowlist from the runtimes' own hosts; a blocked host is reported by name).
- **Language runtimes (phase 6):** Pyodide pure-Python/Pyodide-built wheels only (native-only declined by name); PHP extensions must be in the Wasm image; .NET Kestrel can't bind sockets (in-memory host); Rust in-browser compile unproven (prebuilt until its gate passes).
- **Container cost:** a live preview holds an instance; per-tenant cap (2) and global budget (15) hold; run loops are `containerRuntime`-entitled.
- **Neon quota:** per-app Neon lives in a separate Neon org/project set, never the core/apps endpoints.
- **Secret blast radius:** secrets as container env; `run_command` output redacted; fix the clone-token issue in the same image pass (scoped git proxy).
- **Reference-app finding:** hired.video reflects any `Origin` with credentials (`api/src/app.ts:246`); the blueprint's security checks should flag reflected-origin CORS in customer apps as a free diagnostic.

---

## PRD 18 — hired.video → Builderforce.ai port (Canvas runtimes and the Studio → Canvas port)

> Consolidated 2026-11-17 from `docs/specs/18-prd-hired-video-port.md`. Verified against code 2026-11-17: Mostly built. The canvas-runtime part on its own is Partly built.
> Finished sections are archived in DONE.md ("PRD 18: finished sections archived on consolidation"); section numbers are kept, so a gap in numbering is a shipped section.
> **Split across domains:**
> - **make** (this file): §1.3, T4, §8.1 and §8.4–§8.10.
> - **run:** the résumé journey §8.2/§8.3 and the agents.
> - **reach:** T5.
> - **platform:** cutover.
>
> The six editing runtimes (image, animation, podcast, comic, cad, model3d) are archived in DONE.md ("canvas runtimes and studio: six editors", 2026-11-08).

### §1.3 Canvas: fill the declared kinds
"Studio" is only the name of the hired.video source folder. It is never a Builderforce destination, page, panel or product area. Each runtime mounts as the editor body inside the existing Canvas for a kind that already exists. For `video`, AI tool calls emit the same typed Canvas operations as pointer and keyboard editing, and exported renditions are children of the editable object.

`media-kinds.ts` merges into **one** `CREATIVE_CAPABILITIES` table, extended with `outputProfiles` and `publishDestinations`, so the save menu, the export facade and MCP `creative.capabilities` agree. Preview tiles obey `creativePreviewImageUrl()`.

**Remaining (verified 2026-11-17):**
- **The capability contract and the frontend exporters disagree.** `packages/creation-canvas-contract/src/creativeCapabilities.ts:95-104` narrowed the table to "only what something writes". Since then the 2026-11-08 editors write more:

  | Kind | Frontend writes | Contract lists |
  |---|---|---|
  | `cad` | svg, dxf, pdf, stl, step (`frontend/src/lib/creation/cad/cadExport.ts`) | DXF only (`:207`) |
  | `comic` | cbz, png-strip, pdf (`lib/creation/comic/comicExport.ts`) | PNG, PDF (`:186`) |
  | `animation` | gif, apng (`lib/creation/animation/animationExport.ts:15`) | GIF, MP4 (`:169`) |
  | `image` | png, webp (`lib/creation/image/imageEdit.ts:25`) | PNG, JPG (`:161`) |
  | `model3d` | stl, step (`components/creation-canvas/model3d/Model3dExportRow.tsx:16`) | STL (`:215`) |

  Re-derive the contract rows from the exporters, with `producer: 'canvasExports'`, and add a test that keeps the two in step.

### T4 · Canvas runtimes
Each runtime mounts as a **Canvas stage mode**, never as a page, panel, "Studio" destination or separately mounted editor. Switching kind is Canvas state, not navigation.

There is **one display/camera capture primitive** (`lib/useDisplayCapture.ts` + `lib/useCameraCapture.ts`, built), and each consumer attaches its own sink.

Per-slice rules (still binding):
- Every ported component is localized in all five catalogs.
- It works in light, dark and at 360px.
- Runtimes declare their own canvas palette.
- The prompt stays bottom-centre.
- Panels are `SlideOutPanel`.
- Heavy deps (`@react-three/*`, `ag-psd`, `jszip`, `mediapipe`, `tiptap`) are dynamically imported per runtime.

`@seanhogg/builderforce-studio` (the generator) and the ported editor are two stages of one pipeline. They are not two `video` kinds.

**Remaining (verified 2026-11-17):**
- There is no shared runtime shell: editor tabs, layers panel, positioned widgets, properties inspector or capability-driven save menu (§8.5). No positioned-widget model exists in `frontend/src/lib/creation/*`.
- The image runtime has crop, rotate, adjust and annotate only (`lib/creation/image/imageEdit.ts:43-54`). There are no layers, brushes or PSD (`ag-psd`: 0 hits).
- The game runtime plays and ships (`bodies/GameBody.tsx:81-105`, `api/src/application/game/adapters/*`), but it has no authoring stage.

### §8.1 Audit method, scope and status vocabulary
| Status | Meaning |
|---|---|
| **PORTED** | User-reachable in the existing Canvas, persisted, and backed by a real implementation. |
| **PARTIAL** | Some behaviour exists, but Hired parity or the end-to-end user journey is incomplete. |
| **DECLARED** | The kind, action or manifest exists, but the Hired editor/runtime is not mounted. |
| **MISSING** | No Builderforce user-facing implementation was found. |
| **REPLACE** | Hired behaviour must use an existing Builderforce convention rather than be copied literally. |

Where Hired is itself incomplete (scaffolds, deferrals), Builderforce either finishes the behaviour against the acceptance gate or records a product-approved removal. A matching type, manifest entry or API client does not count as ported.

### §8.4 Studio landing, template discovery and project chrome
**Remaining (verified 2026-11-17).** Rows are copied from source lines 960–999 with their statuses unchanged.

| ID | Feature | Status |
|---|---|---|
| S-005 | Guided creation wizard | PARTIAL |
| S-011 | Deep-link to template, content type, capture or subject | MISSING |
| S-012 | Owned, purchased and creator templates | PARTIAL |
| S-014 | Template preview, details and related templates | MISSING |
| S-015 | Apply template with source-résumé selection | MISSING |
| S-017 | Project thumbnail per runtime | PARTIAL |
| S-019 | Project status and visibility chips | PARTIAL |
| S-022 | Delete project with confirmation | PARTIAL |
| S-029 | Public share link and editor link | PARTIAL |
| S-030 | Published-destination list and republish | MISSING |
| S-035 | Copy, cut, paste, duplicate and delete shortcuts per object | PARTIAL |
| S-037 | Light, dark and mobile layouts per runtime | PARTIAL |
| S-038 | Localized user-visible copy | PARTIAL |

### §8.5 Shared editor chrome and direct-manipulation inventory
**Remaining (verified 2026-11-17).** Source lines 1003–1052, every row except E-024, E-047 and E-048, statuses unchanged.

- **MISSING:**
  - **Panels and stage:** E-001 left tabs, E-002 resizable panels, E-006 widget select and layers, E-009 position presets, E-010 layer panel, E-012 safe-zone overlay, E-015 preview overlay.
  - **Widgets:** E-017 text, E-018 heading, E-019 shapes, E-020 divider, E-025 chips, E-026 CTA, E-027 speech bubble, E-028 caption box, E-029 SFX burst, E-030 avatar presenter, E-032 engagement widgets.
  - **Widget properties:** E-034 container styling, E-035 motion presets, E-037 effects and filters, E-040 chroma key, E-041 shape styling, E-043 CTA styling, E-045 subject seed banner.
- **DECLARED:** E-003 runtime router by `mediaKind`, E-021 image widget, E-044 avatar editor.
- **PARTIAL:** E-004 rail (other runtimes), E-005 stage aspect ratio, E-007 multi-select, E-008 transform handles, E-011 stage zoom, E-013 background, E-014 preview controls, E-016 shortcut suppression, E-022 video widget, E-023 webcam widget, E-031 linked-entity widgets, E-033 widget inspector, E-036 widget timing, E-038 text inspector, E-039 image inspector, E-042 chart inspector, E-046 runtime drag/drop.

### §8.6 Recording, media, AI, engagement and advisory actions
**Remaining (verified 2026-11-17).** Source lines 1056–1092, every row except A-007, A-008 and A-019.

- **MISSING:**
  - A-003 stock-media picker. The route exists (`api/src/presentation/routes/creativeRoutes.ts:229`); no Canvas picker uses it.
  - A-005 AI headshot, A-006 screenshot → image widget, A-009 screen + picture-in-picture (0 hits), A-011 recorder deep-link.
  - A-013 music composer, A-014 music catalog, A-016 ducking (0 hits), A-020 dubbing (0 hits), A-021 WCAG advisory.
  - A-024 time-pinned review, A-025 video forms, A-026 thumbnail generator, A-027 delivery coach, A-028 video analytics, A-029 ATS package, A-030 async interview manager, A-031 banner generator.
  - A-032 brand kits and remove-branding, A-034 attach to course lesson, A-035 page embed management.
- **PARTIAL:** A-001/A-002 source bin, A-004 AI image placement, A-010 overlay vs full-bleed capture, A-012 voiceover, A-015 mixer, A-017 auto-transcribed captions, A-018 caption style and position, A-022/A-023 dedicated AI rewrite and hook, A-033 voice-clone Canvas UI.

### §8.7 Runtime-by-runtime parity (re-verified 2026-11-17)
**Video, podcast and voice:**
- **PARTIAL:**
  - V-007 pointer drag and ripple.
  - V-017 H.264 profile. `lib/canvasVideoRender.ts:13` selects VP9/VP8 WebM only.
  - V-019 podcast profiles: an editor and RSS exist (`lib/creation/podcast/{podcastRss,podcastPublish}.ts`), but there is no audio render.
  - V-024 RSS destination: RSS is built; Apple and Spotify are not.
- **MISSING:** V-010 crop and positioned overlays, V-011 multicam, V-012 motion presets, V-013 filters and chroma key, V-018 H.265/ProRes/DNxHD profiles, V-022 LinkedIn publish, V-023 profile publish.
- **DECLARED:** V-020 voice MP3/WAV/Opus.

**Image/drawing:** the editor is built (`components/creation-canvas/image/*`) with crop, rotate, adjust, annotate strokes and PNG/WebP export.
- **MISSING:** I-002 brush, eraser, fill, eyedropper and marquee; I-003/I-004/I-005 layers; I-006 layer filters and transforms; I-007 marquee inpaint; I-009 recent colours; I-010 floating palette; I-011 PSD; I-012 spilling large layers to R2; I-015 gallery publish.
- **PARTIAL:** I-008 AI inpaint and outpaint, I-013 asset-library save.
- I-001 and I-014 are now PARTIAL: there is a true-size stage and PNG/WebP export, but no JPEG.

**Animation:** frames rail, paint stage, hold/fps/onion skin, and GIF + APNG export are built (`components/creation-canvas/animation/*`, `lib/creation/animation/*`).
- **Remaining:** AN-004 AI frame insertion into the rail, animated WebP, AN-006 transparent MP4, AN-007 Giphy/Tenor/CDN publish.

**Games:** play iframe and ship targets (web, pwa, android, ios, roblox) are built.
- **MISSING:** G-003 play/edit mode, G-004 level rail, G-005 sprite library, G-006 entity palette, G-007 physics, G-008 blocks, G-009 scripts, G-010 AI behaviours, G-011 challenges, G-015 itch.io / GitHub Pages.
- **PARTIAL:** G-002 3D world stage (a 3D play surface exists), G-012 game room (no `GameSignalingRoom`).

**Comics:** page/panel stage, bubbles, branching, reader, and PNG strip / PDF / CBZ are built (`components/creation-canvas/comic/*`).
- **Remaining:** C-005 AI page builder into panels, C-009 motion comic MP4/GIF, C-010 Webtoon/Tapas destinations.

**CAD and 3D:** CAD sheet, layers, draw tools, template seeds (`lib/creation/cad/cadTemplates.ts:35`), SVG/DXF/PDF/STL/STEP export, and the 3D viewport with parts are built.
- **Remaining:** 3D PNG export, D-010 3D seeds (not verified), D-012 gallery publish.

### §8.8 Full Hired template-catalog inventory
`components/studio/templates/catalog.tsx` (hired.video) resolves to 90 visible entries. Only the 12 résumé designs and 15 video résumés are ported. Every other family is **MISSING**:
- documents
- general/career video
- hiring/company video
- learning video
- film/casting
- podcast
- voice
- games
- drawing
- animation
- CAD
- CAD 3D
- display/social ads (14 IAB sizes)
- linear comics (12)
- interactive comics (3)

The family IDs are at source lines 1218–1232.

A catalog entry is complete only when it has all of the following:
- a localized name and description;
- a real thumbnail;
- category and media-kind filters;
- preview and details;
- a seed that produces editable runtime state;
- template-application tests;
- the expected export.

A card that only stores the template ID fails this gate.

### §8.9 Export, publish and lifecycle parity
**Remaining (verified 2026-11-17):**
- **MISSING:** X-005 Free/Pro output-profile gating; X-007 podcast and X-008 voice audio profiles; X-009 animation profiles (WebP and transparent MP4; GIF and APNG are built); X-010 itch ZIP; X-014 CAD 3D PNG; X-018 publish history with view and republish; X-020–X-026 destinations (podcast, voice, animation, game, comic, image/CAD gallery, course attach); X-028 brand watermark and remove-branding.
- **PARTIAL:** X-002 save-options menu derived from the capability registry (blocked on the §1.3 drift fix), X-006 explicit video codec selection, X-011 comic (now PNG strip, PDF and CBZ; motion is missing), X-012 image (no JPEG or PSD), X-013 CAD (now SVG, PDF, DXF, STL and STEP; PNG is missing), X-015 document PNG, X-019 LinkedIn and profile destinations, X-027 creative-artifact visibility, X-030 progress, failure and retry. `creation-canvas/creative/useExportArtifact.ts` covers the six editors; cancellation is missing.

### §8.10 Port order and acceptance gates
No slice may be marked complete from file presence alone. Open gates:
4. **Shared runtime shell.** Editor tabs, rails, stage overlays, properties, layers, media and action panels, the keyboard map and a capability-driven save menu. Prove §8.5–§8.6.
5. **Time-based runtime.** Extend `CanvasVideoEditor` rather than forking it. Port scenes, widgets, NLE, audio, captions, engagement, and all video, podcast and voice profiles.
6. **Static and interactive runtimes.** Finish image/drawing (layers, PSD) and the game authoring stage. Animation, comics and CAD/3D need only the tail rows above.
7. **Catalog and publishing.** Register all 90 Hired Studio entries in the canonical Builderforce template service, then port the destination adapters and publication history.

Global completion gate:
- Every row in §8 is **PORTED**, or deliberately **REPLACE** with tested Builderforce-equivalent behaviour. No MISSING, DECLARED or PARTIAL row remains.
- AI and direct manipulation write the same object and revision; every export is a rendition child.
- Template and capability registries have source-to-catalog localization tests for en/zh/es/fr/de.
- Runtime bundles are dynamically loaded and meet the Canvas bundle and performance budget.
- Focused unit, integration and Playwright tests cover each status row. The release checklist links the test or product decision that changed each row to PORTED or REPLACE.
