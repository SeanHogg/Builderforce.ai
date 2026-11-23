# Builderforce.ai — Roadmap & Gap Register

> **Outstanding work only.** Finished work moves to [DONE.md](./DONE.md). Validated against the code 2026-10-31. Entries sit under the arc stage they move a user through; work that moves nobody through the arc is under OTHER. Tags are the domains in [DomainService.ts](./api/src/application/kernel/DomainService.ts).
>
> **Traffic, 30 days to 2026-10-25:** VS Code 452 runs, Web ≈230 calls, cloud tickets 4 runs.

## How an entry is written

One line: the gap, the next step or done-when, and `*Blocker: …*` if there is one. **No blocker named means not blocked**; scheduling around other work is not a blocker. Detail lives in the PRD or the code, not here. Human or production validation is never an entry or a blocker: telemetry and logs validate shipped work. A Build item names its proof form and kill condition. Authenticated UI meets PRD 21.

## North Star — Idea to Real

Vocabulary is spec data, ratcheted by `frontend/scripts/check-methodology.mjs`.

- **Arc:** `Idea → Make → Run → Measure → Reach` (`ARC_STAGES`, [navGroups.ts](./frontend/src/lib/navGroups.ts)).
- **Loop:** `Read → Prove → Build`, crossing Idea into Make. Read and Prove spend nothing; Build spends run budget ([application/realization/](./api/src/application/realization/)).
- **Proof forms:** `PROOF_FORMS` in [methodology.ts](./frontend/src/lib/methodology.ts). A new one is a registry entry, never a branch. Each proof carries a kill condition graded in Measure.

Enabling work never outranks a broken Idea→Real journey.

**North-star metric:** share of ideas reaching a graded proof. Contract: [measure.md › Creation outcome metrics](./docs/specs/measure.md#design--creation-outcome-metrics).

## Claim-to-Proof

Public copy states today's evidence. **Available** = shipped and repeatably verified · **Beta** = named limitation · **Planned** = never presented as current. These are the statuses in `MARKETING_CLAIMS` ([product.ts](./frontend/src/lib/content/product.ts)), which holds the reviewed wording; this table holds what each promise still needs.

| P | Promise | Status | Proof still missing |
|---|---|---|---|
| P0 | One canvas from idea to real | Beta | A release gate per marketed artifact. `qa-e2e` runs in no workflow and its `ci` script swallows failure |
| P0 | People control agent work | Beta | Wired, failing closed and guarded in CI (2026-11-08). Still missing: a release that ships it on green CI |
| P0 | Complete agent auditability | Beta | The `mutationAudit` envelope exists and covers the governance and security writes. Still missing: coverage at every other mutation entry point |
| P0 | Private, local AI work | Planned | A boundary manifest per action, shown before execution |
| P1 | Evermind stays current | Beta | Freshness budgets, stale-recall evals, contradiction detection beyond docs |
| P1 | Same work in VS Code | Beta | A web↔extension parity matrix; contract tests are partial |
| P1 | Connected delivery, no sprawl | Beta | Health and recovery in `connectorManifest.ts`; board sync has them |
| P1 | Costs connect to outcomes | Beta | Unattributed-spend coverage and reconciliation |
| P2 | Create "anything" | Beta | Limits, exports and owner in `creationObjectRegistry` |
| P2 | Model/provider freedom | Planned | Provider copy from the live catalog; "30+ providers" is hardcoded |
| P2 | Fair comparisons | Planned | Sourced, dated, expiring vendor facts |
| P2 | Value for CEOs/revenue leaders | Beta | Measured production values and one customer proof |

## Programs

- **hired.video absorption** ([PRD 18](./docs/specs/platform.md#prd-18--hiredvideo--builderforceai-port-cutover-and-retirement)): deprecate to a redirect shell. Every table maps to a primitive (`docs/specs/data-model/source-to-target.tsv`); the rest is application code.
- **burnrateos.com shutdown** ([PRD 19](./docs/specs/run.md)): an unbuilt, unretired capability is lost at shutdown. Held by `check:burnrate-parity`, `check:no-burnrate-runtime`, `check:burnrate-policy`. *Blocker: operator provider actions, identity-cutover comms, redirect verification.*


---

## Consolidated Gap Register — by stage of the arc

| Stage | Holds | Next milestone |
|---|---|---|
| [💡 Idea](#-idea--read--prove) | Sessions, briefs, choosing and running a cheap proof | Experiment verdicts; validate by asking the market |
| [🔨 Make](#-make--build) | Agents and people building: runs, boards, canvas runtimes, previews, hosting | One execution core; live preview on |
| [⚙️ Run](#️-run--operate-the-company) | Finance, hiring, people, governance, phone, investor | SOC 2 Type I |
| [📊 Measure](#-measure--grade-the-proof) | Grading proofs and seats: metrics, experiments, OKRs, sessions | `experiment` cards measured |
| [📣 Reach](#-reach--sell-be-found-grow) | Billing, marketplace, marketing, SEO, distribution | First paying tenant; first customer proof |
| [🧰 OTHER](#-other--enabling-work-outside-the-arc) | CI, gateway, Evermind, runtime, data model, code health, infrastructure | $0 platform plan |

---

## 💡 Idea — Read · Prove

- **[canvas] `creation_tutorial_step_completed` is never emitted,** so the creation product-event family is incomplete. Emit it from the tutorial step, or drop it from the family. [idea.md › Creation Canvas](./docs/specs/idea.md#operations--observe-product-event-family)
- **[canvas] `creation_legacy_route_adapted` has no emitter,** so the legacy-route redirects shipped without the telemetry they were meant to wait for. Emit it from the three redirect clients and the middleware branch, or drop it from the product-event family. [idea.md › Creation Canvas](./docs/specs/idea.md#delivery-sequence--phase-4-route-consolidation)
- **[canvas] `/workflows` still renders its own list.** `WorkflowsPageBody.tsx` shows `WorkflowsContent`, not the Create library filtered to Workflow objects; the other legacy entries already forward into Create. Route it the same way. [idea.md › Creation Canvas](./docs/specs/idea.md#recommendation--legacy-entry-points)
- **[canvas] Ideas surface reads unfinished.** Lede and empty body repeat "the prompt below", Capture misses request-shaped text, Brain's "no data" reply asks for an object ID. Mockup: https://claude.ai/artifact/KcEJGhrZaQMQWEMSHNJjyE. *Blocker: operator go-ahead.*
- **[canvas] Experiment templates and verdict.** Smoke test and wizard-of-oz exist. Add A/B and concierge templates, a decision-rule field, and a pursue / pivot / kill verdict (`revealIdea` grades met/missed only). Build as proof-form registry data.
- **[canvas] Survey delivery gaps.** `CampaignTransport` has no `twilio` or `scheduledAt` though the server supports both; clicks record no link (a per-link registry also closes the `?u=` open redirect); the CSAT/NPS widget has no renderer.
- **[canvas] Idea-born survey defaults** (recommended): anonymous yes; 14-day close; Ask + Publish for any editor, Send keeps the `manager` gate; state suppression before send. *Blocker: operator decision.*
- **[canvas] Wizard-of-oz `/queue` and pilot `/pilot-report` are public and expose contacts** (`verify: 'none'`). Fix with a read secret, signed link or authenticated console. *Blocker: product decision on where the console lives.*

---

## 🔨 Make — Build

### Cloud and IDE agent runs `[agents]`


- **Run diagnostics report `healthy` for an unanswered, wasteful run (chat #168571, found 2026-11-21).** `brainTriage`/`brainVerdict` never read `agent.stopped`, `llm.complete.args.failovers` or question intent, and the `runFindings` detectors are not wired into the verdict; 13 failovers counted as 0. Fix underway (chat #289 W0/W1): outcome-first triage, findings-driven precedence table, JSON schemaVersion 2.
- **Pasted context misroutes a question to the full pipeline (chat #168571).** `pipeline-route` tests change verbs against the whole text including the paste, and a second classifier (`agent-stall/requestIntent.ts`) can disagree. Fix underway (W2): one `classifyRequest` scoring the ask only; questions route quick with no `commit` ship policy.
- **Question runs have no answer budget (chat #168571).** `run-guards` gates `read_only_streak` on `expectsChange`, `remember_fact` resets the streak, and plan budgets return null for non-budgeted runs — 13 turns of reads ran unsteered. Fix underway (W3): `answer_due` signal + bookkeeping-neutral tool metadata.
- **Growing narration restatements are re-read every turn (chat #168571).** `foldRepeatedNarration` only folds at whole-text overlap ≥ 0.8, so 5 restatements fed a 555K cumulative prompt. Fix underway (W5): shared `leadSentenceOverlap` ≥ 0.7, keep only new sentences.
- **Preflight is serial and unbounded; search walks the whole tree (chat #168571).** Recall/answerFromMemory have no timeout (~13 s before the first turn), `search_code` ignores the `path` scope for ripgrep (15 s/call), `find_symbol` refresh blocks callers, and the read-only hand list splits parallel batches. Fix underway (W6): deadlines + `run.preflight` step, scoped rg, stale-while-revalidate index, metadata-driven batching.

- **Empty server chats left by the old bind race (chat #165961 follow-up).** Before the chat bind lease, a bind racing the chat's own import left an empty server chat (e.g. 281, tenant 1) beside the real one (282). New ones can no longer be created; the existing orphans remain. Clean up empty, unmapped chats that a later chat with the same client id superseded. *Blocker: operator go-ahead to delete server rows.*
- **Stray `chat-ticket-link` mappings cannot be deleted (chat #165961 follow-up).** The local-first store contract has no mapping-delete API, so a misfiled link's mapping (another device's link id → server id) stays after its record is retired. Readers now ignore it (derived-id ingest; tombstones scan every mapping carrying the key), but it is dead state. Add a mapping-delete to the store contract (storage-format change) and drop strays in `retireMisfiledLinks`.
- **The shared progress detector counts ticket writes as progress (chat #165961 follow-up).** `brain-embedded/src/runStore/progressGuard.ts` `isPlatformProgress: isMutatingPlatformTool` lets a coder that only files and moves tickets read as progressing. Not involved in #165961, and the detector is shared with the cloud loop (`packages/run-guards`), so this needs a decision for both loops: count only code changes on change requests.
- **The forced change turn has no blocker escape (chat #165961 follow-up).** The one-time deferral of a stalled finish (`progressGuard.ts` `deferredFinishTurn`, design #157440) offers only edit tools with a call required and no `ask_user`, so a coder that is genuinely blocked must still write something or wait for the next trip. Add a typed blocker report the turn may return instead of an edit.
- **A host run could lose crash recovery if the rail ever ingests it (chat #165961 follow-up).** Recovery now skips `evidence: "server-observed"` rows (`clients/vscode/src/runRecovery.ts` `isHostJournaledRun`). `ingestServerRecords` maps executions by server id within the tenant, so if a mirrored host run's sync id ever matched a rail-listed execution, ingest would overwrite the host row's provenance and recovery would silently skip it. Key the rail's execution ingest by execution id only, never into mirror rows.
- **The PreFetch cache-hit and latency done-checks are unmeasured.** Add the turn-2 cache-hit probe (at least 90%) and the gate latency measurement (at most 30 ms p50 without tier 3, at most 300 ms p95 with it). [make.md › PreFetch](./docs/specs/make.md#done-checks--remaining-prefetch)
- **Desktop `bf-index` search is still brute force.** Only the shared comparator was ported. Bring full graph-index parity to `builderforce-inference/crates/bf-index`. [make.md › Knowledge index](./docs/specs/make.md#open-decision-2-follow-up)
- **The knowledge index's speed and recall are unproven.** Add a 50k-card benchmark (p50 at most 20 ms, p95 at most 60 ms) and labelled recall@10 fixtures for code and for docs `expand`. [make.md › Knowledge index](./docs/specs/make.md#done-checks--remaining)
- **`memory_recall` ignores the knowledge index.** builderforce-memory `memory-mcp` never consults it. Make project- and root-scoped recall query the index with expansion before text recall. [make.md › Knowledge index](./docs/specs/make.md#consumers--memory-recall)
- **The graph hand-off to the knowledge worker is unmeasured (PRD 43 Part A).** Measure the structured clone (`compute/client.ts`) and the `useKnowledgeGraph` JSON parse on the harness graph. If either is over 50 ms, send pack bytes instead of objects. [make.md › PRD 43](./docs/specs/make.md#part-a--still-open)
- **Knowledge graph opens and act-on-finding are not instrumented (PRD 38 §7).** Emit the open, entry-point and act-on-finding events, so the eight-week kill condition can be read. [make.md › PRD 38](./docs/specs/make.md#7-measure)
- **No knowledge data pack for json, yaml and csv (PRD 38, later).** Add it beside `docs.ts` in builderforce-memory `knowledge/packs/`. [make.md › PRD 38](./docs/specs/make.md#the-data-pack-later)
- **No automated check for the visualizer's acceptance (PRD 38 Option B+).** Over a reviewed graph, measure the 'No partition' share (at most 5%) and compare the server source count with the local one. [make.md › PRD 38](./docs/specs/make.md#the-visualizer-option-b-acceptance)
- **No recorded pass of the `agentic` knowledge review (PRD 38).** Read it from the review telemetry (`reviewTimings.ts` and the output channel). Done when a review of the workspace finishes and the graph opens. [make.md › PRD 38](./docs/specs/make.md#a-knowledge-review-of-the-agentic-workspace-fails--acceptance)
- **Run delta and offline use are unmeasurable (PRD 41 §10, §C11).** `offline.session`, `delta.card_opened` and `delta.finding_action` are never emitted. Emit them so the Use and Value metrics and the 8-week kill condition can be read. [make.md › PRD 41](./docs/specs/make.md#10-measure--still-unmeasurable)
- **People scores have no DPIA notice, export or erasure (PRD 41 §D14, WS22).** Add the DPIA notice on enable, the person's own access/export path, and erasure with run-role pseudonymisation. Done when the D14.7 checks pass. [make.md › PRD 41](./docs/specs/make.md#d14-people-scores-for-managers--d146-data-subject-rights-and-d147-done-checks)
- **The run delta has no narrative summary (PRD 41 §C13, optional).** Add one model call per `digest`, cached, labelled with the model and post-checked against the delta rows; omit it when there is no route. [make.md › PRD 41](./docs/specs/make.md#c13-narrative-optional)
- **No PREFETCH answer action reads L1–L2 facts (PRD 41 §B10).** Register 'where is X defined', 'who calls X' and 'what layer' as deterministic answer actions in `packages/prefetch`. [make.md › PRD 41](./docs/specs/make.md#b10-who-reads-it)
- **The determinism oracle runs on one OS only (PRD 41 §B8).** Add a CI job that compares `canonicalDump` across Windows (autocrlf) and Linux over 500 seeded edit sequences. It gates every Part B workstream. [make.md › PRD 41](./docs/specs/make.md#b8-determinism-rules--rule-6-the-oracle-test)
- **No incremental tree-sitter parse of open documents (PRD 41 §B3).** Keep trees for open documents and apply `tree.edit()` on each change, so re-extracting a typed-in file costs only the edited region. [make.md › PRD 41](./docs/specs/make.md#b3-extraction-one-extractor-per-language-tree-sitter-in-node-hosts)
- **Knowledge change detection has no perf test (PRD 41 §B2).** Assert a warm plan of the `agentic` tree under 3 s and a cold plan in git under 30 s. [make.md › PRD 41](./docs/specs/make.md#b2-change-detection--targets)
- **No network-denied map-digest test (PRD 41 §A7).** Add a drawn-model digest test on a linked workspace of about 2,000 files: the offline map equals the online map, is unchanged against an older API, and opens after a review that hits 429 on every sync. [make.md › PRD 41](./docs/specs/make.md#a7-the-visualizer-draws-from-the-local-projection--acceptance-only)
- **No golden-path cloud-agent E2E (PRD 09 §5),** so the §3 validation matrix is unproven. Add the scripted `qa-e2e` run (dispatch, clone, file change, steering, finalize or `pr_skipped`, telemetry reconstruction, teardown). Done when `pnpm qa:cloud-agents` passes three times in a row. [make.md › PRD 09](./docs/specs/make.md#5-golden-path-e2e-the-operators-self-validation-button)
- **Cloud runs: ten PRD 09 gaps beyond egress are open.** P0: a start-timeout and a test for the dropped dispatch→`CloudRunnerDO` handoff (D2), and a per-cloud-agent budget ceiling (B1). P1/P2: `no_changes` status (W5), mergeability (W6), typed `provider_auth_failed` (W7), a repo-size ceiling (W9), branch collision (W10), a workspace-outside-checkout assertion (W12), typed `no_repository` (D4), a model-entitlement pre-flight (E6). [make.md › PRD 09](./docs/specs/make.md#4-open-gaps)
- **In VS Code, the progress guard's final no-tools `finish` turn is answered under the `chat` role, not the run's coding role.** The guard shipped on 2026-11-16 (VS Code 2026.10.187).
  - The Brain host forces the finish as a menu with `tools: []` from `brain-embedded/src/runStore/progressGuard.ts`, while agent-run's A3 lever stays off on the Brain. So `selection.final` and `PolicyContext.finalTurn` are never set there.
  - The model still comes from the run when one is held. Only the role's token cap differs, and the report is still written.
  - Fix: mark the Brain's forced finish turn as `final` so role resolution keeps the prior role, the way `packages/agent-run/src/policy/model/index.ts` already does for the cloud. This makes both hosts behave the same.

- **VS Code runs pay a full prompt per tool call ([PRD 45](./docs/specs/make.md) §4.7 loop economics).** The deterministic gates shipped 2026-11-10 (see DONE.md), and the §4.7 loop-economics items are now shipped too — outline-first reads (lever c10), edit-file batching, the readiness steer, batching nudge, folded stale reads, the host progress line, the tools-advertised counter, and the ticket re-title pass are all wired and tested (B1–B9). Chat #216's 2.08M prompt tokens motivated them; what remains is only the measurement: G4 (halve prompt tokens per unit of work) has no post-gate outcome scoring — a replay re-derives the pre-gate baseline only, so the §8 targets need a fresh run of the same task (PRD §W9, tracked open there).
- **A2A extension (`agent-runtime/extensions/a2a`) — concrete defects fixed; direction still open.** The shippability blockers are now closed: `inbound.ts` passes `runEmbeddedAgent`'s required `runId`/`timeoutMs`, the wire format is the shared A2A transport (`packages/agent-tools/src/a2a.ts`), `spawn("claude")` resolves on Windows (locates `claude.cmd` explicitly and spawns it shell-free with cmd-verbatim quoting), the dead `spawnSync` import and the phantom stdio bridge are gone, and `inbound.test.ts` covers the handler. What remains is a product decision, not a defect: the current wire contract is the simple `message.parts[]` envelope, not full A2A **JSON-RPC + Agent Card**, and the Claude Code spawn passes no **permission mode**. A security finding is tracked out of source control in SECURITY-FINDINGS.local.md. *Blocker: operator decision — rebuild on real A2A (JSON-RPC + Agent Card, Agent SDK for Claude Code, MCP for the inbound direction) or keep the current lightweight bridge.*

- **No source of recorded runtime values for the knowledge view (PRD 38).** Several features are wired and tested but have nothing to show yet: [make.md › PRD 38 Predicted measures](./docs/specs/make.md#predicted-measures-deterministic-ml-over-the-graph)
  - The Simulate drawer's recorded and editable values, which use the optional `recordedValues` source port.
  - Path-hop payload sizes ("PUT 1.4 MB"), which need a `payloadBytes` file badge.
  - The Sync drawer's "Traces" row.

  Each one stays honestly empty and never shows a guess. Hop labels show the route only. The cause is that nothing captures the argument and return value at each stop, or the request and response size, during a request or test run. Static extraction (`codeFileBadges`) cannot see these. What fixing it needs:
  - a runtime recorder;
  - a traces source that serves its output to `recordedValues`;
  - a `payloadBytes` badge.

  *Blocker: no runtime trace recorder exists. It is a new subsystem, a candidate for PRD 41's run delta.*
- **Predicted measures over the knowledge graph: the P1/P4/P7 view work is committed; P2 is blocked.** The memory maths, git history and cache keys are done (DONE.md, 2026-11-10). The view work (P1 placement fixes, P4 partner surfaces, Hidden coupling, P7 Simulate) landed in `7674bbd64` (2026-11-10, "Improvements") with the perf baseline redone in `0196e5683`; `EXTRACTOR_VERSION` 7 shipped in memory v2026.10.81/82 and consumers are on ^2026.10.82. Still open ([PRD 38 › Predicted measures](./docs/specs/make.md#prd-38--the-knowledge-graph-any-directory-code-and-docs-first)):
  - **`7674bbd64` has no recorded review.** Run one Opus review over the knowledge-graph-view part of that commit.
  - **`FixStepRequest.partnerTests` is read by no host.** `useFixFlow` sends it. Wire it into the host's Run checks step, or drop the field if no host implements the fix ports.
  - **The builderforce-memory CHANGELOG still lists `EXTRACTOR_VERSION` 7 under "Unreleased".** Move it under v2026.10.81.
  - **P7 has no trace rows.** `transitionTableOf(graph, model, sequences?)` accepts run traces, but no caller passes any, so every hop reads from reference weights. *Blocker: there is no station-level source of recorded run traces. `RecordedRun` is fetched for one path, along that path, so feeding it in would turn each hop into an invented 1-of-1 trace.*
  - **P4 acceptance (recall@8 ≥ 0.5) has not been measured.** Run memory's `coChangeRecallAtK` on the `agentic` repo history.
  - **`runDeltaPorts.churnAt` drops history warnings.** It builds its git port without an `onWarn`, so the commit-cap and timeout warnings are never shown on that path (`clients/vscode/src/runDelta/runDeltaPorts.ts`).
  - **P2 is blocked.** *Blocker: PRD 41 Part D has produced no `risk`, `ownerEntropy` or `busFactor` result yet.*
  - **The shared maths stays in the builderforce-memory `stats` module** (D13).
- **Large local-first store: open and drain times not yet confirmed on an idle machine (2026-11-10).**
  - **What shipped (ad02c2efe):** receipt pruning. The compacted base went from 221.8 MB to 199.8 MB.
  - **What is unconfirmed:**
    - The re-measure ran with the CPU at 100% from parallel agents.
    - Reopen took 11.7–16.2 s, against 8.3–9.4 s before.
    - The drain took 1,665 s, against 232 s before.
    - Bind, which this change did not touch, also slowed by 4–6×, so this is probably machine load. A regression from pruning inside drain-triggered compactions is not ruled out.
  - **Blocker:** an idle machine to re-run `scratchpad/drain-probe` on the 263 MB store copy.
  - **Fix:** if the drain is still slow when idle, prune only at heartbeat compactions, not at drain-triggered ones.
- **Knowledge view: one stage, cameras are placements, semantic zoom ([PRD 43](./docs/specs/make.md) B1a, operator 2026-11-10).** Today every camera re-renders the same data on its own stack: SVG transit/tower/mind map, canvas Graph2D and R3F 3D. The result is flicker, inconsistent shapes, slow switches and no zoom path from system to code.
  - **Done and committed:** P0b, P0c, P1a, the P1 stage, the P2–P5 placements and the 4+1 Physical view (see DONE.md 2026-11-10).
  - **Every camera except List runs on the stage and the `kg.stage` flag is gone** (verified 2026-11-17). Left (PRD 43 B8): delete `Graph2D`, `MindMap`/`MindBranches`, the TransitMap SVG and transit marks, `useCardAnchor`, `usePanZoom`, `useSvgScale` and the `PathStrip` SVG sequence, migrating their tests per B8; `compileAsync` and the three.js prefetch; the `labelPlacement` grid; worker task priority; `failIfMajorPerformanceCaveat` plus a telemetry event; the Playwright perf done-checks. Full list: [make.md › PRD 43](./docs/specs/make.md#prd-43--one-3d-stage-for-every-knowledge-camera).
  - **Re-extraction after a config change — unblocked, not started.** Memory 2026.10.72 carries the caller `extractorKey` (commit 45db29c). Wire `moduleAliasesDigest()` (`packages/agent-tools/src/knowledge/moduleAliases.ts`) as the key on every run, including Continue (empty string = no key). The extract pool must echo the key it extracted under through `extractJob(job, packs, workerKey)` (`clients/vscode/src/knowledge/review/extractJobHandler.ts`); a mismatch is rejected and the file stays owed. Bump consumers to ^2026.10.72 and refresh every lockfile.
  - **Descriptor redaction (decision).** Deploy-descriptor section text uses an allow-list blank-out, not `@builderforce/secret-redaction`. Layer the package's patterns on top once agent-tools resolves it as a source package.
  - **Ship.** After the above: rebuild the brain-embedded dist, package VSIX 2026.10.155 (bumped in `clients/vscode/package.json`, never packaged), install it by absolute path, and verify with `--list-extensions`.
- **Run delta: follow-ups from the 2026-11-10 pass ([PRD 41](./docs/specs/make.md) §7, WS7).** The VS Code run delta, the §12.5 hold/release and C9 shipped (see DONE.md, 2026-11-10). Open:
  - **The server does not normalise repository identity on write.** The client strips credentials and hashes local paths before sync (590728fb1), but an older VSIX still sends raw remotes. Fix: move `clients/vscode/src/repoIdentity.ts` into one shared source-only package, and normalise `repository`, lifecycle `root` and `repos[]` in the API sync-apply path for the run-delta, change-set and lifecycle kinds. The user decided on 2026-11-10 that this covers the write path only, with no rewrite of stored rows.
  - **The VSIX with the run delta is not packaged or installed yet.**
    - Bump clients/vscode, package it and install it by absolute path.
    - Check that `out/runDeltaWorker.js` is inside the .vsix.
    - Release note migration `1341_release_note_run_delta_card.sql` names version 2026.10.144; make it match the packaged version.
    - The blog post `know-what-an-agent-run-did` has no OG image.
  - **Verification gaps.**
    - 209c2b835 and f5a82a41f were never typechecked in a clean export of the committed tree; the local tree is missing `brain-embedded/dist/*.d.ts`.
    - `knowledge-graph-view` `RunDeltaCardStates.test.tsx` did not run (jsdom not found).
    - `runDelta.test.ts` is `skipIf(!node:sqlite)`, so confirm CI runs it (`NODE_OPTIONS=--experimental-sqlite`).
  - **Release authority treats every board as managed.** The device has no lifecycle-managed flag, so `runDelta/releaseAuthority.ts` asks for approver authority on any board. Fix: sync the board's managed flag to the device and use it.
  - **Nothing lists local audit runs.** `listLocalAuditRuns` has no consumers, so a held audit shows only through the `auditExecution` warning. Fix: wire an audit-runs view, or delete the function if nothing should list them.
  - **Binary sniffing still disagrees in four places.** `changedExcerpt.ts`, `contextPack/buildContextPack.ts` and two agent-runtime files scan the whole buffer with `includes(0)`, and `webview/src/attachmentUpload.ts` sniffs 8,000 bytes. Moving them to memory's `isBinaryBytes` changes their behaviour, so decide per caller.
- **Run delta: the rest of PRD 41 ([PRD 41](./docs/specs/make.md) §7); paused 2026-11-10 by the operator, mid-pass.**
  - **Shipped:** WS3, WS15, the memory 2026.10.77–.80 primitives and the pin bump; see DONE.md 2026-11-10.
  - **Everything below went to main in the operator's sweep commit 7674bbd64 ("Improvements", 2026-11-10).** It skipped the planned review gate and the full typecheck of the staged set, so main carries the WS4, WS8, WS9 and L3 code exactly as each agent was stopped. The next step is a Haiku typecheck and targeted tests over the run-delta family on main, then the review rounds below. The code spans:
    - `packages/run-delta`, `packages/agent-tools/src/{delta,knowledge/facts}`;
    - `clients/vscode/src/{runDelta,knowledge}`, `packages/knowledge-graph-view/src/delta`, `frontend/src/components/runDelta`;
    - `api/src/{application,domain}/runDelta`, migrations 1342/1344/1345 and transactional 0032/0033.
  - **Built, reviewed and on main:** WS10, WS11, WS12, WS16, WS19 and WS20; see DONE.md 2026-11-10. Open: the main typecheck below.
  - **WS4 (FileFacts v3, `FactIndex`, SQLite fact store):** three review rounds are closed. The agent was stopped while re-deciding restored mount candidates after `FactIndex.restore()` (`factIndex.restoreCandidates.test.ts`). Still to do:
    - finish that fix;
    - run `factFindings.test.ts` and the vscode tsc against memory .80;
    - an Opus re-review (storage).
  - **WS8 (security dimension):** the agent was stopped mid-round. Still open:
    - FileFacts route integration: `routeDelta.ts`, `entryAdded.ts` and `methodWidened.ts` move onto `entryPointsOf`; `guardsInferred` becomes heuristic confidence; guard rules use the change's confidence (in progress).
    - 3 taint fixes, 5 config false positives, 7 cleanups, `tagStride`, the `unsafeRegex` adjacent-quantifier case and the CORS test.
    - An Opus re-review.
  - **WS9 (perf, -ilities, quality; the C8.3 out-of-scope change):** the agent was stopped mid fix-round. Still open:
    - `namedPaths.ts` token caps (200 chars, 4 stars) and a pure `planSection(text)` (in progress);
    - H1, M2/M4, the M3 label, extracting `plannedPathsOfRun`, and the LOW findings;
    - a re-review.
  - **L3 analyzer tier (`l3Cache.ts`, `sarifTools.ts`, `l3Recovery.ts`, `l3Binding.ts`, `PendingAnalyzers.tsx`):** the agent was stopped at the start of targeted verification for round 3. Still open:
    - scope jscpd to the packages that hold changed files, and measure it;
    - a tree-hash equality test;
    - the `interrupted` label;
    - check the CodeQL flags against the docs;
    - a re-review.
  - **L3 revision contract (agreed with agentic-2c, 2026-11-10):** a superseding revision keeps the same `runId` and `at`, and never sets `blocked`, because hold state comes only from `runHoldState.ts`. L3 codes can block only when they land inside the L3 hold extension, before the verdict. Later findings are advisory.
  - **After WS4, WS8, WS9 and L3 pass review:**
    - run a full typecheck of main's run-delta family;
    - split `packages/run-delta/src/contract.ts` (~490 lines);
    - apply the RunDeltaPanel `PANEL_WIDTH` one-liner (agentic-2c pushed 209c2b835 and 590728fb1, so this is unblocked);
    - ship: a `release_notes` row (`new`), the Idea-to-Real post (Measure act), and DONE.md moves.
  - **Not started:** WS5 consolidation (`kind: 'consolidation'` has no producer; `scan.json` and `versionToken` still live in `codebaseScan.ts`).
  - **Built but unwired (wire or retire):** `persistCloudRunDelta.ts` has no caller (cloud/on-prem delta, C14); the WS17 calibration, SPC and reliability-growth models and the rule-precision demotion have no consumer; no host produces the WS21 similar-runs prediction. WS13 has the packaged egress test but no CI job runs it (A6). WS22 audits score views in `admin_audit_log`, not the planned `person_score_views` table.
  - **WS18 (run risk model):** *Blocker: needs at least 500 final WS16 labels, which accrue as runs finish.*
- **Cloud run isolation (G1, [make.md › PRD 09](./docs/specs/make.md#prd-09--cloud-agent-validation--hardening)): the egress allowlist is built but off.** (G2 secret containment is done — DONE.md, 2026-11-17.)
  - G1 egress: the outbound allowlist and its lifecycle shipped (`sandboxEgressLifecycle.ts`, b55198fc0 / adc99aa42 / e867b3bd1) behind `SANDBOX_EGRESS_ENFORCE`, which stays off. *Blocker: a live probe in a deployed container (raw TCP/DNS blocked, HTTPS through the proxy to an allowed registry, interception installed before start, `ctx.exports.ContainerProxy` resolves) before the flag is turned on.*
- **Cloud dispatch admission: review fixes in progress (2026-11-08).** Admission and the early draft PR are on main (3a2c752db). An Opus review found the deferred-dispatch sweep reads the wrong database (parked dispatches are never retried), the audit table cannot serve as a queue, and the orphan-draft sweep judges the wrong run and can close a draft a new run just adopted. The rework (a `deferred_dispatches` table with claims, backoff and per-kind hooks; a sweep decided by `platform_draft_execution_id` with a compare-and-set retire) is in progress, partly swept into local ee2222212. Next: verify, review, commit, push.
- **A failed run's branch residue is never swept,** and cancelled-run teardown can delete a live parent's or earlier run's work, because `runCommitMarker` is per task. Needs per-execution attribution. *Blocker: operator decision on deleting run branches.*
- **VS Code chat history doesn't follow the person.** `isOwnRecord` filters other devices' records and `openableLocalChat` doesn't pull the transcript. Fix: re-key on arrival, hydrate from `GET /api/brain/chats/:id/messages`. *Blocker: operator decision; changes what "local first" promises.* [make.md › Design Gaps and required changes](./docs/specs/make.md#gaps-and-required-changes--still-open)
- **Autonomous trigger errors.** 282 `auto_run_error` in 30 days to 2026-10-25 (`autoRunSkipLedger.ts`). Group by reason, fix the top causes.
- **Auto runs may carry no `cloudAgentRef`** (`laneEntryTrigger.ts:323` sets it only with `decision.agentRef`).
- **IDE agent calls tools one at a time** (chat #115: 63 turns, 82 calls). *Blocker: an A/B over real runs.* [make.md › PRD 45 §8](./docs/specs/make.md#8-success-measures-open-targets)
- **Multi-repo sandbox.** Per-task repo sets route and open PRs, but `sandboxOpenSpec.ts:26` clones one repo.
- **Architect runs:** `AnalysisRunnerDO` has no per-tool timeline or steering; no commit-webhook re-analysis.

### Local-first `[agents]` `[platform]`

- **PreFetch done-checks 5–6 are unmeasured:** no turn-2 cache-hit probe (≥ 90%) and no gate-latency measurement. [make.md › Deterministic-first PreFetch](./docs/specs/make.md#done-checks--remaining-prefetch).
- **The API chatter inventory and per-surface request budget are not built** (delivery step 6 of the local-first review): no inventory of what each surface calls on open, no budget enforced. [make.md › Web, Rovr, and VSIX local-first review](./docs/specs/make.md#design--web-rovr-and-vsix-local-first-architecture-and-batch-sync-review).
- **The platform transport policy is not re-verified for the webview realm and sockets (G02).** Confirm that the shared policy covers the webview realm, WebSockets, `vscode` request APIs and child-process network, or log each gap. [make.md › Local-first review](./docs/specs/make.md#gaps-and-required-changes--still-open)
- **Offline memory, in builderforce-memory.** Open: M07 cache persistence, M08 asset resolver, M10 router, M11 mutation guard. Partial: M03–M05, M09. `clients/vscode/src/cognition.ts` is still server-bound. Done when the review's acceptance 5–7 pass. [make.md › Design Shared offline memory scope](./docs/specs/make.md#shared-offline-memory-scope--still-open)
Source: [offline-first review](./docs/specs/make.md#design--web-rovr-and-vsix-local-first-architecture-and-batch-sync-review).



- **Three local ticket writers.** `frontend/src/lib/localFirst/workManagement.ts` (web), `packages/local-first/src/localWork.ts` `createLocalWork` (used by `localTools.ts` `executeDomainTool`) and `clients/vscode/src/localTicketRepository.ts` (VSIX) each build the ticket record, its create event and its dependencies separately. Only the VSIX writer carries `chatClientId`, `taskType` or server references. Fix: move the VSIX repository's rules into `packages/local-first` as the one ticket and project repository, port the web and `executeDomainTool` callers onto it, and delete the two thinner copies with their tests run unchanged. Fixing it means a chat-created ticket links on every local host, not only the editor. The chat-link fix landed in f6cad9f14, so this is unblocked. [make.md › Design Gaps and required changes](./docs/specs/make.md#gaps-and-required-changes--still-open)
- **Ship and verify gates misfire (2026-11-09 review; its parent line was lost in 9274de5c6).** Fix each below and add a `regression:` test per bug. [make.md › PRD 45](./docs/specs/make.md#prd-45--deterministic-run-gates-and-loop-economics)
  - `newSourceNeedsTest` refuses any new source file that lacks a test with the same name, including barrels, types and labels.
  - The `open_pull_request` gate checks an empty `@{u}..HEAD` set and still reports "checks passed".
  - On Windows, `windowsCommand` turns `node` into `node.cmd`, so every guard fails.
  - Marking a ticket done runs the full typecheck and test tier inline, for minutes, against commits the run did not make.
  - Gates hash the working tree, not `HEAD`.
  - The verify commands build shell strings from file paths.

  Also: `bracketDelta` false positives on regex literals and JSX text, an N+1 in the agent-runs host, the `fileRefFor` suffix false match, and the 3D layout metrics dropped from the perf baseline. The fix is in flight (Opus review findings 1–21). Fixing it makes base-branch pushes from the editor work again.
- **G27: no packaged acceptance suite runs with the network denied.** `deniedNetworkAcceptance.test.ts` mocks `vscode`. Assert zero platform requests and local-only completion in the packaged VSIX, Rovr and Web. Unblocks claiming offline behaviour. [make.md › Design 3. G27](./docs/specs/make.md#3-g27-one-scenario-three-packaged-drivers-the-network-denied-at-the-os)
- **Legacy-migrated root: the first host to pack it can drop another host's sources.** On a root with a generation but no leaves yet, api `planSources`/`reconcileLegacyRows` (knowledge pack apply) treat every legacy source the first pack does not name as removed — the same "less-complete host deletes" pattern the client reconcile no longer has. Fix: on that one-time migration, keep unnamed legacy sources (tombstone only explicit `pack.deletes`). Fixing it makes the leaf migration safe when the less-complete machine syncs first.

### Autonomous delivery `[delivery]`

- **`SwimlaneCoordinator` / `ticket_runs` is still a second engine (PRD 37 Phase 5).** Converge the task-status flow onto the manifest as the single source of truth. [make.md › PRD 37](./docs/specs/make.md#13-phase-5--convergence)
- **MCP has no `kanban.handoff` (PRD 37 §8).** Hand-offs are emitted only by `coordinateTicket.ts`. Add the tool or drop the requirement. [make.md › PRD 37](./docs/specs/make.md#8-api--mcp-surface)
- **No cross-incident accountability read model (PRD 37 §5.10).** Per-ticket gaps and incident links exist. Aggregate them by stage over the quality/DORA lenses, and feed durable findings into Evermind lessons. [make.md › PRD 37](./docs/specs/make.md#510-incident-management-linkage--process-improvement-loop)
- **The editor ship directive still tells the agent to review its own change (found by the 2026-11-17 PRD verification).** `brain-embedded/src/selfReviewShip.ts` step 2 "SELF-REVIEW" contradicts PRD 45 OD-1 (a fresh reviewer, never the author). Route the review through the independent reviewer. [make.md › PRD 45](./docs/specs/make.md#prd-45--deterministic-run-gates-and-loop-economics).
- **PRD 23: a PRD- or docs-only run still opens a PR, and shared-infrastructure and credential failures are journal entries, not incidents (found by the 2026-11-17 PRD verification).** The circuit breaker does not show `blocked_reason` / `next_retry_at`. [make.md › PRD 23](./docs/specs/make.md#prd-23--manager-pr-review-acceptance-evidence-and-ticket-recovery).
Last measured 2026-07-26: 6 of 767 tickets fully autonomous; 69% of 6,195 runs failed. The manager's census tracks this.

- **PRD 23 dispositions and canary are built but not live** ([PRD 23](./docs/specs/make.md)). Turn on the Manager canary for a project and apply a reviewed disposition batch; done when the census shows the backlog shrinking. *Blocker: operator decision to go live (the operator chose build + dry-run for this pass).*

### Ceremonies and meetings `[delivery]`

- **Ceremony presence** is set at connect, not re-verified per frame.
- **Retros:** no theme clusters, sentiment trend or action carry-forward.
- **Mesh WebRTC caps at ~4–5 cameras.** *Blocker: a Cloudflare Calls app.*
- **TURN not provisioned** (~10–15% of symmetric-NAT pairs fail). *Blocker: `CLOUDFLARE_TURN_KEY_ID` / `CLOUDFLARE_TURN_API_TOKEN`.*
- **Meeting agent voice is browser `speechSynthesis`.** *Blocker: product decision.*

### Canvas runtimes and studio `[canvas]`

- **Export and publish parity (PRD 18 §8.9).** Still missing: output-profile gating, the audio and animation profiles, publish history and republish, the destination adapters, the brand watermark, and export cancellation. [make.md › PRD 18](./docs/specs/make.md#89-export-publish-and-lifecycle-parity)
- **Only 27 of 90 Hired template-catalog entries are ported (PRD 18 §8.8).** Register every family in the canonical template service. Each entry needs localized copy, a thumbnail, filters, a preview, an editable seed, tests and its export. [make.md › PRD 18](./docs/specs/make.md#88-full-hired-template-catalog-inventory)
- **Runtime-by-runtime parity (PRD 18 §8.7).** Still open: video overlays, multicam and H.264; image brushes and layers; game authoring; the animation, comic and CAD tail rows. [make.md › PRD 18](./docs/specs/make.md#87-runtime-by-runtime-parity-re-verified-2026-11-17)
- **Recording, media and AI action parity (PRD 18 §8.6).** About 24 rows are MISSING (stock-media picker, music, ducking, dubbing, video forms, brand kits and more) and 10 are PARTIAL. [make.md › PRD 18](./docs/specs/make.md#86-recording-media-ai-engagement-and-advisory-actions)
- **Studio landing and template chrome parity (PRD 18 §8.4).** 4 rows are MISSING (deep-links, template preview, template apply, published-destination list) and 9 are PARTIAL. [make.md › PRD 18](./docs/specs/make.md#84-studio-landing-template-discovery-and-project-chrome)
- **No shared Canvas runtime shell (PRD 18 T4, §8.5, gate 4).** Build editor tabs, layers, positioned widgets, the properties inspector and a capability-driven save menu. Then add image layers/PSD and the game authoring stage. [make.md › PRD 18](./docs/specs/make.md#t4--canvas-runtimes)
- **The creative capability contract disagrees with the exporters (PRD 18 §1.3).** Re-derive the `creativeCapabilities.ts` rows for cad, comic, animation, image and model3d from the frontend exporters, and add a test that keeps them in step. This unblocks X-002. [make.md › PRD 18](./docs/specs/make.md#13-canvas-fill-the-declared-kinds)
- **Video engine models:** no learned interpolation, ControlNet or inpainting. The WebM fallback and GPU `advanceState` shipped. *Blocker: trained weights.*
- **3 WebDiT models `available: false`** (wan2.5, mochi-1, ltx2-distilled). *Blocker: ONNX exports on R2.*
- **One build-file write took 35.7s vs 38ms median.** `client.build_file_write` spans now ship. *Blocker: a telemetry sample from a real build turn with preview running.*
- **Canvas runtimes verification gaps (2026-11-08).**
  - The 2026-11-08 canvas runtimes pass wasn't fully verified. The full API test list was never run.
  - `frontend/src/lib/markdownPipeline.test.tsx` hung during load. The `React.lazy` fix in `DocumentMarkdown.tsx` is unconfirmed.
  - `voiceEmbeddingStore.test.ts` has a `vi.hoisted` fix that hasn't been rerun.
  - The VS Code webview build and VSIX package are blocked by another session's `packages/brain-ui` `ChatTicketsPanel.tsx` type errors, and by the missing `AnalyzerProgress` export from builderforce-memory.
  - The release notes and marketing for the six editors, the drawing block, Room voice and video, and the voice marketplace and provenance are not written yet.
- **Podcast uploads:** `.m4a` / `audio/mp4` are rejected by the asset allow-list.

### Mobile `[canvas]`

- **Device simulator is in-browser.** The native path (Metro/Expo) waits on live preview; no Expo build service. [make.md › PRD 31 §4](./docs/specs/make.md#4-w7-marketplace-repo-connected-own-auth-mobile)
- **Native apps:** no Evermind recall or agent invite in phone chat; no Approvals screen.

### Previews, repos and hosting `[canvas]` `[integrations]`

- **The browser run tier is incomplete (PRD 31 W9).** No detector writes `kind: 'python'` or `'php'`. The phase 5, FastAPI and Slim exit tests are not recorded. .NET (6c) and Rust (6d) are unreleased, and no `kind: 'training'` service runs Python. *Blocker: D7, free-plan gating, for phase 5.* [make.md › PRD 31 W9](./docs/specs/make.md#4-w9-browser-run-tier-full-stack-apps-on-our-webcontainers-runtime)
- **Browser-run apps need the mandatory Security Shield.** Build PRD 31 W10: runtime-minted identity, origin separation, ingress and service-graph decisions at the page-side chokepoints, an authenticated database gateway, egress CSP, quotas and VFS scoping, with incidents flowing into `security_incidents` and the SIEM export. Done when every gap fixture (inventory tracked out of source control in `SECURITY-FINDINGS.local.md`) is green across Node, Python and PHP. [make.md › PRD 31 W10](./docs/specs/make.md#4-w10-security-shield-mandatory-protection-for-every-browser-run-app).
  - Phases 1–4 are shipped (see DONE.md, 2026-11-18). Still open:
    - **Contract push:** drop `uq_security_incidents_finding_ref` and fold it into the ledger. *Blocker: migration 1354 must be deployed first.*
    - **ApplicationSpec has no `name`:** the origin key hashes the service ids and roots instead. Two apps in one project with identical services would share an origin. Add `name` to core `ApplicationSpec` and key on it.
    - **Container-ingress answers on the shared preview host** carry only `nosniff` and `Origin-Agent-Cluster`, not the document CSP. Move container ingress off the runtime host so the full CSP can apply.
    - **Phases 5, 6 and 8:** the signature engine, automated response, and adversarial and scale validation, plus the Phase 0 baseline latency fixtures.
- **Apps cannot declare external APIs, so worker egress is the default allowlist only (W10 control 6, found 2026-11-18).** `POST /api/runtime/worker-policy` mints signed per-app policies, but neither `AppBlueprint` nor `builderforce.json` has an external-API field, so `declaredExternalApiOrigins` (`api/src/application/runtime/workerEgressDeclarations.ts`) returns none. Add the declaration (read-only origins; write-capable APIs never default), read it through `getOrSetCached` per project, and invalidate on its write path. [make.md › PRD 31 W10](./docs/specs/make.md#4-w10-security-shield-mandatory-protection-for-every-browser-run-app)
- **`builderforce.json` cannot declare scheduled jobs, background workers or a Redis/queue resource, and an invalid file is ignored without a word (found 2026-11-19).** `builderforceJsonDetector.ts` returns no overrides on bad JSON and never says why. The file is an unversioned, unvalidated `Partial<AppBlueprint>`. The blueprint has one `database`, its `AppServiceReadiness` has no `started`, and the wrangler `cron`/`queue` bindings run on no target. Every run target lives only as long as a session: the browser tab, or a preview container with 3-minute idle eviction. Done when manifest v1 (one parser with typed issues), `jobs`/`resources`, the webcontainers job scheduler and the Redis provider ship as designed. Designed as [make.md › PRD 31 W11](./docs/specs/make.md#4-w11-the-app-manifest--infrastructure-as-code-environments-diagnostics-and-starter-kits). It covers manifest v1 with production/non-production tiers and debug, diagnostics in the badge, starter kits with `/` actions and `/help`, manifest init, jobs, Redis and `DeploymentTarget`. In flight (2026-11-19): the manifest, kits, `/` commands, the launcher (HTTPS from a local CA), ingress, and `packages/app-detect` (the detectors moved there). Detection `warnings` reach the `detectBlueprintForProject` result and the `app_blueprint.detect` tool, but nothing stores them, so the blueprint card (W2, unbuilt) cannot show them. They land with that card.
  - **The frontend Worker has almost no size headroom (found 2026-11-20).** `check-worker-size` read 9.99 MiB of Cloudflare's 10.00 MiB limit at fb5bc3a11. About 40 KB more source from app-detect pushed it to 100% and blocked the frontend deploy. `"sideEffects": false` on `packages/app-detect` won back ~16 KB compressed, leaving it at ~99.8%. The 7.13 MiB edge chunk carries embedded English message strings and KaTeX font metrics. Done when those move out of the Worker (client-only or lazily loaded), and check-worker-size reads under 90%.
  - **Detection misses backends outside the repo root (found 2026-11-20 W11 review).** `packages/app-detect` reads `package.json` only at the root, so an express/fastify backend in `api/` or `server/` is never a service and `/manifest init` emits no `/api` ingress for it. The ingress detector follows backend entry files only under the root, `api`, `backend` and `server`, so the API also misses `services/api` compose contexts and nested `src/Shop.Api/Program.cs`. That limit keeps the API's per-webhook read budget (`MAX_PROVIDER_CALLS - FOLLOW_READ_RESERVE`) intact. Done when the package.json detector reads each compose/workspace service root, and follow reads target the detected services' roots inside the existing budget test.
  - **A regenerated launcher CA stays trusted.** When `loadOrCreateLocalCa` (builderforce-webcontainers `packages/browser/src/launcher/server/tls/localCa.ts`) replaces a stored CA that fails its checks, the old root stays in the user's Root store/keychain, and nothing removes the trust. Name-constrained to localhost/127.0.0.1, so the exposure is small, but the store only grows. Done when regeneration removes the previous root by thumbprint (`certutil -user -delstore Root`, `security delete-certificate -Z`) and the VSIX offers an untrust action (found by the 2026-11-20 W11 review).
  - **The web run target never emits `ingress`.** `blueprintToApplicationSpec` produces no `ApplicationSpec.ingress`, so on the web canvas a frontend's relative `/api` calls reach the backend only when the app proxies them itself. Manifests (kits, `/manifest init`) do carry routes. Done when the web target runs from the v1 manifest (`toApplicationSpec`) instead of its own mapper. That is one mapper to retire, and its port-policy tests must stay green.
- **A browser environment cannot recover after its tab dies, and cannot host agents (2026-11-20, from the reworked RAR-001 spec).**
  - VFS journal and snapshots exist, but nothing restores manifest → files → databases → services after an abrupt stop.
  - `builderforce.json` has no `capabilities` or `agents` field.
  - The ONE agent (`agent-run`) has no WebContainer surface.
  - Recovered runs have no idempotency on mutating tool calls.
  - The Room does not show an environment's agents.

  Done when W12 phases 1–6 ship (capabilities on manifest v1 → suspend/recover for every app → Agent Environment through a `runAgent` surface → checkpoint/resume with no repeats → agents in the Room → child runtimes). *Blocker: the W12 Opus design review, then W11 phases 1 and 3.* [make.md › PRD 31 W12](./docs/specs/make.md#4-w12-agent-environment-and-recoverable-runtime)
- **[agents] Manifest v1 has no AI primitive (A, chat #287 / project 103 Yardfire, 2026-11-21).** `ROLES` is only `frontend`/`backend` (`builderforce-webcontainers/packages/core/src/manifest/validate.ts:21`); `RESOURCE_CAPABILITIES` has no model type. A service written as `role: "agent"` is rejected (missing `command`; role not one of frontend/backend). Done when v1 has one new resource `ai` (`{ "type": "ai", "models"?: string[] }`), an agent service stays `role: "backend"` with `"uses": ["ai"]`, and the Yardfire manifest validates. Do not add a role `agent`.
- **[agents] A browser-run service cannot reach a model, and `connection` → browser `vault` is a false capability (B, chat #287).** Process egress is `PREVIEW_DEFAULT_EGRESS = ['https://esm.sh']` (`packages/browser/src/previewHeaders.ts:70`). `RESOURCE_CAPABILITIES` says `connection` → browser `yes('vault')`, but nothing in webcontainers or the VSIX delivers connection credentials. Done when a service that `uses` an `ai` resource gets `AI_BASE_URL` (OpenAI-compatible, no key in the process) via a page-side gateway on the port registry — the same seam as the database gateway — and the host adds the signed-in session in-process (no `postMessage` auth hop) and forwards to `POST /v1/chat/completions` on the API gateway host, metered by that route's existing tenant ledger (`logUsage`). Do not widen process egress and never put a token or vault secret in the worker. Vault credentials are delivered later by a localhost relay that attaches the secret host-side (same shape as `ai`); until then `connection` stays an acknowledged false `yes('vault')`. Cloudflare stays `no('app-token')` until an app-scoped token acceptor exists on that route. Both launchers already enter `startApplicationRuntime` (web IDE page; VSIX via the local launcher's page) — the work is threading a `HostRelay` through `createLocalLauncher` → launch info → page `BootDeps`, with the VSIX forward crossing the launcher's token-gated `/__bf` hop to the extension host. Contract: [app-manifest-ai-resource.md](./docs/specs/app-manifest-ai-resource.md).
- **[agents] The agent cannot find or check the app-manifest format (C, chat #287).** `APP_MANIFEST_SCHEMA_V1` and `validateManifest` exist, but no builtin tool exposes them; `tools_find` / knowledge search for manifest / `builderforce.json` / service schema return nothing useful. Docs-site `builderforce.json` pages describe the agent-runtime config, a different file with the same name. The only guidance is `OVERRIDE_HINT`. Writes to `.builderforce/builderforce.json` are never validated before `git_commit`. Done when `app_manifest.schema` and `app_manifest.validate` sit next to `appBlueprintToolCatalog.ts` (not in `builtinMcpService.ts`), the VSIX write gate and `git_commit` refuse a manifest with errors and name them, aliases resolve, and one docs-site page "App manifest (builderforce.json v1)" is generated from the schema and indexed.
- **[agents] "Add an AI agent" is read as "hire a workforce agent" (D, chat #287).** There is no clarifier for a teammate on the board versus a feature inside the app. Done when a request that says "agent" and the project has an app manifest asks one fixed choice — "a teammate on the board" / "an AI feature inside the app" — before acting. A fixed list, not a model call.
- **The wrangler detector cannot read real configs (found by the 2026-11-17 PRD verification).** `packages/app-detect/src/detectors/wranglerDetector.ts` regex-matches inline `kv_namespaces = [...]` / `r2_buckets = [...]`, so `[[kv_namespaces]]`, `[[r2_buckets]]` and `[[durable_objects.bindings]]` table arrays are missed and the hired.video blueprint acceptance fails; `content.includes('ai')` (line 84) flags any file containing the letters. Parse TOML properly. [make.md › PRD 31](./docs/specs/make.md#prd-31--build-run-and-ship-a-real-app-on-builderforce).
- **`POST /api/projects` stores `companyId` without checking the company belongs to the tenant (found by the 2026-11-17 PRD verification)** (PRD 31 W8). Validate tenancy before the write. [make.md › PRD 31 §4](./docs/specs/make.md#4-w8-company--project-in-one-step)
- **Live container preview off.** Host and deploy are in place; `preview.builderforce.ai` answers "not enabled". *Blocker: the `PREVIEW_INGRESS_ENABLED` secret.* Unblocks the QR live path and the native simulator. [make.md › PRD 31 §4](./docs/specs/make.md#4-w1-run-loop-container--live-preview--agent-highest-leverage)
- **Customer app platform ([PRD 31](./docs/specs/make.md)).** W1 `preview_*` tools and multi-port; W3 customer cloud connections; W4 `InfraProvider`; W5 hosted compute; W6 PR previews; W7 repo-connected listings. *Blocker: W5 decisions D1/D3/D4.*
- **Repo-backed Designer:** `last_synced_sha` is never written, so no merge guard; no auto two-way sync; worker and api R2 prefixes diverge; `createRemoteRepo` refuses GitLab.
- **GitHub App not registered;** the code is wired and calls use the tenant PAT. *Blocker: `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY`.* [make.md › PRD 31 §2](./docs/specs/make.md#2-operator-decisions-binding-and-decisions-still-owed)
- **Multi-provider PR loop:** Bitbucket Server can't revert; `getPullRequestDiffSummary.ts:163` is GitHub-only. *Blocker: live GitLab/Bitbucket creds.*
- **Drive as primary storage isn't wired.** `workspaceStore.ts` needs a `StorageProvider` port. *Blocker: a live Google OAuth app.*
- **Post-merge validation** needs a `merge_sha`; Bitbucket has no log tails.
- **QA and security findings have no `{path, line}`,** so no inline PR comments.
- **Published sites can't run customer server code.** Needs Workers-for-Platforms or container serving. [make.md › PRD 31 §4](./docs/specs/make.md#4-w5-builderforce-hosted-compute-paid)
- **Custom-domain certificates not live.** *Blocker: Cloudflare for SaaS entitlement + `CLOUDFLARE_ZONE_ID` / `CLOUDFLARE_SAAS_API_TOKEN`.* [make.md › PRD 31 §2](./docs/specs/make.md#2-operator-decisions-binding-and-decisions-still-owed)

### QA `[canvas]`

- **Agentic Tester:** no network sandbox; single persona login; Chromium only; no workflow step starts a run.

---

## ⚙️ Run — operate the company

- **[hiring] Résumé renderer parity: 7 rows open** in `canvasResumeRenderer.ts`: `hired-default` split hero, RR-007 facing pages, RR-010/011/013 palette drag and detach, RR-014 empty sections, RR-024 360px test. [run.md › PRD 18](./docs/specs/run.md#83-résumé-template-and-renderer-inventory).
- **[hiring] Résumé journey: 11 rows PARTIAL (release blocker).** R-007, R-016, R-026, R-028–R-030, R-044, R-047 (tailor returns cited changes and a score delta), R-049, R-053, R-054. Done when each row meets its done-when. [run.md › PRD 18](./docs/specs/run.md#82-required-résumé-user-journey--release-blocker).
- **[hiring] The HR agent has tools but no surface.** Career 360 has no UI and no `activity_log` score history, there is no `origin='hr'` coaching chat, and `hr.org_review`/`hr.headcount_plan` read neither objectives nor the delivery signal and render no Canvas report. *Blocker (reduction artifact only): operator decides whether `orgReview` may recommend a reduction.* [run.md › PRD 18](./docs/specs/run.md#t3--hr-agent--career-360-coaching-org-design).
- **[hiring] No `namely` HRMS manifest** in `connectors/defaults/`. Add it read-only, like the other HRMS manifests. [run.md › PRD 18](./docs/specs/run.md#14-hrms-integrations--connector-manifests).
- **[hiring] `recruiter.publish_job` and `hr.profile_audit` don't exist.** Bind `publish_job` to `distributePosting.ts` `distributableAction`; wrap the `application/career/` analysis for `profile_audit`. [run.md › PRD 18](./docs/specs/run.md#12-one-tool-catalog).
- **[governance] SOC 2 written policies don't exist** (G-07–G-15): ITGC, change management, general incident response, external communications, fraud risk, board charter, ISMS and vulnerability management. Write them under `docs/compliance/` and name the four control owners. [run.md › SOC 2](./docs/specs/run.md#4-remediation-plan-open-phases).
- **[advisors] #2545 has no spec, and `/advisory` may break PRD 26 §9.** `frontend/src/app/advisory/page.tsx` is a dedicated advisor destination labelled #2545. Write #2545's spec, then keep or remove the page. [run.md › PRD 26](./docs/specs/run.md#10-follow-ons).
- **[platform] BurnRateOS runtime rows have no verdict.** The daily churn/digest/coach cron, the `SupportChatRoom` DO and the `burnrateos-attachments` R2 bucket are neither ported nor retired; record build-or-retire for each in `burnrateCutoverPolicy.json` before shutdown. [run.md › PRD 19](./docs/specs/run.md#runtime-and-integration-gaps-remaining-rows).
- **Merged-product behaviour missing:** the ATS funnel and growth workflows. [run.md › PRD 18 T2 · Recruiting / ATS](./docs/specs/run.md#t2--recruiting--ats)
- **Governance rule-audit endpoints need their review and tests.** 767cd3e2b (`governanceRuleAudits.ts`, `governanceRuleAuditRoutes.ts`) shipped without route or service tests or a security review. Still to check: tenant isolation, role gates, the 409 on a retried finalize, atomicity of finalize, and whether to cache the resolve read. The review agent was stopped before it reported. [run.md › PRD 08 §7](./docs/specs/run.md#7-acceptance-criteria)
- **[advisors] Advisory minutes never reach a board (found by the 2026-11-17 PRD verification).** `syncMinutesForMeeting` (`api/src/application/ceremony/ceremonyMinutesToCanvas.ts:185`) returns null for a meeting with no ceremony session, and advisory meetings never have one, so DONE.md's #2538 minutes-to-tasks claim does not hold for advisors. `ScheduleMeetingPanel` also lacks the `advisory` kind. [run.md › PRD 26](./docs/specs/run.md#prd-26--advisor-platform-epic-2522).
- **Advisors ([PRD 26 §12](./docs/specs/run.md)).** Notetaker default-on, action items on the visitor's board, follow-up slot, guest claim link, token isolation test, P2 filters, location and stage filters.
- **[governance] Policy packs cannot be authored (found by the 2026-11-17 PRD verification).** The migration-1336 tables are read-only, so the governance auditor resolves an empty ruleset; the new authoring routes would collide with the 0348 wire-gate packs already served at `/api/governance/policy-packs`; there is no API or UI to list audits or triage findings; the registered tool runs pre-filters only (no LLM step); audits don't run on agent PRs or feed the merge gate; passing runs write no CC8.1/CC7.1 evidence. [run.md › PRD 08](./docs/specs/run.md#prd-08--agentic-security--governance-policy-packs--governance-auditor-agent).
- **[governance] SOC 2 Type I,** the enterprise gate (epic #3062). The automation side is built: control baseline, automated evidence and the governance-auditor sweep. *Blocker: a CPA firm must be engaged to issue the Type I report.* [run.md › SOC 2 Type I Compliance](./docs/specs/run.md#soc-2-type-i-compliance--checklist--remediation-epic-3062)
- **[governance] Rule-audit gaps (PRD 08).** The `governance_audit` endpoints (767cd3e2b, `governanceRuleAudits.ts`) record runs and findings, but (1) a critical governance finding does not open a security incident (§4.4) — `openIncidentsForCriticalFindings` only accepts vulnerability findings, so it needs a finding-kind seam; (2) in-repo `.builderforce/policies` overrides are not merged into the resolved ruleset (DB packs only). Fixing both makes the auditor's gate match the PRD. [run.md › PRD 08 §3](./docs/specs/run.md#3-rule-resolution--in-repo-override-precedence)
- **[governance] DSR erasure skips non-segment stores.** `dsrExecution.ts` erases segment-scoped rows, but `marketing_audience_members` and `candidate_records` hold the same person outside the segment tier. *Blocker: operator decision on whether erasure reaches marketing audiences and hiring records, which carry their own retention duties.* [run.md › PRD 08 §10](./docs/specs/run.md#10-agentic-devsecops-layer--named-limits)
- **[hiring] Candidate-ref hashing needs a deployment pepper.** The per-tenant salt in `hiring_ref_salts` should be combined with a secret that never rotates, and none exists yet. *Blocker: operator provisions a `HIRING_REF_PEPPER` Worker secret.* (Detail in `SECURITY-FINDINGS.local.md`.)
- **[hiring] Board API shapes unproven live.** LinkedIn's `ids=List(...)` encoding and Ashby's `jobPosting.info` → `jobId` are coded from the vendors' docs, not proven with a live call. *Blocker: a tenant's LinkedIn and Ashby credentials to probe with.*
- **[integrations] Business Phone is Twilio CPaaS,** no port-in or SIM. `burnrateCutoverPolicy.json` says `retire_port_out`. *Blocker: operator confirms.* [run.md › PRD 19 §2](./docs/specs/run.md#2-capability-ownership-register-governs-prd-18-and-prd-19)
- **[integrations] No A2P 10DLC registration.** *Blocker: operator decision on fees.*

---

## 📊 Measure — grade the proof

- **[finance] An installed vertical dashboard shows nowhere else.** `FinanceLens.tsx` never reads the preset, and `toPublicProfile` carries no benchmark band for the marketplace company profile. [measure.md › PRD 25](./docs/specs/measure.md#66-where-it-appears).
- **Cost per creation outcome is permanently "Not measured" (found by the 2026-11-17 PRD verification).** Nothing sends `costUsdMillicents`; there is also no sales-brief presentation export. [measure.md › Creation outcome metrics](./docs/specs/measure.md#metric-definitions--cost-per-delivered-outcome).
- **[growth] `experiment` cards are never measured.** `builtin_canvas_bind_ab_test` doesn't exist and `experiment` isn't in `CONNECTED_CANVAS_ACTIONS`. Bind to `ab_tests` (the Insights traffic split exists), enforce `ab_test_segments` at serve time, cover external sites. [measure.md › Design Instrumentation rollout](./docs/specs/measure.md#instrumentation-rollout)
- **[platform] Three metric families have no writer:** `channel_performance`, `arr_projections`, `quota_attainment`. All 17 seats have rollups.
- **[finance] Vertical KPIs ([PRD 25](./docs/specs/measure.md)).** Slice B `growth.*`, LTV tranches, benchmark seeds; C exit waterfall; D remaining eight verticals' KPIs.
- **[finance] `companies.sector` is written free-form** (`investorRoutes.ts:167` → `companyWorkspace.ts:368`). Route through `validateListingPatch`. [measure.md › PRD 25 §8](./docs/specs/measure.md#8-open-items)
- **[growth] Insights (PRD 33) not provisioned.** *Blocker: Stripe, published disclosure, `NEXT_PUBLIC_REPLAY_SITE_KEY`, QA image-size check.* [measure.md › PRD 33 §11](./docs/specs/measure.md#11-production-provisioning-operator)
- **[growth] Insights event lake (D18)** for exact funnels. *Blocker: operator provisions the pipeline.* [measure.md › PRD 33 §2](./docs/specs/measure.md#2-d18--event-lake-deferred-scale-up)

---

## 📣 Reach — sell, be found, grow

### Billing and commerce `[finance]` `[commerce]`

- **No tenant can upgrade.** Stripe webhook unregistered, `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` unset. *Blocker: operator Stripe + `wrangler secret put`.*
- **Monetization:** personas install free; confirm a paid template install charges. Agent, skill and knowledge checkout exist and need the Stripe secrets above.
- **Enterprise license:** Docker files and `enterpriseSso.ts` exist, but nothing licenses on-prem (no key or verification code). *Blocker: operator defines what GA means.*
- **Buyer can't drive a listing first.** The Stage sandbox exists; no buyer route. *Blocker: decision on the throwaway tenant and who pays.*
- **Affiliates:** PRD 18 says port, PRD 19 §2 and `burnrateCutoverPolicy.json` say retire. *Blocker: operator decision.* [reach.md › PRD 18 T6 · Affiliates (from the T6 verdict tab](./docs/specs/reach.md#t6--affiliates-from-the-t6-verdict-table-and-5a1)
- **Company directory inert.** `companies` has no owner or verification column, so the "claimed a company" rung can't be enforced. *Blocker: PRD 19 B0 + PRD 21 §7 decision 4.* [reach.md › PRD 21 §11.5.1](./docs/specs/reach.md#1151-a-company-listing-is-not-a-new-concept)
- **PRD 21 storefront domain (§11.9.5).** *Blocker: operator decision.* [reach.md › PRD 21 §11.9](./docs/specs/reach.md#119-open-decisions--operator-not-engineering)
- **`projects` marketplace category** needs a visibility decision.
- **Gigs:** proposal eval scores aren't on an insights lens.
- **Upwork parity:** no payment-verified badge, bid economy or packages.
- **Freelance:** avatars are served full-size.
- **[integrations] Canvas packs and prompts can't be listed.** *Blocker: decide what a purchased pack becomes.*
- **[integrations] Developer Portal:** hyperscaler listings need seller accounts.

### Marketing and campaigns `[growth]`

- **A revoked mailbox fails its campaigns for good.** `failCampaign` writes off every queued row and a failed email campaign cannot restart, so one unknown 403 loses the audience. *Blocker: operator decision to hold rows queued until the mailbox is reconnected instead.*
- **Prompt-driven campaign ([PRD 30](./docs/specs/reach.md)).** C1 `canvas_connect_mailbox`, C2 catalog use-case, C3 ICP on canvas, C4 ROI writer.
- **Sales deck has zero customer proof.** *Blocker: one design partner, one measured result.*
- **Ad and social accounts connect by pasted token,** except YouTube. *Blocker: a developer app and review per network.*

### Public surfaces, copy and SEO `[growth]`

- **[growth] hired.video's `/jobs` and `/articles` have no Builderforce route,** so the cutover 301 map has no target for its two largest SEO groups; its other SSR/OG entities also lack edge routes. Confirm events, feed and community resources are retired before porting. [reach.md › PRD 18](./docs/specs/reach.md#t5--marketing-campaigns-content-social).
- **[growth] No CI gate ties a blog claim to a test.** Give each material claim a capability ID in frontmatter and fail CI on an ID with no passing, current evidence test. [reach.md › Blog gap register](./docs/specs/reach.md#ci-policy-to-add).
- **[growth] Blog claims outrun their evidence.** Canvas deliverable tests cover 9 kinds (no chart, dashboard, task, agent, voice, MCP or sales), VS Code meetings lack web's relay disclosure, the semantic cache has no embedding-version key, and 135 of 194 posts were never audited. [reach.md › Blog gap register](./docs/specs/reach.md#open-implementation-gaps).
- **Free-site badge removal isn't on pricing.** The entitlement is `removeBranding` (`api/src/domain/tenant/PlanLimits.ts`: Free false, Pro and Teams true). The pricing bullets come from the published JSONB document in `platform_pricing_configuration` (`key = 'public'`), not from code. *Blocker: add the line to Free, Pro and Teams in the admin Pricing panel (`PricingPanel.tsx`), then publish.*
- **Chat/canvas merge (VSIX `2026.9.36`) has no `release_notes` row.** *Blocker: a superadmin session in `ReleaseNotesPanel`.*
- **SEO pages have no public renderer.** `marketing_seo_pages` rows hold a title, meta, params and structured data, but no body or template, and no frontend route reads them. So `POST /api/public/web/:owner/seo/impression` has no caller. The counter is ready: KV-buffered `seo.impression`, published rows only. *Blocker: a content model (a template per `pattern`) for what an SEO page renders.*
- **Website pages can only be managed through the API.** `POST /api/web/website` (create, update, and since 2026-11-08 publish and unpublish) has no frontend client, so a tenant can't author or publish a `/w/<owner>/…` page from the product. Platform (NULL-tenant) pages are seed-only. Fix: a website-page editor and a publish control on the typed client. This is new authoring scope, not a regression.

### Distribution `[growth]`

- **Rovr isn't in the Chrome Web Store.** *Blocker: developer account + listing.*
- **Hugging Face push, reviewer test tenant, cloud marketplaces.** *Blocker: accounts, legal entity, partner programs, `ACTION_MIRROR_*`.*
- **[integrations] Miro uses a personal token.** *Blocker: a registered app.*

---

## 🧰 OTHER — enabling work outside the arc

### CI and release `[platform]`

- **The API Worker deploys without source maps.** Wrangler 4.157 uploads source maps by default, and `builderforce-api`'s (58 MB raw, 15.0 MiB gzipped with `sourcesContent`) passed Cloudflare's 15 MiB cap on 2026-11-20, so Deploy API was refused (code 10021). `api/wrangler.toml` sets `upload_source_maps = false` to unblock deploys, so Workers Logs show bundled line numbers. Fix: bundle the API ourselves (esbuild `sourcemap: true, sourcesContent: false`, deploy `--no-bundle`) or otherwise shrink the maps under the cap, then turn upload back on. Unblocks source-mapped stack traces in production errors.
- **The repo's `.github` files claim gates nothing enforces** (found by the 2026-11-18 merge-process fold): `main` has no branch protection, yet `CODEOWNERS` says code-owner approval is required; the PR template asks for coverage and CVE attestations no workflow checks; CodeQL has a config but no workflow; these files and `SECURITY.md` cite FR/AC numbers from a PRD that isn't in the repo. Either enforce them or make the files say what actually gates a change. *Blocker: operator decision on branch protection, a coverage gate and a CodeQL workflow.* [platform.md › Merge process](./docs/specs/platform.md#reference--merge-process).
- **VS Code release job goes green without publishing.** A missing `VSCE_PAT` / `OVSX_PAT` now logs a warning and skips the publish, but the job still passes, and `|| echo` (`release.yml` ~394–416) swallows every publish failure, not only "already exists". Fail on a missing secret; treat only "already exists" as a no-op. *Blocker: the two tokens.*
- **`replicaPump.delta.test.ts` times out under machine load.** `packages/agent-tools/src/knowledge/replicaPump.delta.test.ts` exceeds its timeout on a busy machine. Fix: shrink its fixture or raise the per-test timeout to fit its work. Fixing it removes a flaky red from the agent-tools suite.
- **Frontend Worker bundle over Cloudflare's limit.** `check-worker-size` fails: 10.82 MiB compressed vs 10.00 MiB (Release 42525421978). The shared webpack chunk is 7.58 MiB and carries WGSL shader text, a font parser and parse5. The tenant-site route `w/[owner]` is 0.82 MiB since its markdown moved server-side (`lib/markdownRender.ts`). Fix: keep the client-only renderers (WebGPU, drawing, fonts) out of the server graph with `dynamic(..., { ssr:false })`, and check which server components pull them in. Unblocks Build frontend and frontend deploy. Until it deploys, `https://builderforce.ai/schema/app.v1.json` returns 404, and app manifests created before 5f2a7087a still carry that `$schema` (VS Code reports "Unable to load schema") until `/manifest move` or `/launch`'s "Remove its $schema" offer strips it (b58522b66); new manifests no longer write it.

- **CI never runs frontend unit tests; 19 fail in 12 files.** Fix them and add a vitest job.
- **Verify never bundles the Worker.** Add `wrangler deploy --dry-run`; make `deploy-frontend` and VS Code wait for `deploy-api`.
- **A red commit still publishes to the CDN.** *Blocker: operator decision; release order is deliberate.*
- **Flaky or heap-bound tests:** `CreationCanvas.test.tsx`, `agents/sandbox/registry.test.ts:207`, `useBrainConversation.test.tsx`, `harness/scenarios.test.ts`.
- **CI safety:** no ephemeral-DB migrate dry-run; `production` reviewer rule unset; `qa-e2e` in no workflow; no CodeQL workflow.
- **`packages/repo-map` doesn't declare `agent-tools`.**
- **builderforce-inference console builds only when nested.** *Blocker: operator decision on checkout layout.*

### LLM gateway and routing `[agents]`

- **BYO 429s are never cooled across turns (chat #168571, found 2026-11-21).** `proxyDispatcher` drops owner-served attempts from `recordFailures` and `proxySeed` filters them from cooldown reads, so the same 429'd BYO head (`direct/moonshot/kimi-k3`) was tried first for 13 turns; the earlier "fixed 2026-11-21" claim was wrong — no fix was ever committed. Fix underway (chat #289 W4): tenant-scoped `byoCooldown` store (shared cache helpers), demote-not-drop incl. the auto-ladder head, `cooled` response metadata. Same pass: `cooldownStore` raw kv violates the shared-cache rule, `Retry-After` is parsed nowhere, and the `proxyFunding` comment falsely calls vendorHealth tenant-scoped.

- **Kimi Code `k3` sends no response headers for 240s on large prompts.** Seen four times: 2026-11-04 in chat #46121, and twice on 2026-11-06 in chat #46169. Each time the editor called `api.kimi.ai/coding/v1` directly with a prompt of about 75K tokens, and the request was dropped at the header deadline in `streamChatCompletion.ts`. One failure was step 0 of a fresh run with a fresh token. The 2026-11-06 pass makes the failure diagnosable (destination, phase, request size and credential state on the failed step, plus an output-channel line) and offers "Choose another model". A live probe on 2026-11-06 with the CLI token found the following. Kimi holds response headers until the first token, so time-to-headers equals queue plus prefill time. A ~75K-token `k3` prompt with 67 tools and `max_tokens: 4096` answered in 11–27s. So prompt size and tool count do not reproduce the stall. Still open are the workspace-connection token (which the failing runs used), the real multi-turn tool history, and a transient Kimi-side stall. **Blocker:** the original request bodies were not recorded, so there is nothing to replay. The new failure detail records request bytes, message and tool counts, and credential state. The next occurrence will narrow the cause down, then replay it against both tokens.
- **Kimi K3 leads a Kimi Code subscription only when the tenant selects it (found 2026-11-18).** The server cannot read Kimi Code's `/models`, because Kimi's edge refuses the Worker's egress (`providerModelCatalog.ts` `loadAccountModels` returns null). Its only entitlement signal is the tenant's model selection (`tenant_llm_provider_models`), so plan-gated coders (`k3`, `k3-256k`) never seed on their own. The editor does hold the account's live model list (`connectedAccounts` credential `models`). Fix: the editor reports that list to the server as the account's entitlement, and `byoAutoSeedModels` seeds a gated coder the list contains. **Blocker:** an operator decision on whether the editor should report the account's model list to the server.
- **Rovr's Test still checks a Kimi Code account through the server (found 2026-11-19).** VS Code and its composer now test accounts the editor calls itself from the person's machine (`packages/provider-connect/src/accountTest.ts` `testAccountFromThisMachine`, passed to `createProviderConnectionsClient` as `testLocally`). Rovr (`clients/chrome/src/host/panelServices.ts`) does not pass `testLocally`, so its Test reports `local_egress_required` unless an agent host is online. Fix: pass the same probe to Rovr's connections client. It has to be gated on Rovr's origin permission for the Kimi host.
- **iOS has no workspace picker.** `CloudAccount.swift` builds `CloudSession` without a `workspaceID` and nothing calls `setWorkspace`, so the shared kit's workspace switch (and its `workspaceSignInNeeded` flag + `chat.workspace.signInNeeded` string) never runs on iOS. Next: add a switcher to the iOS account screen that lists `workspaces()`, calls `setWorkspace`, and shows the sign-in-needed message — parity with Android `CloudAccountSettings`.
- **Who may replace workspace subscriptions.** `/llm/provider-keys` and subscription OAuth routes check membership, not role, including PUT and DELETE. *Blocker: operator role policy.*
- **Code turns resolved to MiniMax Flash with Grok and Kimi connected (chat #6).** Read the recorded `failovers` + `gateway.byo_seed`, then fix the account or the seed rule.
- **The context-fold summary is capped, not cheap.** Since VSIX 2026.10.153, `brain-embedded/src/run/brainFold.ts` stops the history summary after 15s and the turn continues on the most recent messages. Without that cap, a very large chat (#56654: 1,311 steps after a 323-step run) hung in startup on every message. But `summarizeTranscript` (builderforce-memory `working/summary.ts`) still runs in sequential 48k-token chunks, each sent to the on-device model first (`onDevice/utilitySummary.ts`, which has no time limit of its own). So a huge chat loses its oldest context on each timed-out run instead of getting a summary note. Next: summarize incrementally (fold only what has arrived since the saved summary), keep a partial summary when time runs out, and give the device step its own time limit.
- **Latency failover has no history from earlier runs.** `run-policy/latencyGuard.ts` only measures turn times within the current run, and `RunPolicyOptions.latencySeed` has no caller. So a run's first failover can still pick a slow model that hasn't been measured, as MiniMax Flash took 97s per turn in chat #60338. Next: record a p50 latency per model in learned routing (`ActionModelRankStat`, added in two steps: the new column first, removals later), and seed `latencySeed` from it when the run starts.
- **Cloud runs have no C8 compression.** *Blocker: an ONNX image build.*
- **Drift guard reads only OpenRouter, NIM, Cerebras;** pools are hardcoded. *Blocker: credentialed refresh inside the Worker.*
- **Only Qwen and Kimi offer a model choice.** *Blocker: one live key per other vendor.*
- **No per-user spend limit;** `usageAttribution.ts` only reports. [platform.md › PRD 05 §6](./docs/specs/platform.md#6-llm-gateway--per-segment-credit)
- **Image generation has no BYO path.**
- **`llm` workflow nodes use the host key** (`orchestrator.ts:832`).
- **Decide `tenant_model` presets:** retire or rename.
- **Codex OAuth races a local CLI on port 1455.** *Blocker: an OpenAI client registration.*
- **Kimi from cloud agents** is refused at Kimi's edge. *Blocker: Kimi's approval + a non-Cloudflare egress host.*
- **SDK long tail:** split `connectTimeoutMs`/`streamTimeoutMs`; date the `coderclawllm/` prefix removal; register `vision.describe` and `ocr.extract`; move hired.video's own client and cascade onto the SDK.
- **Rovr has no BYO pool pin.** The row is hidden; add a typed pin read by `inference/route.ts`.
- **No on-device model has answered a turn in a real browser.** Add a Playwright + WebGPU run recording telemetry.

### Brain chat `[agents]`

- **Prior-research reuse is prompt guidance only** (`priorResearch.ts`). Add an enforced guard with a staleness rule.
- **Ask-the-Manager zero tool calls.** Log the payload shape in `buildResponsesBody`.
- **Duplicate label tables:** audit each host.
- **`DEFAULT_CHAT_TITLE` has two homes.** Give the Brain chat contract one shared home.
- **Project #11 still carries a placeholder key, so every ticket key reads `1-UNTITLED-1773010025035-N`** (found 2026-11-19, chats #273/#275). The key was stored before `buildProjectKey` stopped generating placeholders; `tickets.from_delta` and normal creation both build keys correctly from it. Fix: rename the project key, which re-keys every ticket on the board via `rekeyProject`. *Blocker: operator decision to re-key project #11's tickets.*

### Evermind / SSM `[agents]`

- **Run recall returns irrelevant items at high scores (chat #168571: 0.79/0.63 for unrelated tickets).** The ranking cannot be tuned safely without labelled evidence. *Blocker: a relevance eval set.*

- **Per-run faithfulness is relevance-only:** `scoreRunOutcome` passes no context to `lexicalEval`.
- **Coding gate (≥90% of frontier) closed.** *Blocker: a trained checkpoint.*
- **GPU backward pass unvalidated;** no LoRA in kernels. *Blocker: a WebGPU device.*
- **Knowledge pipeline:** review queue, extraction, KRs.
- **Two canonical-JSON serialisers.** *Blocker: a `v2:` hash + backfill.*
- **Foreign-checkpoint weight port.** *Blocker: real checkpoints.*
- **Auto-routing eval gate;** Evermind is pin-only. *Blocker: gate criteria.*
- **Teach:** confirm the console polls the status channel and the provenance backfill ran.
- **builderforce-memory import:** Markdown auto-memory isn't importable. *Blocker: a live MCP stdio host.*
- **Tool turn costs one forward pass per candidate.** Needs a prefix cache.
- **Video/image codebooks untrained.** *Blocker: GPU training.*
- **API doesn't use the enterprise ports;** it imports `bm25Search` directly.
- **External:** transformers.js `model_type`, llama.cpp GGUF, HF push.

### Agent runtime, desktop and VS Code `[agents]` `[platform]`

- **[vscode] PRD 49: methodology personas and the `.builderforce/` layout** (TIP Code parity, opened 2026-11-21, `docs/specs/make.md` PRD 49). The four roles (Analyst, Designer, Engineer, Support) are built-in `PersonaRegistry` entries with gates, a next-role offer and tool-enforced write scope. Their artifacts are indexed as a codebase knowledge pack. Model routing offers role routing (default) and a TIP policy setting. Local models gain ONNX q4 Bonsai beside GGUF. Packs are written as `.gz` and `read_file` reads `.gz`. The manifest, methodology, logs and diagnostics move under `.builderforce/` through one resolver with checked overrides. Next step: publish the end-state design (contracts, codemap, done-checks §9) for review. The manifest move depends on builderforce-webcontainers ROADMAP item 28 shipping first.
- **[knowledge view] Visualizer redesign and three open stage bugs** (opened 2026-11-21; design: https://claude.ai/artifact/Jc9RMHYDq4ziJBjbYKUfUn; all in `packages/knowledge-graph-view/src`). Root causes found by reading the code, none fixed yet, none confirmed in the running webview:
  - Map and Sequence leave an empty band and clip lines: `stage/Stage.tsx:185` sizes a `document`-frame stage from `documentHeight(bounds, width)` and ignores the box height. Fix: never shorter than the box.
  - Mark names are missing on every stage camera in VS Code: troika's `blob:` worker cannot fetch the `vscode-resource` font URL and swallows the failure (`stage/labels/troika.ts`, `stage/fonts.ts`). Fix: fetch the font on the main thread, hand troika a `blob:` URL, show DOM captions until it resolves.
  - The shape legend is only an unlabelled icon in `surface/CameraBar.tsx`. Fix: dock `ShapeLegend` in `stage/rig/StageCorner.tsx` above the nav controls.
  - Redesign scope: icon top bar with duplicates removed (zoom/Fit only in the stage corner), chevrons on the three panels in place of `PanelVisibilityToggles`, plain-language walkthrough (doors, hallways, rooms), depth trail, simulate-with-values as a full mode, a code button on every mark that opens a Code panel synced both ways with the picture (scroll follows, clicking a method drills in). Unblocks: a non-technical reader can follow a journey through the code.
- **[vscode] Webview `platformPolicy` tests fail** (three time out, one mock is called three times). The rewrite in `325f4faaf` didn't update the older cases. agentic-7d is placing an owner.
- **Local model context windows are still unknown on three paths (found 2026-11-17 while fixing chat #149169). VSIX 2026.10.189 fixed the Kimi Code CLI install.**
  - `clients/vscode/src/modelRouting.ts` `localWindowProbes()` returns `[]` unless `localModels.localFirst` is on, so a pinned Ollama, Synapse or FreeToken model gets only the shipped catalog window.
  - The transport's sync `window()` (`brain-embedded/src/run/modelTransport.ts`) never sees live probe windows such as Ollama's `num_ctx`.
  - Kimi rows from the workspace connection (`localCredentialSnapshot("kimi")`) carry no `max_context_size`.

  Fixing these sizes reads, window fit and mention budgets to the real model instead of the 16K / 8K defaults. **Blocker:** an operator decision. `routeStream` reuses `localWindowProbes()` as Hybrid's local-first candidate set, so probing whenever local-first is off would change routing.
Synapse lives in [builderforce-inference](https://github.com/SeanHogg/builderforce-inference), Spawn in [builderforce-spawn](https://github.com/SeanHogg/builderforce-spawn).

- **[vscode] The knowledge graph build blocks the extension host for 0.5–4 s at a time, which delays typing.** Evidence is 14 `UNRESPONSIVE extension host` profiles (2026-11-15 00:01–09:51, VSIX .174/.175) that blame `builderforce-ai` for 50–95% of each stall.
  - The hot path is memory `graphDigest` (canonical JSON plus pure-JS SHA-256 over the whole input), the code-graph layer glob match, PageRank and communities. All of it runs synchronously in `buildStoredGraph`→`buildCodeGraph`.
  - Callers on the host: the view's `load` on panel open, `subscribeLiveGraph` doing a full rebuild per change, the review "grow" reload, `rootSyncStatus` (a full build just for counts), pinpoint, `runDelta/sideFacts.ts` (2 full builds per delta), and prefetch `codePackExecutors` (`buildCodeGraph` after the worker analysis).
  - The background indexer starts at activation (`knowledge.autoIndex` defaults to on).
  - 2026-11-19 (VSIX .193): Runtime Status reports `onView:builderforce.chatView` activation at 10,757 ms. The stall monitor then logs 2.7 s, 5.4 s and 10.1 s blocks right after activation, with 13 s and 15 s blocks later while `[knowledge] plan` counts 30K+ files and `syncStatus` takes 11–12 s. Moving indexing off the activation path is part of the "Done when" above.
  - Done when: knowledge work starts only from the Visualizer's Run, every graph build runs in a worker, and live tracking ships deltas, not full rebuilds.
  - *Blocker: the end-state design awaits the user's review.*

- **The editor can act in a tenant where the person has no connections.** One VS Code session ran in tenant #1 as `contributor`, while its Kimi, Anthropic, MiniMax, Moonshot and xAI accounts and chats #195/#198 belonged to another workspace. *Blocker: which tenant the key is bound to and why it was selected needs the live membership and key rows.*
- **Direct calls for xAI, MiniMax, Moonshot and Anthropic accounts are not built.** The half-built attempt in a6937d561 was removed: only Kimi has a server credential source (`localCredential.ts`). Add a source per provider, then its runtime entry, to let these accounts run from the person's machine.
- **Shipped VSIX webview still calls `GET /api/boards/:boardId/swimlanes/:laneId/agents`.** The committed bundle `clients/vscode/media/webview/index.js` predates the board's move to `/lane-agents`. The route is kept as a cached compatibility shim in `boardRoutes.ts`; delete it once a rebuilt VSIX ships. *Blocker: VSIX rebuild and release is owned by the VS Code session.*
- **The chat journal rewrites whole rows.** `local-first-v3.journal` reached 226 MB, with a 1.25 MB chat row and 1.3 MB message rows rewritten by routine commits. Opening it is not slow (2.6 s fold), but commits take up to 1.5 s. Store large row payloads apart so a commit stays small.

- **Compaction holds the cross-window lock for the whole rewrite** (2.7 s measured on 20,847 records; `compact` in `durableLocalFirstStore.ts`). Other windows now wait instead of failing, but their writes stall that long. Stream the temp file from `memory.view()` without the lock, then lock, catch up, fsync and rename. *Blocker: operator cut this pass to data-loss fixes (weekly limit, 2026-11-01).*

RESOLVED 2026-11-01: length-prefixed frames make a torn tail detectable; the journal now carries a base-generation id minted per compaction (`mintJournalGeneration`), replacing `(ino, birthtimeMs)` identity; the EPERM-on-rename retry is bounded and falls through to keep the last-good copy; `storeContract.ts` documents that `read`/`scan` return live committed Maps. (Package-side changes shipped in this commit; verified by local-first `tsc` + 559/559 tests.)
- **A damaged journal is slow and quiet.** A refused open repeats its full load on every call (`durableLocalFirstStore.ts:251`), and a read-only window rescans the whole journal on every read (`:294`): remember the corrupt load by identity and size. A rebuild reaches only the host log, so show one notice that names the `.corrupt-` copy. The sidecar lists every row and event id and is parsed on each open: put size and mtime in a small header file. When both windows edit one row, the higher `version` wins silently: create a `SyncConflict`. *Blocker: operator cut this pass to data-loss fixes (weekly limit, 2026-11-01).*
- **Unattributed event-loop gaps.** 1028 ms during the first v3 import and 487 ms across 100 commits, with single commits at 19–34 ms. Instrument the stages. *Blocker: as above.*
- **Scans with no early exit.** `Transaction.scan` walks every type; `sendMessages`, `dropPending`, `chatSyncHost` and `chatSync.ts` repeat it, and `localAuditStore.ts` still lists whole types. A per-type index and a stop-returning visitor remove them. A 13,970-message transcript read takes about 400 ms. *Blocker: as above.*

RESOLVED 2026-11-01 (commit 67f461953): the identity bind in `brainRunHost.run` is now bounded (a documented upper bound in ms), so a slow/unreachable identity endpoint cannot stall the run indefinitely; on timeout the run proceeds on the local/unbound path.

RESOLVED 2026-11-01 (commit 67f461953): the pending-turn wiring and `servedBy` are colocated with `usePendingTurns`; `UNUSED_STORE` is now a single shared export (`composer/unusedDraftStore.ts`) imported by all three consumers; the two `clone` definitions were folded into one shared module.
- **The creation canvas shows no immediate bubble and no live model.** `creation-canvas/BrainSurface.tsx` takes `messages`, `trace` and `running` from the run store, so `pendingTurn` and `servedBy` never reach it. The run store needs to carry both. *Blocker: operator cut this pass to data-loss fixes (weekly limit, 2026-11-01).*
- **The pre-v3 store files stay on disk after import.** `local-first-v2.journal` and `local-first-v1.json.pre-v3` are the rollback copy (about 230 MB on one machine). Delete them on open once v3 has shipped. *Blocker: one release of v3 in the field.*
- **`createIndexedDbLocalFirstStore` reads and rewrites the whole snapshot per call.** `packages/local-first/src/indexedDb.ts`: web work management and Rovr scale with store size, as the VSIX did. Needs per-row persistence or a delta frame. *Blocker: not started; needs an IndexedDB schema change outside the VSIX fix, and an operator call on when.*
- **Local tool turns answered in prose are accepted.** `answered` in `localFirstTransport.ts`; the 0-tool case scores healthy. *Blocker: product decision on holding the first delta.*
- **Ollama loaded at a larger `num_ctx` overstates our window.** *Blocker: move to `/api/chat` or an upstream route.*
- **Windows command routed to bash loses backslashes** (`packages/agent-tools/src/node-posix-shell.ts`). *Blocker: a trace of the routing decision.*
- **Self-Directed Agents are Windows-only.** *Blocker: a Mac; an X11 session.*
- **Installers unsigned, no updater.** Windows and macOS signing are wired; Tauri updater signing isn't. *Blocker: signing secrets in both repos.* Then delete `SpawnDownloadButton`'s first-run hints.
- **~3.3 GB after indexing one small package.** Profiled and the dominant retention fixed (2026-11-01): host `meta.text` kept the full card text per node; now clipped to a 256-char excerpt, full text stays in the engine. See DONE.md.
- **Phase 3 browser/VM host.** *Blocker: prompt-injection defence first.*
- **pi-tui is the last `@mariozechner/pi-*` dep.** 23 importers left; migrate to Ink.
- **Engine convergence:** sandbox-aware provider; `read`, `exec`, `process` stay native; `RelayTaskEngine`.
- **Portal channel config flows up only;** `channel.configure` doesn't exist. *Blocker: a running on-prem host.*
- **`@builderforce` participant forgets tool work after restart;** native sessions tab needs the proposed API; sign-in untested (*blocker: a test tenant + `BF_EDITOR_KEY`*).

### Data model — PRD 20 `[platform]`

- **LinkedIn rows retired by 1102** need a reconciler or a drop.
- **[data] `tasks.tenant_id` is NOT NULL in the database but nullable in Drizzle** (`schema/delivery.ts:228`, filled by `trg_tasks_tenant`, migration 0944). `TaskRepository.toDomain` has to map `null` to `undefined`. Marking it `.notNull()` lets the mapper pass it straight through.
- **Voice embedding plaintext column** (pre-1326 `embedding` jsonb) is still read and resealed. *Blocker: drop it in push 2, after push 1 has deployed (expand/contract).*
- **[canvas] Four contact stores** (`sales_contacts`, `ri_prospects`, `lists`, `marketing_audience_members`) need one identity. *Blocker: operator picks the canonical store.*
- **[canvas] Survey stores.** Move `pulse_surveys` onto `question_sets` `kind='pulse'` keeping anonymity, port DevEx eNPS logic, route `newsletter_subscribers` through the campaign rail or retire it.
- **The coverage map and the schema disagree (found by the 2026-11-17 PRD verification).** `brain_chat_trace` is still `keep` though migration 1212 dropped it; `site_traffic_daily`, `rd_financials_quarterly`, `agent_host_projects`, `team_projects` and `sales_campaigns` are mapped as gone but still declared; the schema-presence check is not a hard gate (`api/scripts/check-model-coverage.mjs:98`); `drive_connections`/`mailbox_connections` were never folded into kernel `connections`. Ratchets: 109 adoption, 22 boundary, 3 polymorphic, 1 duplicate pair (`initiatives`/`portfolios`). [platform.md › PRD 20 §4](./docs/specs/platform.md#4-validation--six-machine-checks)
- **Primitive adoption:** `runs` and `work_items` have no feature writer. [platform.md › PRD 20 §2](./docs/specs/platform.md#2-the-kernel--25-tables-owned-by-no-domain)
- **135 ratchet violations:** 109 table adoption, 22 domain boundary, 3 polymorphic, 1 duplicate cluster (`initiatives`/`portfolios`). [platform.md › PRD 20 §5](./docs/specs/platform.md#5-step-3--turn-the-ratchets-into-gates)
- **Legacy shape tables hold live rows.** Backfill, cut over, drop per family. [platform.md › PRD 20 §5](./docs/specs/platform.md#5-step-5--migrate-the-collapsible-families-in-this-order)
- **`sessions` and `ai_usage_records` have no writer.** `table-adoption.mjs` rules them superseded. Drop them. [platform.md › PRD 20 §5](./docs/specs/platform.md#5-step-5--migrate-the-collapsible-families-in-this-order)
- **Steps 6–7 moving the wrong way:** 155 application folders (target 16), 286 route files, 204 `page.tsx`. Needs an owning lane. [platform.md › PRD 20 §5](./docs/specs/platform.md#5-step-6--collapse-the-middle-layers-onto-the-domain-modules)
- **Three representations of a message's author.** `brain_chat_messages.author_user_id` (PRD 42, human turns), kernel threads' `authorKind`/`authorRef`, and meeting lines' `metadata.authoredBy`. One fact, three shapes. Consolidate onto one author reference so translation, attribution and audit read the same field.
- **Legacy routes register into `objects` only on the sweep.** [platform.md › PRD 20 §6.3](./docs/specs/platform.md#63-the-api-surface-falls-out-of-the-roster)
- **Table families straddle modules;** needs an ownership manifest. [platform.md › PRD 20 §6](./docs/specs/platform.md#6-the-stack--one-domain-four-layers-one-seat)
- **Migration numbering:** 8 collisions, five ledger rows with no file, 78 drift-allowlist entries. [platform.md › PRD 20 §5](./docs/specs/platform.md#5-step-4--convert)

### Code health `[platform]`

- **The API has no await-in-loop check and no per-route latency or query instrumentation.** Add both; add cursors and `pg_trgm` only where those measurements show the need. [platform.md › PRD 22](./docs/specs/platform.md#12-backend-speed-and-execution-controls).
- **No reuse census of frontend interaction patterns** (async state, dialogs, forms, filters, tables). Check one in, then extend `components/ui` one feature slice at a time. [platform.md › PRD 22](./docs/specs/platform.md#118-reusable-frontend-component-program).
- **Canvas collaboration still sends graph snapshots.** `broadcastableCanvasChange` is used only by its own test; broadcast domain events from `useSharedCanvasRoom`/`guestRoomGateway` and add H-21's divergence test. [platform.md › PRD 22](./docs/specs/platform.md#44-where-this-document-is-and-is-not-domain-driven--b-events-on-the-wire).
- **No `BrowserCapabilities` service;** worker, WebGPU, WebNN, WASM and storage checks are scattered. Add one facts-only infrastructure service and route the checks through it. [platform.md › PRD 22](./docs/specs/platform.md#43-capability-routing-contract).
- **Three components construct engines directly** (`AITrainingPanel`, `AgentPublishPanel`, `AgentStateViewer`), and `creationObjectRegistry` is not yet the only `CreationFlowNode` factory. Move construction into infrastructure factories. [platform.md › PRD 22](./docs/specs/platform.md#119-creational-pattern-program).
- **21 client-rooted pages remain** (`useClientPages`), and per-route first-load JS was never recorded. Convert the highest-traffic pages first and record first-load JS and hydration. [platform.md › PRD 22](./docs/specs/platform.md#314-p0--the-application-is-a-client-side-spa-wearing-an-app-router).
- **Images ship unoptimized:** `images: { unoptimized: true }` and a 1.9 MB priority hero PNG (`BrainBackdrop.tsx`). Pre-generate AVIF/WebP variants or use Cloudflare resizing. [platform.md › PRD 22](./docs/specs/platform.md#311-p2--static-image-delivery-leaves-an-avoidable-initial-load-cost).
- **Every canvas edit stringifies the whole graph twice** (`useCanvasHistoryCheckpoint.ts`; the undo stack is `string[]` snapshots). Move history to `domains/canvas/domain/history.ts` as commands with periodic worker checkpoints. [platform.md › PRD 22](./docs/specs/platform.md#37-p1--full-graph-serialisation-repeats-after-ordinary-canvas-edits).
- **No lint caps `--grad-brand` at two per page** (hero + CTA). Add it over `.mk-band` usage. [platform.md › PRD 21](./docs/specs/platform.md#11104-what-this-adds-to-checkdesign-tokens-open-item).
- **412 files hand-roll `border: 1px solid var(--border-subtle)`** instead of `<Surface>`. Sweep surface by surface, shell-touched surfaces first. [platform.md › PRD 21](./docs/specs/platform.md#27--291-migrate-onto-the-primitives).
- **3,240 off-scale font sizes** (`check-design-scale.mjs` `offScaleFontSizes`), including the `.ui-page-header__description` primitive at 14px. Sweep onto `--font-size-*` and lower the baseline each pass. [platform.md › PRD 21](./docs/specs/platform.md#23-typography--all-sans-adoption).
- **Typed ids, contract push still to come: `sync_entity_mappings.server_id` and the wire's `serverId` text are still dual-written beside `sync_id`.** The expand push (migration 1339, `docs/specs/platform.md` › Typed entity ids §4) added `sync_id bigint`. The api reader prefers `server_id` (`api/src/application/sync/syncIds.ts mappedServerKey`) because rows written by the old Worker leave `sync_id` stale. The contract push will: [platform.md › Design §4](./docs/specs/platform.md#4-storage--server-contract-push-drop-server_id-on-mappings)
  - drop `server_id` from mappings, after a backfill re-run;
  - flip `mappedServerKey` to read `sync_id` first;
  - stop sending `serverId` text on receipts;
  - drop `ServerMapping.serverId` on the device.

  Blocker: the `/api/sync` push telemetry has to show no client below the version that reads `syncId`, and that takes a release in the field.
- **`clearCommentPins` has no caller (found by the 2026-11-17 PRD verification).** `api/src/application/canvas/canvasComments.ts:274` carries the SET NULL obligation its header says is "called" when a canvas object is deleted; nothing calls it, so pins can point at deleted objects. Wire it into the object-delete path.
- **Typed ids: the §7 api UUID sweep (26 allowlisted files) has no entry (found by the 2026-11-17 PRD verification).** Design: `docs/specs/platform.md` › Typed entity ids §7. [platform.md › Design §7](./docs/specs/platform.md#7-not-in-scope-logged--api-non-sync-uuid-sweep)
- **No guard enforces the read-through cache rule (found by the 2026-11-17 PRD verification)** (`getOrSetCached` for read-heavy paths, PRD 20). [platform.md › PRD 20](./docs/specs/platform.md#prd-20--the-consolidated-data-model-the-api-on-it-and-the-experience-on-that).
- **Layering ratchet at 96;** 81 presentation modules import the schema. Worst: `creationSessionRoutes`, `adminRoutes`, `qaRoutes`. [platform.md › PRD 22 §11.1](./docs/specs/platform.md#111-presentation-depends-on-use-cases)
- **198 unscoped tenant queries in 87 files** (baseline `api/scripts/.tenant-scope-baseline.txt`, 2026-11-18). [run.md › SOC 2 Type I Compliance §3](./docs/specs/run.md#3-identified-gaps-open)
- **14 of 37 permissions advisory.**
- **God modules:** `builtinMcpService` 4,607, `adminRoutes` 2,994, `creationSessionRoutes` 2,994, `TaskMgmtContent` 2,761, `agentHostRoutes` 2,173, `ManagerService` 2,126, `managerDiagnostics` 1,878, `boardsync/providers` 1,859, `extension.ts` 1,707, `api/src/index.ts` 1,536, `jobRoutes` 1,261, `MarketplacePageClient` 1,161. [platform.md › PRD 22 §11.6](./docs/specs/platform.md#116-behavioral-seam-reductions)
- **QA blind spots:**
  - Coverage is configured only in `agent-runtime/vitest.config.ts`, and there with `all: false`, so files no test loads never count against the thresholds.
  - api, frontend, clients/vscode, packages and brain-embedded have tests (1,369, 699, 190, 409 and 196 files) but no coverage.
  - The API "OpenAPI" is `api/src/openapi/schema.ts`: TypeScript interfaces documenting 9 endpoints, against 2,554 route registrations in 280 modules under `presentation/routes`; only 12 modules have zod request schemas (`*.schemas.ts`). There is no machine-readable spec, so there is no contract testing and no Postman export.
  
  Fixing this unblocks the visualizer's Coverage lens and API view. *The visualizer's Coverage and API panels shipped on 2026-11-05 (VS Code 2026.10.130). They show coverage as "Not set up" and every route as undocumented until this is fixed in the repo: v8 coverage with `all: true` per package, and an OpenAPI 3.1 document generated from the routes.*
- **[PRD 47](./docs/specs/platform.md#prd-47--one-collection-view-card--list-selection-bulk-deletearchivemerge-server-paging-and-sort) One Collection view: W0 landed, nothing consumes it yet.**
  - Landed: contract types, `parsePageQuery`, `POST /api/collections/:entity/bulk` + `runBulkAction` (`api/src/index.ts:716`), the 16 `components/collection/*` modules, the `archived_at` expand migration 1352.
  - W0 remainder: register bulk ports (every entity 404s today); call `parsePageQuery` from list routes; the admin bulk route and the three guards; `PAGE_SIZE_OPTIONS` is still 50/100/200; `archivedAt` on the Drizzle `workflows`/`workflowDefinitions` tables; `collectionTypes.ts` duplicates the interaction-contract types; frontend component tests.
  - Then W1 (projects, tasks gains Card, workforce roles, creation library). Bulk actions still fan out one request per id (`useCreationLibraryActions.ts`, `TaskMgmtContent.tsx`), causing the 429s.
  - Done when the `check:collection-surfaces` and `check:bulk-fanout` allowlists are empty.
  - **In flight 2026-11-20 (operator report):** (a) List never switches on card-default surfaces — `useCollectionPreferences` returns `defaultView` whenever the stored view isn't `card`; (b) header/footer scroll away under a page title — the root's static `100dvh − topbar` cap ignores the content above it; (c) the `check:collection-surfaces` guard does not exist; (d) Workforce › Performance (metrics, EMP, contributors, audit) still renders private tables.
- **`builderforceApi.ts` 9,965 lines.** Split to `lib/api/<domain>.ts`. Board rosters (`boardRostersApi.ts`) and Discovery (`discoveryApi.ts`) are out; their changes are uncommitted. [platform.md › PRD 22 §3.5](./docs/specs/platform.md#35-p0--a-cross-domain-api-god-module-defeats-ownership-and-code-splitting)
- **Unused primitives:** ~21 `fetchProjects()` callers, 128 raw storage sites, 76 `canEdit` guards, 55 `smoothstep` literals; `stage.connect` has no production caller.
- **Canvas real-browser pass** misses the `+` command bar, bottom nav and Brain-not-covering.
- **PRD 21 nav:** M3 seat workbench, M5 dimmed-row preview. [platform.md › PRD 21 §11.7](./docs/specs/platform.md#117-sequence-open-milestones)
- **[PRD 22](./docs/specs/platform.md):** LoRA off the main thread, off-thread file and diff work, cache eviction, cyclomatic ratchet, Phase-0 baseline.
- **i18n:** no CJK fallback; re-partition 349 namespaces by domain; measure the hardcoded remainder.
- **Decide:** `BUILDERFORCE_MODELS` fallback.
- **Code review 2026-11-09, god files still over size:** `builtinMcpService.ts` (4,665 lines), `importSyncedTicket.ts` (466), `brain-embedded/src/streamChatCompletion.ts` (867). Everything else from that review is fixed (DONE.md 2026-11-10). *Blocker: other sessions are editing these files right now, so a split would collide with their uncommitted hunks.* [platform.md › PRD 22 §11.6](./docs/specs/platform.md#116-behavioral-seam-reductions)
- **Smaller:** 24 of 113 `recordActivity` calls pass `objectId`; `buildMimeMessage` extraction; `feedback-sdk` is a CDN snippet only; no sweep for pre-OTP accounts.

### Identity `[identity]`

- **Password login has no lockout or per-account attempt throttling** (only OTP is throttled); `login_attempts` and `bot_block_events` are mapped with no feature path. Add both to Builderforce auth. [run.md › PRD 19](./docs/specs/run.md#35-auth-reconciliation).
- **[integrations] Drive / OneDrive can't complete consent.** *Blocker: enable the Drive API and `drive.readonly`, `Files.Read`, register both `/api/drive/callback/*`.*
- **OAuth consent name; Google apps test-only.** *Blocker: console field, verification.*
- **OAuth over `/gateway/*` builds the wrong callback.** *Blocker: register in all four consoles.*
- **A canvas turn once sent no tenant token.** *Blocker: a repro.*
- **Segmented mode unusable:** inserts on `segment_id` tables lack `segmentId` (trigger 0056 raises); no RLS, segment roles or no-bleed test. [platform.md › PRD 05 §2.2](./docs/specs/platform.md#22-tenancy-enforcement-the-no-bleed-guarantee)
- **[PRD 05](./docs/specs/platform.md#prd-05--integration-embed-back--identity-federation) identity federation:** the inbound host OIDC verifier exists (`hostOidc.ts`) but reads only `acct`/`co`; `role`, `persona` and `plan` are ignored, a segment's stored plan is never read (no per-segment gating, credit tier or ledger), repo access is not confined to a segment, and there is no cross-segment no-bleed test. Host-side work is obsolete under PRD 19's burnrateos.com deprecation.
- **`tenant_modules` never created** (`platform_modules` and `tenant_member_modules` exist). *Blocker: operator confirms intent.*

### Infrastructure and cost `[platform]`

- **Five transactional emails can be dropped after the response returns** (found by the 2026-11-18 guide fold): `oauthRoutes.ts:502` (OAuth welcome), `oauthRoutes.ts:652` (the magic-link email sign-in depends on), `authRoutes.ts:571`, `authRoutes.ts:907` and `adminRoutes.ts:2659` call `void sendTransactionalEmail(...)` with no `waitUntil`, and keep `onDeliveryFailure: 'throw'`, so a provider failure is an unhandled rejection. Route them through `c.executionCtx.waitUntil` with a logged failure. [platform.md › Email](./docs/specs/platform.md#design--email-implementation-guide).
- **Internet search is lexical only.** Phase 3 (embedding worker, Vectorize adapter behind `SemanticIndex`, rank fusion, relevance fixtures) is unbuilt, and no crawl cron or Queue consumer runs. [platform.md › Internet search](./docs/specs/platform.md#delivery-phases-open).
- **CORS still accepts localhost in production.** Return URLs are now gated. *Blocker: operator decision on whether local development against the production API is supported.*
- **🔴 $0 platform (plan 2026-10-03).** Observability is on and cron is gated. Re-default cloud surface, move QA and CPU routes, take L2 off KV, then downgrade. *Blocker: consoles, CPU measurements, acceptance of 2–4 concurrent agents.*
- **🟠 `builderforce-core` on Neon Launch.** Enable autosuspend + 0.25 CU, then downgrade. *Blocker: Neon console.*
- **Core's stale site tables** (`project_sites`, `site_*`) still sit on core since the apps split. Dropping them is irreversible. *Blocker: a live row comparison of core against apps, which needs database access this session was refused.*
- **Fleet failover (PRD 39 §4b) never re-dispatches a run.** The server side is built (`tool_intents`, the reaper), but `recordWriteAheadAck` and `recordIntentAck` have no caller and no host sends intents. Wire a host to send intents and acks. Design: [platform.md › PRD 39](./docs/specs/platform.md#prd-39--platform-close-out).
- **No row retention on canvas history** (`creation_session_events`, `brain_chat_messages`). Snapshots are plan-capped and command bodies are redacted at 14 days; rows are kept indefinitely. *Blocker: decision on history kept.*
- **🟡 Legacy `agents` table (PRD 39 §3): push 1 shipped.** Push 2: drop the table and remove the declaration (`schema/agents.ts`); remove the alias routes after their 31 Dec Sunset. [platform.md › PRD 39 §3](./docs/specs/platform.md#3-retire-the-agents-table)
- **Monitors and board-sync run on the 30-minute floor on an idle platform,** so a 5-minute heartbeat can page up to about 30 minutes late. Prompt checks keep Neon awake permanently. *Blocker: operator decision, paging latency against the Neon cost ceiling.*
- **Neon's quota text over WebSocket is unobserved.** `neonAvailability.ts` matches the published wording. *Blocker: a capture from a quota-exhausted branch.*
- **Cloudflare serves a managed challenge to every datacenter caller.** `POST api.builderforce.ai/mcp` is challenged, so `release.yml` skips the MCP registry publish. Apply `scripts/cloudflare-bot-exception.mjs`. *Blocker: a zone token with Zone Settings:Edit + WAF:Edit.*
- **Strategy content in public git history.** Purge built. *Blocker: a quiet 30-minute window, then GitHub Support for `refs/pull/*`.*
- **Provider credit:** disconnect Moonshot on tenant 1; Together, FluxAPI, HF out. *Blocker: operator.*
- **`http://www` redirect** targets `http://`. *Blocker: a zone-edit credential.*
- **API Worker ~21 MB (PRD 39 §1): push 1 shipped.** Before push 2, `measure-gateway-bundle.mjs` puts the gateway at ~59% of the bundle, mostly pdfjs; per the PRD, cut that import first, then push 2 and the live proof. [platform.md › PRD 39 §1](./docs/specs/platform.md#1-gateway-worker-split)
- **Brand residuals:** rotate `clk_` keys.
