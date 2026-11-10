# PRD 41 — Offline understanding and the run delta

| | |
|---|---|
| Status | Design, reviewed by Opus 2026-11-06 with all findings applied. No code started. This document is the end state to build against. |
| Owner | Agents program. Model roles are in CLAUDE.md. |
| Roadmap | `ROADMAP.md` › Make › Cloud and IDE agent runs, and › Local-first. Builds on [PRD 38](./38-prd-knowledge-graph.md) (the knowledge graph), [PRD 40](./40-prd-knowledge-packs.md) (portable packs), the [offline-first review](../design/vsix-offline-first-architecture-review.md) (G01–G27), the [deterministic knowledge index](../design/deterministic-knowledge-index.md) and [deterministic prefetch](../design/deterministic-prefetch.md). |
| Date | 2026-11-06 |

## 1. What and why

People increasingly do not read the code an agent writes. They still need to know what the
code *is*, and above all what a run *did* to it. This PRD delivers three things:

1. **Offline VSIX.** The VS Code extension opens a folder, understands it, shows it in the
   visualizer, runs agents on local models and reports on those runs with **no sign-in and
   no BuilderForce API**. Signing in adds sync, gateway inference and cloud features. It
   never unlocks understanding.
2. **Incremental, deterministic understanding.** Understanding starts when a folder opens or
   the extension activates, and it does not wait for an explicit `/review`. It updates in
   proportion to what changed. The same bytes on disk give the same facts, findings and
   digests on any machine.
3. **The run delta.** After every agentic run, a report card answers four questions from
   measured facts, not from reading diffs:
   - Did the **security** attack surface or vectors change?
   - Did **performance** change?
   - Did any of the **-ilities** change? The list is ISO/IEC 25010.
   - Did **quality** change? This includes whether the agent weakened the tests that judge it.

4. **Predicted measures (Part D).** Classic statistics and ML formulas estimate what cannot
   be measured at run end:
   - the probability that a run will need a follow-up fix;
   - how many problems no detector found;
   - whether a trend is a real change;
   - which expensive checks are worth running;
   - which findings to show first.

   Predictions are labelled, versioned and reproducible, and they never set a verdict.

The governing idea is **diff the facts, not the text**. Both sides of a run are reduced to
sets of facts and findings by deterministic extractors and analyzers. The delta is a set
difference with lineage, and every verdict can be traced to evidence and then to code.

## 2. Principles

1. **Deterministic first.** Verdicts are computed. A model may write a narrative over the
   computed delta, labelled as narrative, and it never sets or changes a verdict. This is the
   same rule as [deterministic prefetch](../design/deterministic-prefetch.md).
2. **Local first.** The local store is the system of record. The server is a sync peer.
   Signed-out is a capability state, not an error state.
3. **Incremental by construction.** Every derived artifact names its inputs by content hash.
   A change recomputes only what depends on it, and an unchanged result stops propagation
   (early cutoff).
4. **Honest comparability.** A finding missing from an incomplete or changed measurement is
   never "resolved". Each verdict is one of `better`, `worse`, `same`, `not_comparable` or
   `not_measured`.
5. **Registry data, not branches.** Dimensions, rules, analyzers, sources and sinks, guard
   names and metric thresholds are registry rows. A new check is a row plus an executor; it
   never adds a branch to the engine.
6. **One flow.** The delta shows at the end of the run in the chat that ran it, in the ONE
   run surface. It is not a separate "analysis" product with its own entry point.

## 3. What exists today

Facts checked on 2026-11-06. `BM` is `builderforce-memory/packages/memory/src/knowledge`, `AT` is
`Builderforce.ai/packages/agent-tools/src`, `VS` is `Builderforce.ai/clients/vscode/src` and
`KGV` is `Builderforce.ai/packages/knowledge-graph-view/src`.

### 3.1 Already incremental and deterministic

| Capability | Where | State |
|---|---|---|
| Review stages: plan → per changed file (read, parse, extract, judge, write, markStale) → analyzers → compare → manifest and digest | `BM/review.ts:5-11` | Built |
| Plan is a hash diff. An unchanged file is never read. | `BM/plan.ts:4-5` | Built. **Cost:** planning took 329 s for 16,722 files (PRD 38) because every file is hashed. |
| Extract cache keyed by content hash plus `extractorVersion` (`EXTRACTOR_VERSION = 2`). A version bump marks every file "owed". | `BM/extractFile.ts:50-52`, `BM/sources.ts:23`, `BM/owedFiles.ts:61` | Built |
| Judge skip: a judged section is skipped when its text hash is unchanged | `BM/review.ts:200` | Built |
| Review digest is sha256 of `{rootId, packs, files}` | `BM/review.ts:287` | Built |
| Only judge and compare call a model. The code pack has no judgement. | `BM/judge.ts:2`, `AT/knowledge/codePack.ts:14` | Built |
| Code-pack analyzers: dependency-cruiser 16.10.4, jscpd 4.0.5, knip 5.30.0 and the repo-map file graph | `AT/codeAnalysisTool.ts:9-11`, `AT/knowledge/codeAnalyzers.ts:29-38` | Built. They are **downloaded via `npm exec --yes` on first use**: the command strings are in `ANALYZERS` at `codeAnalysisTool.ts:9-11`, and dependency-cruiser and knip also pin `typescript@5.6.3`. They run whole-repo, and a failure is swallowed (`BM/review.ts:242-257`). |
| Findings: cycle, clone-group, near-duplicate, partition-violation, unpartitioned, stale, plus unused-file, unused-export and unused-dependency for code | `BM/findings.ts:78-146`, `AT/knowledge/codeFindings.ts:28-52` | Built. **`unusedCodeRule` emits one repo-wide finding per kind**, with an id hashed over every file that has unused items, so it has no per-item identity (fixed in C3). |
| Five code layers (entry, presentation, application, domain, infrastructure) | `AT/knowledge/codeLayers.ts:1-26` | Built |
| Per-file badges: cyclomatic complexity, routes, patterns. These are regex over masked source. | `AT/knowledge/codeComplexity.ts`, `codeRoutes.ts`, `codePatterns.ts` | Built |
| Root signals: coverage (reads lcov or istanbul only), CODEOWNERS, entry points, churn and history | `AT/knowledge/codeCoverage.ts`, `codeOwners.ts`, `codeEntryPoints.ts`, `codeRootSignals.ts` | Built |
| Symbol source: tree-sitter in the VSIX. The regex extractor is used elsewhere. | `VS/knowledge/knowledgeService.ts:152`, `AT/node-tree-sitter.ts`, `AT/knowledge/codePack.ts:51` | Built |
| Compare: a set difference on `finding.id` plus per-kind counts. A `comparable === false` baseline hides added and resolved. | `KGV/graphModel.ts:123-140`, `KGV/ComparePanel.tsx:31-38,65`, `KGV/types.ts:160-168` | Built. **The VSIX baseline never sets `comparable`**, and it returns `null` when unlinked (`VS/knowledge/knowledgeBridge.ts:195-203`). |
| Analysis comparability (scope, repo, branch and tool versions match) | `AT/codeAnalysis.ts:60-70` | Built. Web only (`frontend/src/lib/knowledge/codeAnalysisSource.ts:65`). |

### 3.2 Already offline-capable

| Capability | Where |
|---|---|
| Activation needs no sign-in. The policy defaults to `local-only`, and the host runs `network:"denied"`. | `VS/platformPolicy.ts:19-20`, `VS/extension.ts:170` |
| An unlinked review uses a local store, `.builderforce/knowledge/<root>.json` plus a manifest | `VS/knowledge/knowledgeStores.ts:2-15,40-43`, `VS/knowledge/knowledgeService.ts:218-238` |
| The visualizer opens signed out on a `localSession`, and a local board never calls the gateway | `VS/workspaceSession.ts:62,106-113`, `webview/src/canvas/useBoardAuth.ts:15`, `webview/src/signedOutGate.ts:21-27` |
| Docs judgement runs on a local model when no client is available | `VS/knowledge/knowledgeJudgement.ts:28-43` |

### 3.3 Already recorded for runs

| Capability | Where | State |
|---|---|---|
| Run baseline: per repo, root, URL, branch, `baseCommit`, and a fingerprint per *dirty* file (sha256 up to 256 KB, else size plus mtime) | `VS/runChangeBaseline.ts:20-41` | Live |
| Immutable `changeset:<runId>:<repoKey>` with per-file `{path, beforeHash, afterHash, attribution, status}`. Hashes only, no content. | `VS/runChangeSets.ts:1-30,56-65` | Live, wrapped around every host start (`VS/brainRunHostPorts.ts:381-401`) |
| Lifecycle `changeset-lifecycle:<runId>` (baseline hash, finalization) | `VS/changeSetLifecycle.ts:21-40` | Live |
| **Readers of `changeset:` records** | none | **Nothing reads them.** |

### 3.4 Security and other analysis already present

| Capability | Where |
|---|---|
| osv-scanner or npm/pnpm audit as a PreFetch executor | `AT/prefetch/tools.ts:35,48-62`, `AT/prefetch/checkExecutors.ts:77-104` |
| gitleaks secrets scan (redacted) as a PreFetch executor | `AT/prefetch/checkExecutors.ts:120-136` |
| Server OSV-shaped advisory feed; GitHub CodeQL and Dependabot alerts | `api/src/application/security/advisoryFeed.ts:83-180`, `githubAlerts.ts` |
| SARIF 2.1 **ingest** (`sarifToFindings`, CodeQL and Semgrep security-severity), fingerprint dedupe | `api/src/domain/security/scanReportParsers.ts:13-17,98-165`, `api/migrations/1132_vulnerability_findings_fingerprint.sql` |
| Taint analysis, attack-surface inventory, mutation testing, SARIF export | **None** |

### 3.5 Duplicated "understanding" paths (consolidation targets)

| Path | What it does | Problem |
|---|---|---|
| `VS/codebaseScan.ts` | Walks the workspace and writes `.builderforce/{context.yaml, project-map.md, architecture.md, README.md, memory/, scan.json}`, plus one `routeComplete` overview (`:278-294`) | One `versionToken` over the whole workspace (`:155-165`), so any edit invalidates everything. The LLM overview is the only non-deterministic part. `maybeScan` returns early twice: when no local or specific model is available (`VS/extension.ts:1686-1690`), and when there is no key and the route needs sign-in (`:1691`). |
| `packages/repo-map` | Regex facts plus a file graph, serialized for the R2 cache | A second extractor beside the knowledge code pack. It runs in Workers, where there is no parser. |
| Knowledge review (code pack) | The canonical, incremental pipeline in §3.1 | Starts only from `/review` (`VS/knowledge/knowledgeCommands.ts:86`) |

### 3.6 Signed-out gaps found

| Gap | Where |
|---|---|
| A selected project persisted while signed out makes every knowledge call throw `NOT_SIGNED_IN`. "Linked" means a project was selected; it does not mean signed in. | `VS/knowledge/knowledgeService.ts:64-75`, `VS/projectState.ts:20-21` |
| Analyzers download from npm on first use and fail with no network | `AT/codeAnalysisTool.ts:9-11` |
| The `work`, `inbox`, `health` and `evermind` views are hidden until sign-in | `clients/vscode/package.json:100,105,114,120` |
| The workspace scan is skipped with no model, and again with no key | `VS/extension.ts:1686-1691` |
| `installRunChangeSets.ts` (and its `installRunChangeSets.test.ts`) and `runChangeSetRecorder.ts` have no production references. Their "not referenced" comments are stale against `brainRunHostPorts`. | `VS/installRunChangeSets.ts:4-5`, `VS/runChangeSetRecorder.ts:15-16` |

### 3.7 Primitives this PRD must reuse (found in review)

| Primitive | Where | Reused by |
|---|---|---|
| SQLite system of record (G03): runtime `node:sqlite` load, `busy_timeout`, refuses corrupt files | `VS/localRecordTransaction.ts`; `agent-runtime/src/memory/sqlite.ts` (`requireNodeSqlite`) | B4 fact-store adapter |
| Durable file write | `packages/local-first/src/durableWrite.ts:38` (`writeDurably`) | B4 objects, C1 pre-images |
| Classical ML catalog: logistic, linear, kNN, EWMA, robust-z, anomaly composite, isolation forest, GBM, naive Bayes, k-means | `builderforce-memory/packages/memory-engine/src/ml/classical/*` | Part D (D13) |
| ML task catalog, including a run anomaly task | `builderforce-memory/packages/memory-engine/src/ml/tasks/{run_anomaly,local_success,experience}.ts` | D2.5, D5, D14 |
| Other copies of model maths to migrate | `packages/difficulty-router/src/head.ts` (logistic head), `packages/pipeline-route/src/score.ts`, `wilsonInterval` in `api/src/domain/replay/prescriptions/impact.ts`, the seeded layout RNG in `packages/knowledge-graph-view` `layout3d.ts`, `packages/prefetch/src/calibrate.ts`, the learned-routing sampler (`exploration.ts`) | D13 |
| Default vector space: bge-m3, 1024 dimensions, with a resumable keyset backfill sweep | `api/migrations/1256_memory_embedding_1024.sql`, `MEMORY_VECTOR_SPACES` (`memoryEmbeddingBackfill.ts:14-18`) | C14 |
| Reporting line: `dev_teams.manager_id` → contributors | `api/src/infrastructure/database/schema/canvas.ts:850` | D14 |

---

## Part A — Offline VSIX

### A1. Capability states, not a login gate

The extension's capabilities are a product of the platform policy (`packages/local-first`
capability matrix, G01/G21) and what is installed locally:

| Capability | Signed out, offline | Signed in, sync off | Signed in, sync on |
|---|---|---|---|
| Understand folder (L0–L3, §B6) | ✔ | ✔ | ✔ |
| Visualizer, graph, findings, compare | ✔ (local board) | ✔ | ✔ (+ server board). The view always draws from the local projection (A7) |
| Agent runs | ✔ with a local model (bfi-node, WebLLM, Ollama) or a direct BYO provider key; else "set up a model" | ✔ | ✔ (+ gateway inference if granted) |
| Run delta (static tier) | ✔ | ✔ | ✔ (+ synced to account) |
| LLM narrative over a delta, docs judgement | Local model only, else omitted with a visible reason | Same | Gateway allowed if granted |
| Tickets, inbox, cloud runs, team features | Hidden behind a capability notice, never a 401 | Local records (G05) | ✔ |

**Rule.** Every view and command decides its own visibility from the capability matrix
through ONE hook (`useCapability(id)` in webviews, `capabilityContextKeys` for
`package.json` `when` clauses). `builderforce.signedIn` stays only for account-only
surfaces. `health` and `evermind` move to capability keys (see Open decisions §12.4).

### A2. Linked means signed in and granted

`knowledgeService` treats a workspace as linked only when **all three** hold:
- a project is selected;
- a session exists;
- the `synchronize` capability is granted.

Otherwise it uses the local store. A persisted project selection made while signed out
becomes a **pending binding**. It binds through the existing destination-binding path (G10)
on the next granted sync, and it never throws `NOT_SIGNED_IN` into a review.

### A3. Analyzers ship with the VSIX

dependency-cruiser, jscpd and knip move from `npm exec --yes` to **pinned, packaged
dependencies** of the VSIX, run in-process or as bundled CLIs from the extension's install
directory. The bundle includes the `typescript@5.6.3` that dependency-cruiser and knip pin.
Versions stay pinned in one place, `codeAnalysisTool.ts`, and are reported in each analysis
record so comparability (C9) can check them. WS1 measures the VSIX size before and after and
records it in the release notes.

Bundling was decided on 2026-11-06 (§12.1). If a bundled analyzer fails to start:
- that analyzer's findings are `not_measured`, with the reason `analyzer-unavailable`;
- a missing analyzer is never shown as zero findings.

### A4. The scan never needs a key

`maybeScan` always runs the deterministic part. Both early returns go: the no-model one at
`extension.ts:1686-1690` and the no-key one at `:1691`. Only the optional narrative needs a
model route (§B9). With no route, the overview section is omitted and marked
`overview: { status: 'skipped', reason: 'no-model-route' }`.

### A5. The visualizer's network touches are all optional

The open path is: `workspaceCanvasSession` → (signed in) `getTenantJwt`,
`listCreationSessions` → `buildWorkspaceInit` → `getCurrentUserId` (`/api/vscode/me`),
`resolveModelRoute`, then `fetchLimbic`.

Each of these is already budgeted and degrades. Required behaviour:
- With `network: denied`, **none of them is attempted**. The capability check comes first;
  timing out is not an acceptable way to degrade.
- `getCurrentUserId` results are cached in `globalState` with the session's key id, so a
  signed-in person who goes offline keeps their personality block.
- `fetchLimbic` reads the local limbic state when the platform is denied.

### A7. The visualizer draws from the local projection, linked or not

**Why.** On 2026-11-07 a linked workspace (`agentic`, VS Code 2026.10.133) drew a broken map:
- one line;
- about 45 stations named after single files;
- every channel "Not set up".

The cause was that the production API had not deployed the outline release. The view drew whatever `GET /knowledge-graph` returned: a cut of 119 of 3,038 files, with no per-file badges. The status strip read "0 here · 2,945 on the server", because a linked review keeps no local snapshot (PRD 38, "Linked projects"). What the person sees must never depend on the server's version, its reachability or its rate limits.

**Rule.**
1. **The local store is the source of truth for drawing, in every capability state.**
   - A linked review writes the local store first, then syncs to the server as a replica. The sync uses the batched path in PRD 38 › "Do" 2–3.
   - A 429, a 413 or the server being unreachable delays the sync. It never ends the review and never changes the map.
2. **The host computes everything the view draws from the local projection:**
   - the cut;
   - the outline (`outlineOf`, already pure in builderforce-memory);
   - the area roll-up;
   - badges, findings and the data-coverage facts.
   
   The VSIX ships the memory version that computes them, so a view upgrade never waits for an API deploy.
3. **`GET /knowledge-graph` serves surfaces with no local tree:** the web app, a teammate's machine, and portable packs (PRD 40). The VS Code view calls it only to fill the Sync drawer's server column and to seed a workspace once (rule 5).
4. **Sync compares two real counts.**
   - The strip never reads "Synced" when the local side has zero files.
   - A workspace with no local projection says "Not reviewed on this machine" and offers **Review**, or **Use the server's copy** when online.
5. **Migration.** Existing linked workspaces have no local snapshot. On first open after this ships:
   - **If online:** pull the server's full graph once, through the pack import path (PRD 40), into the local store, then re-review incrementally (B2).
   - **If offline:** run the local review (L0–L3, B6).
   
   Neither path ever falls back to drawing the server cut.
6. **Diagnostics.** The diagnostics name the map source, for example `map source: local projection (L2 complete, L3 measuring)`, and the data coverage per channel. A server-sourced map is a defect that the diagnostics flag, not a mode.

**Accept.**
- On a linked workspace of about 2,000 files, the map with network denied equals the map online: the same stations, lines and badge coverage, compared by a digest of the drawn model.
- With the API pinned to an older build, the map is unchanged.
- A review that hits a 429 on every sync request finishes, and the map opens.

**Design (end state, 2026-11-07).** The code map was traced on 2026-11-07. The root cause is a single fork: `selectKnowledgeStore` (`clients/vscode/src/knowledge/knowledgeStores.ts`) returns the server store **or** the local store, never both. `loadGraph` and `rootSyncStatus` branch on the same `linkedKnowledgeClient`.

1. **`replicatedKnowledgeStore(local, replica, queue)`** lives in `packages/agent-tools/src/knowledge/`. It replaces the fork. Every workspace review uses it, linked or not; unlinked passes no replica.
   - Reads and writes go to `local` (memory's `localSnapshotStore`, `batched()` as today).
   - Every write is also appended to a **replica queue**. The queue is persisted beside the snapshot as `.builderforce/knowledge/<root>.replica.json`, holding ops and content hashes, never file bodies twice.
   - A **replica pump** drains the queue:
     - It uses the existing batched client calls: `write` in chunks of 500 rows, the bulk extracted routes, and `putAnalysis`.
     - It retries 429 with `Retry-After` and backoff, with no cap on attempts; the queue simply waits.
     - It drops 413 as `skipped`, as today.
   - Pump failures never reach the review. They surface as the replica state on the Sync drawer: `queued`, `sending`, `waiting (429, retry in Ns)` or `failed (reason)`.
   - `uploadLocalSnapshot` / `pushSnapshot` become the pump's first-sync case. There is one upload path, not two.
2. **Drawing.**
   - `loadGraph` always builds from the local projection (`buildStoredGraph`, the same `buildCodeGraph` with cut and outline as memory computes them, bundled in the VSIX). `client.graph` is called only by the Sync drawer's server column.
   - With no local projection, the view shows **Not reviewed on this machine**, with the actions **Review** and, when online, **Use the server's copy**.
3. **Use the server's copy** is not a second import path. It is a local review run with a **server read-through**: before extracting a file, the extractor asks `preloadExtracted` (the bulk route) for the file's content hash and uses the server's `Extracted` when it is there. Unchanged files therefore cost one bulk read and no model call. Offline, the same review runs without the read-through.
4. **Sync status.**
   - Local counts come from the local projection (`graphCounts` of the local graph). Server counts come from `client.graph` when it is reachable.
   - The replica state is a third row.
5. **Diagnostics.** These print `map source: local projection` and the replica state. A `server` map source no longer exists in the editor.

### A8. A review is a run you can watch, and it runs in parallel

**Why.** On 2026-11-07 the operator pressed **Re-review this folder** on `agentic` (3,581 files). The view showed only a pill reading "Updating…". The code reasons:
- **Work is sequential.** Only file read and extract run 8 wide (`prefetchOrdered`, `DEFAULT_REVIEW_CONCURRENCY = 8`). Judging and writing go one file at a time on the extension host's thread.
- **One failure ends everything.** One file whose extraction throws ends the whole run.
- **Nothing to drill into.** There is no run record, so a person cannot tell a slow run from a stuck one.

**Rule.**
1. **A review is a run with an id, a record and a view.**
   - `ReviewRun` holds:
     - `id`, `root`, `kind` (`review` | `re-review` | `seed`), `startedAt` and `endedAt`;
     - `phases[]`, each with `phase`, `startedAt`, `endedAt`, `done` and `total`;
     - `lanes[]`, one per worker: `id`, the current `path`, `done` and `busyMs`;
     - `steps`: a ring of the last 200 `{ path, phase, ms, outcome: ok | cached | skipped | failed, reason? }`;
     - `failures[]`, with path, phase and reason, all kept;
     - `replica`, the queue state from A7;
     - `outcome`, plus the `ReviewReport`.
   - The host persists the last 20 runs per root to `.builderforce/knowledge/runs/<runId>.json`.
   - Live updates ride the existing `KNOWLEDGE_EVENT` stream as `run` events, throttled to at most 10 per second.
2. **The view.**
   - **Review**, **Re-review**, the sync pill while reviewing, and the "Updating…" state all open the **Run panel**. It is a `SlideOutPanel`, not a modal. It shows:
     - a phase timeline (plan → extract → judge → write → index → done), with the done/total and rate per phase and an ETA from the measured rate;
     - one live lane per worker, showing the file it is on;
     - a step feed that can be filtered to failures;
     - the failures, each with **Retry**;
     - the replica state;
     - **Stop**.
   - **History** lists the past runs per root. Opening one shows the same panel, frozen.
   - Text is localized in all five catalogs. The panel works in both themes and at 360 px.
3. **Parallelism.**
   - **Extraction runs in a `worker_threads` pool** in the extension host. The pool is `min(availableParallelism() - 1, 8)` workers, at least 1. Extraction is CPU-bound parsing, and memory's extractors are pure.
   - The pool is a port in memory: `ReviewArgs.extractPool?: (job) => Promise<Extracted>`. The default runs in-thread, so the web and tests are unchanged.
   - **Judging runs N-wide.** N defaults to 4. The provider's rate-limit headroom is enforced by ONE shared model-call limiter across all files (default 6 calls in flight). It halves on a rate limit and grows by 1 after 20 successes (AIMD), so a width of 4 never multiplies provider load.
   - **One symbol rule on both paths.** An index hit uses the editor's symbol index (the main thread puts those symbols in the job); an index miss uses the regex extractor on both paths (memory's `symbolsOf` is synchronous and tree-sitter loads asynchronously) — so a pool never changes what is stored.
   - **A pool that cannot start falls back to in-thread** for the rest of the session, and the panel says so. A machine with 2 cores or fewer runs no pool.
   - **Writes stay ordered.** A single writer consumes results in plan order, so the snapshot stays deterministic (B-part guarantee: equal input gives equal bytes).
   - Same-hash files stay serialized (`hashTail`).
4. **No single failure ends a run.**
   - An extraction that throws becomes a `failed` step and a `failures[]` entry. Its prior knowledge and manifest hash are kept, as read errors are today, and it is retried on the next review or by **Retry**. Retry marks the failed files owed, then runs the normal plan → estimate → confirm flow. It is offered only on a root's latest run, and never while that root is under review.
   - Only abort, or a store write failure on the **local** store, ends a run.
5. **Cancellation.** **Stop** aborts all lanes. In-flight worker jobs are terminated, completed work is kept, and the run is recorded as `stopped`.

**Accept.**
- **Re-review on 3,581 files.**
  - The Run panel opens within 200 ms.
  - Lanes show more than one file in flight on a machine with 4 or more cores.
  - The extract phase finishes at least 2.5× faster than the single-thread baseline. This is measured by `ReviewReport.durationMs` per phase on the fixture repo in CI.
- **A poisoned fixture file** (an extractor that throws) produces one `failed` step, and the run finishes `done`.
- **The snapshot bytes** after a parallel review equal those after a sequential one (`concurrency: 1`).
- **Stop** during extract ends the run as `stopped` within 1 s, and a follow-up review resumes from the kept work.

### A6. Packaged acceptance (extends G27)

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

---

§A9–§A11 shipped 2026-11-07, see DONE.md.

## Part B — Incremental, deterministic understanding

### B1. Model: a content-addressed fact graph with early cutoff

Understanding is a **build system over facts**, in the sense of *Build Systems à la Carte*
(Mokhov, Mitchell, Peyton Jones 2018) and Salsa/rustc red-green queries:

- **Inputs** are files, identified by content hash.
- **Per-file queries** run as `extract(fileHash, extractorVersion) → FileFacts`. They are
  pure and cached by key. This already exists (§3.1).
- **Cross-file queries** derive facts such as `resolveImports`, `fileGraph`, `layers` and
  `findings`. Their inputs are the *fact hashes* of the files they read, not the file hashes.
- **Early cutoff.** If an edit changes a file's bytes but not its *structural* facts hash, no
  structural cross-file query reruns. A comment or whitespace edit is the typical case.
  - `FileFacts` is split into fact kinds, each with its own hash:
    - `structure`: symbols, imports, exports;
    - `body`: calls, complexity, `testFacts`, def-use and loop facts;
    - `content`: the normalized bytes themselves.
  - A rule's `reads` names the kinds it consumes. A body edit still reruns `body`-reading rules
    such as `io-in-loop` and taint.
  - Rules that need raw text declare `reads: ['content']`. Examples are gitleaks over hunks,
    TODO counts and snippet-hash anchors. Cutoff never applies to them.
- **Verifying traces.** Each derived result stores the hashes of the inputs it read. It is
  valid while those hashes are current. No dirty flags propagate through the store, so the
  store can be thrown away and rebuilt to the same bytes.

### B2. Change detection: Merkle tree plus a stat prefilter

Planning today hashes every file (329 s for 16.7k files). That cost goes:

0. **Content identity is EOL-normalized.**
   - The content hash is sha256 over the file's bytes with CRLF and lone CR converted to LF,
     for files detected as text. Binary files are hashed raw.
   - So a Windows `core.autocrlf` checkout and a Linux checkout of the same commit hash
     identically. The cross-OS digest, pre-image hashes and the oracle all rely on this.
   - The normalization rule is recorded in the extractor state (`contentHashRule`; an absent record is the baseline `eol-lf@1`), separate from `EXTRACTOR_VERSION`. It never owes files on its own: adopting it moves the hash of every CRLF file, so those re-extract through the content change, and LF files keep their hash.
1. **Stat manifest.** `(path, size, mtimeNs, ino/fileId)` per file, persisted with the plan
   manifest. Stats are read with `bigint: true`, because Windows file ids and nanosecond
   mtimes lose precision as JS numbers. A file whose stat tuple is unchanged reuses its stored
   hash without being read.
2. **Racy-file rule** (from git's index): if a file's `mtime` is within 2 s of the manifest's
   write time, it is re-hashed on the next plan, whatever its stat says.
3. **Git fast path.** In a git repo, `git ls-files -s` plus `git status --porcelain=v2 -z`
   identify tracked files that are clean against the index.
   - A blob id (`git:<sha1>`) is stored as a **lookup hint** beside the sha256 content hash,
     so a clean file at a blob the cache already knows reuses its facts without being read.
   - It is never an identity. Under autocrlf, working-tree bytes differ from blob bytes, so
     facts are always keyed by the normalized sha256 from step 0.
4. **Directory Merkle hashes.** A directory's hash is sha256 over its sorted
   `(name, kind, childHash)`. An unchanged directory hash skips the whole subtree, and two
   roots compare in O(changed).
5. **Watcher plus reconcile.** A `FileSystemWatcher` feeds a coalescing queue (100 ms debounce,
   path dedupe). Watchers drop events, so activation and every window refocus run a
   **reconciling plan** (steps 1–4) that catches whatever was missed.

**Target:** a warm plan of the `agentic` tree in under 3 s; a cold plan in git under 30 s.

**Roots.**
- **Multi-root workspaces:** each workspace folder is its own `rootId` with its own store
  under that folder's `.builderforce/cache/`.
- **Monorepos:** one root per workspace folder, not per package.
- **Large roots:** a root over `MAX_LISTED_FILES` (20,000, `fsDirectorySource.ts:65`) is
  planned in full by the B2 stat path, because the cap exists for the old hash-every-file
  plan. The cap moves to L3 analyzer scope, where truncation marks the analysis
  `not_comparable` (C9).

### B3. Extraction: one extractor per language, tree-sitter in Node hosts

- The VSIX, on-prem agent and cloud container use **tree-sitter** (`AT/node-tree-sitter.ts`)
  for symbols, imports, exports, call sites, entry points, routes, complexity and
  security-relevant call facts (§C5).
- Complexity, routes and patterns move from regex to tree-sitter queries in the same pass.
  The regex versions stay only as the Worker fallback (`repo-map`).
- Worker hosts keep the regex extractor. A fact set records `extractor: 'tree-sitter@<v>' |
  'regex@<v>'`, and the two never mix in one comparison (C9).
- **Incremental parse.** Within an editing session, the extension keeps tree-sitter trees for
  open documents and applies `tree.edit()` on each change, so re-extracting a typed-in file
  costs only the edited region.
- **Grammar versions.** `EXTRACTOR_VERSION` is a composite: the extractor code version plus
  each tree-sitter grammar's package version and the EOL rule. A grammar bump re-extracts only
  files of that language.
- **Threading.** Parsing in the background worker thread uses the WASM build of tree-sitter
  (`web-tree-sitter`), because native addons are not safe to load per worker. The main thread
  keeps the native addon for open-document incremental parses. The two builds of one grammar
  version must produce identical facts; the B8 oracle checks this.
- `FileFacts` gains the following fields. Every array is sorted and every field is
  canonical-serialized:
  - `exports` (name, kind, signature hash);
  - `calls` (callee text, enclosing symbol);
  - `entryPoints` (§C5.1);
  - `capabilityImports` (§C5.3);
  - `testFacts` (§C8.2).

`EXTRACTOR_VERSION` bumps to 3. The existing "owed" mechanism re-extracts in the background.

### B4. Fact store: content-addressed segments

The single snapshot JSON (`.builderforce/knowledge/<root>.json`) is rewritten on flush, which
does not suit continuous indexing.

**Port and adapter.**
- memory `/knowledge` is Worker-safe and pure ("no I/O"), so it gains only a
  **`FactStorePort`**: `getObject`, `putObject`, `manifest` read and write in one transaction,
  `derived` get and put, and `canonicalDump()`.
- The Node adapter lives in the VSIX and the on-prem host, **on the existing G03 SQLite store**
  (`VS/localRecordTransaction.ts`, `requireNodeSqlite`). WS2 wires G03 rather than opening a
  second SQLite path.
- The Worker host keeps its R2 and KV adapter behind the same port.
- Every `/knowledge` contract change ships as a builderforce-memory publish plus a pin bump in
  the same workstream.

On disk, the store becomes:

```
<workspace>/.builderforce/cache/knowledge/<rootId>/
  objects/<aa>/<sha256>.json     # FileFacts and analyzer outputs, immutable, content-addressed
  index.sqlite                   # manifest (path → {stat, sha256, gitBlob?, factsHash}) + derived
                                 #   query results and their input-hash traces, in one transactional file
  snapshot.json                  # the PRD 38 KnowledgeSnapshot, now a projection rebuilt from the above
```

- **Deviation (2026-11-08, G03 as built).** There is no `objects/` directory and no `snapshot.json`.
  The extract bodies live in an `extracted(hash PRIMARY KEY, json)` table in `index.sqlite`, loaded
  lazily per hash, so nothing needs a durable file writer, a sweep or a reference table. The
  `KnowledgeSnapshot` projection is memory's `canonicalDump(store)`, read on demand (it is not
  kept on disk). The file is one per workspace folder, not one per root: rows carry their root id.
- Object writes use the existing `writeDurably` (`packages/local-first/src/durableWrite.ts:38`).
  (Superseded by the deviation above: there are no object files.)
- **Migration.** The `.builderforce/knowledge/<stem>.*` layout is shared with the knowledge
  index and the on-prem host (`knowledgeStores.ts:24-25`). WS2 migrates all three readers:
  - On first open, the old snapshot is imported into the new store and renamed `*.migrated`.
  - The link-upload path (`uploadLocalSnapshot`) reads the projection from the new store.
- Objects are write-once, so a crash leaves at worst an unreferenced object, which a sweep
  removes.
- The `KnowledgeSnapshot` and PRD 40 portable pack formats do not change. Both are
  projections of the store.
- **Location** (decided 2026-11-06): the repo directory, `.builderforce/cache/`.
  - VS Code's `storageUri` gives no I/O speed advantage: both are the same local disk.
  - The cost of a repo location is **watcher and scanner load**. Thousands of object files
    inside the workspace would otherwise be seen by:
    - VS Code's file watcher and search;
    - git status;
    - TS server and ESLint watchers;
    - our own `FileSystemWatcher`, which would create a feedback loop.
  - So the extension, on first index:
    - writes `.builderforce/cache/.gitignore` containing `*`, the way `.pytest_cache` does.
      The repo's own `.gitignore` is never touched;
    - contributes `configurationDefaults` for `files.watcherExclude` and `search.exclude` on
      `**/.builderforce/cache/**`;
    - has its own watcher ignore the path.
  - The benefit: the cache survives moving or renaming the folder and is easy to inspect or
    delete. `.builderforce/` outside `cache/` keeps the human-facing outputs (B9).
- **SQLite from the start** (decided 2026-11-06). `engines.vscode` rises to `^1.101.0`, which
  closes the G03 engine-floor blocker. `index.sqlite` is opened through the G03 store, with
  WAL and its busy timeout instead of the 30-second lock steal. `objects/` stays file-based.
- **Sweeps.** A generation-based mark-and-sweep removes unreferenced objects. It runs when
  idle, and only for objects not referenced by the current manifest generation, any
  generation pinned by an open run (C1) or any delta younger than its retention.
- This is a storage format, so its review goes to an Opus subagent.

### B5. Derived knowledge as rules (Datalog-style)

`findings.ts` and `codeFindings.ts` are already rules over facts. They are formalized as:

```ts
interface FactRule {
  id: string;                       // 'cycle', 'partition-violation', 'unused-export', 'io-in-loop', …
  version: number;
  reads: FactKind[];                // which fact kinds it consumes — the dependency trace
  scope: 'file' | 'neighbourhood' | 'global';
  derive(input: RuleInput): Finding[];   // pure; output sorted by findingId
}
```

- **`file` rules** recompute only for changed files.
- **`neighbourhood` rules** recompute for the changed files plus their graph neighbours up to
  the rule's declared `hops` (default 1, maximum 2, matching the C2 impact set).
  - Entry-point rules such as "a route lost its guard" declare `hops: 2` and also read the
    route's **guard chain**: router, middleware and wrapper files resolved from the route
    registration, which may be further away than 2 import hops.
- **`global` rules** (cycles, unused exports) recompute when any input fact of their kind
  changed. A cycle is found with Tarjan's strongly-connected-components algorithm over the
  sorted node order, so the result is deterministic.
- A rule's output is cached by `(ruleId, version, hash of its read facts)`. A global rule with
  unchanged inputs costs only that hash.

Order-independent fixpoints (semi-naive evaluation) are the reference semantics. A rule is
correct if the full recompute equals the incremental result (B8).

### B6. Levels: something useful in under a second

| Level | Content | Source | Budget on the `agentic` tree, warm |
|---|---|---|---|
| L0 | Tree, manifests, languages, sizes | Plan (B2) | < 1 s |
| L1 | Per-file facts (symbols, imports, exports, entry points) | B3 | open and visible files < 1 s; whole tree in the background |
| L2 | File and symbol graph, layers, partitions | B5 neighbourhood and global rules | < 5 s after L1 settles |
| L3 | Analyzer findings (deps, clones, unused), metrics, churn and coverage signals | Analyzers (B7) | async; minutes on a cold run |
| L4 | Docs judgement, narrative overview | Model (optional) | only with a model route; cached by input hash |

The visualizer and the agent context pack read whatever level is complete and show the
level, for example a "measuring…" state on L3 tiles. L0–L3 are deterministic and need no
model.

**Scheduling** is a priority queue drained in idle time:
1. Files open in editors.
2. Visible files.
3. Files reachable from (1) within 2 import hops.
4. Recently changed files (`git log -n 200`).
5. Everything else.

- Budget: one worker thread, 50 ms slices, yielding when the person types.
- The work is cancelable, and it pauses when the window loses focus for more than 10 minutes.
- On battery, levels L3 and L4 wait until the device is charging or the person asks.
  - The extension host has no power API, so the host asks the OS through one small
    `powerSource` port, cached for 5 minutes:
    - Windows: `GetSystemPowerStatus`, via `powershell -NoProfile` querying
      `Win32_Battery`;
    - macOS: `pmset -g batt`;
    - Linux: `/sys/class/power_supply/*/online`.
  - If the source is unknown, L3 runs only when idle for 2 minutes or more.

### B7. Analyzers: whole-repo tools under incremental discipline

The three external analyzers are not incremental, so each gets a strategy:

| Analyzer | Strategy |
|---|---|
| dependency-cruiser | Replaced for the per-edit path by the B5 graph rules (cycles, layer violations). The tool runs at L3 to cross-check and is cached by `(tool@version, Merkle root of its input set)`. |
| jscpd | Run on the **changed files against the token index of the rest**. jscpd's store persists the token index between runs, keyed by file hash. A full run happens only on a version bump. |
| knip | Whole-program by nature. Run at L3, cached by Merkle root. Between runs, the B5 `unused-export` rule over export and import facts gives the incremental answer, and knip is the periodic oracle. |

**Failure is recorded, never swallowed.** An analyzer failure writes `{tool, version, status:
'failed', reason}` into the analysis record. Every finding kind that tool produces becomes
`not_measured` for that snapshot. This replaces the swallow at `BM/review.ts:242-257`.

### B8. Determinism rules

1. Paths are POSIX, normalized and NFC, then sorted bytewise. Every array in every artifact
   is sorted by a declared key.
2. Canonical JSON uses sorted keys. **Every number that enters an identity, digest or cache
   key is quantized first.**
   - Quantization means a fixed decimal step per field, serialized as an integer of that step.
   - This applies to PageRank and centrality, the blast-radius score, the Maintainability Index,
     every `MetricDelta` value and every statistic.
   - It follows the [knowledge index](../design/deterministic-knowledge-index.md) convention.
   - The step is declared in the field's schema.
3. Every cache key includes extractor, rule and tool versions. Wall-clock time and mtime never
   appear in an output. mtime is only a hint to skip hashing (B2).
4. Each computation runs against one manifest generation. A result built from mixed
   generations is discarded.
5. Community detection and layout use fixed seeds, and nodes are visited in sorted order.
   PageRank-style centrality uses power iteration with a fixed iteration cap and tolerance
   over sorted nodes.
6. **The oracle test.** For a fixture repo and random sequences of edits, renames and deletes
   (property-based, seeded), the **canonical dump** of the store must be byte-identical across:
   - the store after the incremental updates;
   - a from-scratch build;
   - a from-scratch build on a second OS in CI, with the fixture checked out with autocrlf on
     Windows.

   The dump (`FactStorePort.canonicalDump()`) is sorted canonical JSON of the manifest,
   derived rows and referenced objects. SQLite page layout, freelists and WAL never take part.
   Analyzer outputs are included.

   This test gates every workstream in Part B.

### B9. Consolidation: one understanding

Per the consolidation rule (extract and port the missing behaviour, then delete):

- **`codebaseScan.ts` becomes a projection of the fact store.** `project-map.md`,
  `architecture.md` and `context.yaml` render from L0–L2 facts. `scan.json` and its
  whole-workspace `versionToken` are deleted. The narrative overview is an L4 query cached by
  the hash of its input facts.
- Its existing consumers (`setGroundingSummary`, `afterWorkspaceScan` →
  `workspaceFactsSync`) read the projection. Their tests run unchanged as the parity oracle.
- **`repo-map` stays the Worker host's extractor.** Its `FileFacts` shape converges on the
  B3 shape so a Worker-built graph and a VSIX-built graph differ only in the `extractor` tag.
  The VSIX stops importing repo-map's regex extract.

### B10. Who reads it

| Reader | Reads |
|---|---|
| Visualizer and knowledge graph view | Snapshot projection; level status |
| Agent context pack / preSearch | L1–L2 facts. Deterministic answers ("where is X defined", "who calls X", "what layer") register as PREFETCH answer actions. |
| Knowledge index (cards) | `toCards` over the projection, as today |
| Run delta (Part C) | Facts and findings at two manifest generations |
| Portable packs (PRD 40) | Projection, unchanged |

---

## Part C — The run delta

### C1. The two sides of a run

- **Before** is the run's baseline: `baseCommit` plus the dirty files at start, as
  `runChangeBaseline` already records.
- **After** is the working tree at finalization.

To analyze *before*, the engine needs facts for every file the run touched, and for
whole-repo analyzers it needs a tree. Resolution, cheapest first:

1. **Extract cache by `beforeHash`.** The background indexer normally already holds facts for
   every file at its pre-run hash, so per-file rules need no content.
   - Today `beforeHash` is size plus mtime for files over 256 KB (`runChangeBaseline.ts:21`).
     The baseline switches to the B2 normalized sha256 for every file, taken from the stat
     manifest without re-reading unchanged files, so this step can hit for large files too.
2. **Git.** For files clean at baseline, `git show <baseCommit>:<path>`.
3. **Baseline pre-images.** At run start, the baseline captures the *bytes* of every file
   dirty at that moment into the content-addressed store (`objects/`).
   - Today the baseline only fingerprints them (`runChangeBaseline.ts:20-41`), so their
     content is lost once the run writes them.
   - Capture limit: 1 MB per file and 50 MB per run. Above that, the file is
     `not_comparable` with the reason `preimage-too-large`.
4. **Before-tree materialization** for whole-repo analyzers. The engine writes the before
   tree into a temp directory: `git archive <baseCommit>` plus the dirty pre-images
   overlaid. This is a plain export, not a git worktree.
   - It is done only when an L3 analyzer has no cached result at the baseline Merkle root.
   - The analyzer runs with a time budget. On a miss, its findings are `not_comparable`.

Files written by shell commands (formatters, codegen) are covered, because resolution does
not depend on intercepting writes.

**Non-git workspaces.** Steps 1 and 3 still work, provided pre-images are captured for every
file in the run's working set. In a non-git root, the baseline captures the whole working
set, up to the same caps, and the rest becomes `not_comparable`.

**Edge cases.**

| Case | Handling |
|---|---|
| Untracked files at baseline | Treated as dirty, so a pre-image is captured |
| Ignored files | Outside the working set. If the run touched one, it is listed as `changed-ignored` and its findings are `not_comparable`. |
| Submodules | Opaque: only the commit-pointer change is reported (`submodule-moved`, info) |
| LFS pointers | Compared as pointers; content is not fetched |
| Agent ran `git checkout`, `rebase` or `commit` mid-run | Before stays pinned to `baseCommit` plus pre-images. After is the working tree at finalization. The run's own commits are part of after. A `HEAD` that moved to an unrelated branch makes the whole delta `not_comparable` (`head-switched`). |
| Concurrent human edits or parallel runs on the same tree | Only files whose change-set `attribution` is `run-authored` or `run-modified-existing` enter the delta. Others are listed as "changed outside this run" and excluded from verdicts. |

**Renames.** One in-house matcher runs everywhere, git or not, so the digest never depends on
the git version or `diff.renameLimit`:
1. Exact normalized-hash equality.
2. Otherwise a token-set Jaccard of at least 0.5 over normalized tokens.
3. Candidate pairs are matched greedily by descending similarity, then by ascending path.

### C2. Impact set

The impact set is the changed files, plus their reverse dependents up to 2 hops in the
file graph, plus the entry points that reach a changed symbol. Neighbourhood rules and the
blast radius (C10) are computed over it. Global rules and analyzers run on the whole tree,
but their output is filtered to findings that touch the impact set, or that are introduced or
resolved anywhere.

### C3. Finding identity v2 and lineage

Today `findingId = kind + ":" + hash(sorted refs)` (`BM/findings.ts:29-31`), so a clone group
that gains a member reads as one resolved finding plus one introduced finding. The fix has
two parts.

**Stable anchor fingerprints** follow SARIF `partialFingerprints`:

```ts
interface FindingIdentity {
  id: string;            // unchanged: exact identity (kind + all refs) — used for set membership
  anchor: string;        // kind + rule version + PRIMARY anchor (enclosing symbol path, or route key,
                         //   or package name) + normalized-snippet hash; NO line numbers, NO member set
  members: string[];     // sorted refs (files/symbols) — for lineage similarity
}
```

**Lineage matching** is deterministic:
1. Exact `id` match: `persisting`.
2. Same `anchor`: `changed`, with a sub-kind of `grew`, `shrank` or `moved`.
3. Same `kind` **and the same anchor kind** (symbol, route, package or file), with **two or
   more members on both sides** and a member-set Jaccard of at least 0.5: `changed`.
   - Pairs are matched greedily by descending Jaccard, then by ascending id.
   - Single-member findings never match by rule 3, so two unrelated findings in one file are
     never "changed".
4. Remainder: `introduced` (after only) or `resolved` (before only), subject to C9.

**Per-item findings first.** `unusedCodeRule` (`AT/knowledge/codeFindings.ts:28-52`) today
emits one repo-wide finding per kind. It is split into one finding per unused file, export or
dependency, anchored on that item, before lineage can work. This is in WS6.

The jscpd and knip issue ids in `AT/codeAnalysis.ts:36-47` adopt the same `anchor` scheme,
so the web analysis compare and the knowledge compare share one identity. Their two
implementations collapse into one in the memory package, and the `CodeAnalysisSnapshot`
types move with `compareAnalysis` into memory `comparability.ts`.

### C4. The delta contract

New pure package **`packages/run-delta`**. It has no I/O; hosts supply ports.

```ts
type Verdict = 'better' | 'worse' | 'same' | 'not_comparable' | 'not_measured';
type Lineage = 'introduced' | 'resolved' | 'changed' | 'persisting';

interface DeltaFinding {
  identity: FindingIdentity;
  dimension: DimensionId;                 // 'security' | 'performance' | 'ilities.<char>' | 'quality'
  ruleId: string; ruleVersion: number;
  severity: 'info' | 'warn' | 'error';
  lineage: Lineage;
  change?: 'grew' | 'shrank' | 'moved';
  confidence: 'measured' | 'heuristic';   // heuristic renders with ≈ and never alone sets 'worse' at error
  evidence: Evidence[];                   // before/after locations, source→sink path, entry-point chain
  waiver?: { by: string; reason: string; at: string };
}

interface MetricDelta {
  metricId: string;                       // 'complexity.max', 'deps.count', 'bundle.bytes', 'coverage.diff'
  before: number | null; after: number | null;   // null = not measured on that side
  unit: string; betterWhen: 'lower' | 'higher';
  threshold: { warn: number; error: number; kind: 'abs' | 'pct' };
  significance?: { method: 'wilcoxon-signed-rank' | 'sprt-sign' | 'none'; p?: number; ci?: [number, number] };
}

interface DimensionResult {
  id: DimensionId; verdict: Verdict; reasons: string[];   // reason codes, localized at render
  findings: DeltaFinding[]; metrics: MetricDelta[];
  measuredBy: Array<{ tool: string; version: string; status: 'ok' | 'failed' | 'skipped'; reason?: string }>;
}

interface RunDelta {
  version: 1;
  runId: string;
  before: { manifestGeneration: string; merkleRoot: string; baseCommit?: string };
  after:  { manifestGeneration: string; merkleRoot: string };
  impact: { changedFiles: string[]; dependents: string[]; entryPoints: string[] };
  dimensions: DimensionResult[];          // sorted by dimension id
  headline: Verdict;                      // worst of dimensions, by the order worse > not_comparable > better > same > not_measured
  blastRadius: { score: number; band: 'low' | 'medium' | 'high'; formula: 'v1' };
  narrative?: { text: string; model: string; inputDigest: string };   // optional, labelled
  digest: string;                         // sha256(canonical(delta without narrative))
}

interface DeltaPorts {
  facts(gen: string, paths: string[]): Promise<Map<string, FileFacts>>;
  findings(gen: string): Promise<Finding[]>;
  analyze(tool: AnalyzerId, side: 'before' | 'after', scope: string[]): Promise<AnalyzerRecord>;
  metrics(side: 'before' | 'after', ids: string[]): Promise<MetricSample[]>;
}

computeRunDelta(input: RunChangeSet, registry: DimensionRegistry, ports: DeltaPorts): Promise<RunDelta>;
```

**Property.** The same `(before, after, registry versions, tool versions)` gives the same
`digest` on every machine.

### C5. Dimension: Security

Question: *did the attack surface or the attack vectors change?*

**C5.1 Attack-surface inventory.** This uses the attack-surface metric of Manadhata and Wing:
entry points, exit points, channels and untrusted data items. `codeRoutes.ts` and
`codeEntryPoints.ts` become tree-sitter rules that emit typed facts:

```ts
interface EntryPointFact {
  kind: 'http-route' | 'ws-handler' | 'webview-message' | 'vscode-command' | 'cli-command'
      | 'mcp-tool' | 'queue-consumer' | 'cron' | 'exported-api';
  key: string;                 // e.g. 'POST /api/projects/:id/knowledge/write'
  symbol: string;              // handler symbol path
  guards: string[];            // sorted guard names found on its chain (middleware, wrappers)
  inputs: string[];            // untrusted input accessors used (req.body, c.req.json, msg.data, argv)
}
```

- Guards come from a **guard registry**, which is repo data (`.builderforce/delta.json` plus
  built-in defaults). For this repo: `requireAuth`, `resolveMembership`, `RoleGate`,
  `requireSuperadmin` and the Hono auth middlewares.
- Findings:
  - `entry-added` (warn);
  - `entry-removed` (info);
  - `guard-removed` (error);
  - `guard-weakened` (warn): a role guard replaced by a lower one, by registry rank;
  - `method-widened` (warn);
  - `new-untrusted-input` (warn).

**C5.2 Taint-lite (source → sink).** Deterministic, intra-procedural def-use over the
tree-sitter AST, with one level of inter-procedural summaries through the call facts.
- **Sources** registry: request body, query, params and headers; webview `postMessage` data;
  `process.argv`/`env`; file reads of uploaded content; MCP tool arguments.
- **Sinks** registry: `child_process` exec/spawn with a shell; `eval`/`new Function`/`vm`;
  `innerHTML`/`dangerouslySetInnerHTML`; raw SQL templates; `fetch` with a variable URL
  (SSRF); `fs` paths built from input (traversal); redirects to an input URL; deserialization
  of input; regexes built from input.
- **Sanitizers** registry: escaping helpers, zod/valibot parse, path normalization with a
  root check, URL allowlists.
- A path from source to sink with no sanitizer is a `taint-path` finding, `confidence:
  'heuristic'`, and its evidence is the hop chain. The delta reports introduced and resolved
  paths.
- Deep analysis is optional: when Semgrep or CodeQL is installed locally, its SARIF output is
  imported (C12) as `confidence: 'measured'`.

**C5.3 Capability delta.** Per-file `capabilityImports` facts cover:
- process execution, filesystem writes, network clients and servers, dynamic code and native
  addons;
- crypto primitives, with weak algorithms in a registry (md5 and sha1 used for security, ECB,
  `Math.random` used for tokens);
- environment and secret reads.

Findings: `capability-added` (warn), and `weak-crypto` (error).

**C5.4 Dependencies (supply chain).**
- Lockfile diff: added, removed and upgraded packages, and new transitive count.
- New `install`/`postinstall` scripts (warn).
- License family change (warn).
- Known vulnerabilities via **osv-scanner with its offline database**. The existing PreFetch
  executor (`checkExecutors.ts:77-104`) is reused as an analyzer adapter, not copied. The
  offline database is refreshed when online and its age is shown in the evidence. A stale
  database (over 14 days) makes the vulnerability check `not_comparable` while the rest of
  the dimension still reports.

**C5.5 Secrets.** gitleaks over the *changed hunks* only, again reusing the existing executor.
Any hit is an error and is always redacted in evidence.

**C5.6 Config and infra surface.** Rules over CSP, CORS origins, cookie flags, `wrangler.toml`
routes and bindings, Dockerfile `USER` and exposed ports, GitHub workflow permissions and
`pull_request_target`. Each is a registry rule.

**C5.7 STRIDE checklist.** For each `entry-added`, `capability-added` or new trust-boundary
crossing (layer edge from presentation to infrastructure, or host to webview), the delta
attaches a STRIDE row: spoofing, tampering, repudiation, information disclosure, denial of
service and elevation of privilege. Each row says which measured guard covers it, or
"uncovered". The checklist is a deterministic template filled from facts. It is not model
output.

**Verdict.** `worse` if any introduced or changed finding is error-level and measured, or
more than one introduced warn exists. `better` if findings were resolved and nothing was
introduced. Heuristic-only errors give `worse` with a `heuristic` reason badge.

### C6. Dimension: Performance

Question: *did performance change?* The dimension has two tiers. The static tier always runs;
the dynamic tier is opt-in or policy-triggered.

**C6.1 Static rules** (tree-sitter facts, B5 rules):

| Rule | Detects |
|---|---|
| `io-in-loop` | An awaited I/O call inside `for`, `while`, `.map`, `.forEach` or `.reduce`. The I/O tag comes from an **I/O registry** (db clients, `fetch`, fs, KV and R2 bindings) followed through call facts one level: N+1. |
| `unbounded-query` | Query-builder calls with no `limit`/`take` (registry per ORM: drizzle, prisma, knex, raw SQL `SELECT` without `LIMIT`) |
| `cache-bypass` | A read path calling a repository registered as cacheable without the registered read-through helper (`getOrSetCached` here). Repo rule. |
| `sync-io-on-hot-path` | `*Sync` fs and `child_process` calls reachable from an entry point |
| `nested-iteration` | Nested loops over the same or related collections (quadratic) |
| `regex-redos` | Regex literals failing a star-height and overlap check (safe-regex algorithm) |
| `bundle-weight` | New dependency size from the lockfile and the local registry cache; client-bundle imports of server-heavy modules |
| `render-hot` (frontend) | New inline object or function props in lists, missing `key`, effects without dependencies. Registry rules for React. |

**C6.2 Dynamic tier.** It runs only when a benchmark config exists, either
`.builderforce/delta.json → benchmarks` or detected vitest `bench` files.
- **Interleaved A/B (ABAB…) runs** of before and after builds, at least 10 samples each, after
  warm-up.
- Interleaving makes the samples **pairs**, so the test is the **Wilcoxon signed-rank test** on
  the pair differences. The effect is the paired Hodges–Lehmann estimate (the median of the
  Walsh averages) with a seeded paired-bootstrap 95% CI.
- A change is reported only when p < 0.01 *and* the CI excludes the threshold (default ±5%).
  Otherwise the result is `same (within noise)`.
- Where the OS allows (`perf stat` on Linux), **instruction counts** are preferred over wall
  time because they are close to deterministic.
- **Test-suite timing.** If the run executed tests, per-test durations from the reporter JSON
  are compared as a cheap proxy. A test 3× slower and more than 200 ms is a `warn`.

**Verdict.** `worse` on an introduced error-level static finding or a significant dynamic
regression beyond threshold. `better` symmetrically. With the dynamic tier not run, the
dimension states "static only".

### C7. Dimension: the -ilities (ISO/IEC 25010:2023)

Each quality characteristic is a sub-dimension, `ilities.<char>`, so nothing is missed and
each has measurable proxies:

| Characteristic | Proxies (rules and metrics) | Source |
|---|---|---|
| **Functional suitability** | Changed behaviour with no changed or added test touching it (`untested-change`); link to the ticket's acceptance criteria when the run has a ticket (PRD 23/37 evidence) | Test facts (C8.2), call facts |
| **Performance efficiency** | → C6 (shown here as a roll-up, not duplicated) | C6 |
| **Compatibility** | **Public API diff**: exported signature changed or removed (`api-breaking`, error) or added (info), using the semver rule of the package's `exports` map. Wire contracts: route request and response schema changes (zod schemas on routes), migration diff (destructive DDL is an error, per the expand/contract rule), config key and env var additions and removals, `engines` changes. | Export facts, schema facts, migration facts |
| **Interaction capability (usability)** | Hard-coded user-facing strings (the existing localize guard as an analyzer), accessibility lint on changed components (missing labels, roles, contrast-token misuse), theme token violations | Existing guards wrapped as analyzers |
| **Reliability** | Swallowed `catch`, floating promises, removed error branches, timeouts and retries removed or added, `process.exit` in library code | Tree-sitter rules |
| **Security** | → C5 roll-up | C5 |
| **Maintainability** | Modularity: new cycles, layer violations, coupling Ca/Ce/instability per partition (Martin). Reusability: duplication delta (jscpd). Analysability: complexity delta, **god-file growth** (file over 400 lines grew, or any file crossed 400). Modifiability: churn × complexity hotspots touched. Testability: diff coverage. | B5 rules, jscpd, complexity, coverage |
| **Flexibility / portability** | New platform-specific APIs (Windows-only paths, POSIX-only shell), hard-coded path separators, node-only modules imported into browser or Worker code | Capability and import facts by layer |
| **Safety** | Destructive operations introduced: `DROP`/`TRUNCATE` in migrations, `rm -rf`-style calls, force-push in scripts | Migration and call facts |

The dimension's verdict is the worst sub-verdict. The card shows only sub-dimensions that are
not `same`.

### C8. Dimension: Quality, including agent integrity

**C8.1 Code quality metrics** (MetricDelta):
- complexity sum and max over changed functions;
- duplication percentage in the impact set;
- unused exports, files and dependencies;
- lint and type errors in changed files, from the host's diagnostics API
  (`vscode.languages.getDiagnostics`) at baseline and after, so no compiler runs;
- `any`/`unknown` casts added;
- TODO/FIXME added.

**C8.2 Test integrity.** This is the agent-specific part. An agent judged by tests can pass by
weakening them. `testFacts` per test file give:
- test count and names;
- assertions per test;
- matcher strength class (`toEqual` > `toMatchObject` > `toBeTruthy`/`toBeDefined`);
- `.skip`/`.only`/`.todo`/`xit`;
- per-test timeout values;
- snapshot files touched.

| Rule | Severity |
|---|---|
| `test-deleted`, `test-skipped`, `only-added` | error |
| `assertions-reduced` (per test, by count) or `matcher-weakened` | error |
| `assertion-edited-with-impl` (a test's expected values changed in the same run as the code under test) | warn. Error for consolidation runs, per the "tests run unchanged" rule. |
| `snapshot-updated-with-impl` | warn |
| `suppression-added` (`@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `# noqa`, `as any`) | warn |
| `timeout-raised` | warn |
| `catch-all-added` around previously failing code | warn |

**C8.3 Scope drift.** When the run has a plan or ticket with named files or areas, changed
files outside them are listed (`out-of-scope-change`, warn).

**C8.4 Coverage and mutation** (optional tier).
- **Diff coverage** is the share of changed lines executed by tests. It is read from
  lcov/istanbul output if the run produced it (`codeCoverage.ts` already reads it), else
  `not_measured`.
- **Incremental mutation testing** (StrykerJS `--incremental`, restricted to changed files)
  runs when configured or when policy demands it, for example on autonomous runs to protected
  branches. The mutation score delta for changed code is the strongest test-quality signal.

**Verdict.** Any C8.2 error makes quality `worse` whatever else improved, and the headline
says so explicitly ("tests were weakened").

### C9. Comparability rules

A finding kind or metric is `not_comparable` for a delta when **any** of these hold:
- the producing tool or rule version differs between the two sides;
- the extractor family differs (tree-sitter vs regex);
- the tool failed or timed out on either side;
- the before side could not be resolved (C1);
- the offline vulnerability database is older than 14 days (vulnerability kind only);
- the analyzed scope differs, for example truncated by `MAX_LISTED_FILES` on one side.

Rules:
- A `not_comparable` kind contributes **no** `introduced` or `resolved` entries.
- Its after-side findings are shown as "present now" without lineage.
- The VSIX baseline adopts the same rules, which closes the missing `comparable` at
  `knowledgeBridge.ts:195-203`.
- `compareAnalysis` (`AT/codeAnalysis.ts:60-70`) and this logic merge into one
  `comparability.ts` in memory `/knowledge`.

### C10. Headline and blast radius

**Headline.** The worst dimension verdict, rendered from a deterministic sentence template,
for example: "Worse: security (1 route lost its auth guard) and quality (2 tests weakened).
Performance and -ilities unchanged."

**Blast radius, `formula: 'v1'`.**

```
score = Σ over changed symbols s:  centrality(s) × (1 + log2(1 + churn90d(s file)))
        + 2 × |entry points reaching a changed symbol|
```

- `centrality` is PageRank over the symbol call/import graph: damping 0.85, 50 iterations,
  sorted nodes.
- The score is normalized against the repo's own distribution of past run scores:
  - `low` below p50;
  - `medium` up to p90;
  - `high` above p90.
- Bands are percentile-based per repo, so the score means the same thing in a 200-file and a
  20,000-file repo.
- The formula is versioned and printed in the evidence.

### C11. Presentation: for people who don't read code

Everything below is a view over `RunDelta`. Layout depth increases one level at a time:
headline → dimensions → findings → evidence → code.

1. **Run Delta card.** It appears inside the run's chat transcript when the run finalizes, in
   the ONE run surface: VSIX chat, web chat and canvas run. It shows:
   - the headline;
   - one row per dimension (verdict, introduced/resolved/changed counts, a "static only" or
     "not comparable" reason chip where relevant);
   - the blast radius band;
   - "measuring…" rows while L3 analyzers or the dynamic tier are still running. The card
     fills progressively, and its digest is final only when every row is final.
2. **Run Delta panel.** A slide-out panel on the web and a side sheet in the VSIX webview,
   built from the `knowledge-graph-view` sheet primitives, not a modal. It contains:
   - findings grouped by dimension, then by lineage;
   - an **evidence** list, reusing `EvidenceList`: before and after snippets, the source→sink
     hop chain, the entry-point chain, the metric with its CI;
   - **graph lens**: the impact set highlighted in the existing knowledge graph view;
   - actions:
     - **Fix with agent** seeds the ONE composer with the finding and its evidence;
     - **Accept risk** records a waiver with a reason, which becomes a fact and is respected
       by later deltas;
     - **Mark as wrong** is a false-positive signal (§10);
     - **Open code**.
3. **Run history.** The run list shows each run's headline verdict. A project **trend view**
   charts dimension verdicts and key metrics per run over time (insights everywhere). The
   analytics UI is enterprise style, with ≈ marking heuristic counts.
4. **Manager and autonomous delivery.** The delta is the acceptance evidence attached to
   PR review (PRD 23) and execution verification (PRD 37). A **delta policy**, which is
   registry data per project, can mark verdicts as blocking for autonomous runs. The default
   proposal: C8.2 errors and `guard-removed` block finalization of an autonomous run; nothing
   blocks an interactive run.

UI rules:
- Every string is localized: VSIX `labels.ts` catalogs; frontend `{en,zh,es,fr,de}`.
- Colours come only from theme tokens, readable in both themes.
- Layout is fluid down to 360 px.
- Verdict colour is never the only signal; each verdict also has a word and an icon.

### C12. SARIF interchange

- **Export.** `RunDelta` → **SARIF 2.1.0**:
  - one `run` per tool;
  - `result.baselineState` set from lineage: `new` (introduced), `absent` (resolved),
    `updated` (changed), `unchanged` (persisting);
  - `partialFingerprints.anchor/v1` set to `identity.anchor`.

  This lets GitHub code scanning, IDE SARIF viewers and CI consume the delta.
- **Import.** External SARIF (Semgrep, CodeQL, ESLint) from either side maps into
  `DeltaFinding` through the parser that already exists server-side.
  `sarifToFindings` moves from `api/src/domain/security/scanReportParsers.ts` into a shared
  source-only package, `packages/sarif`. The API and `run-delta` both import it, and the
  api copy is deleted.

### C13. Narrative (optional)

If a model route exists, one call turns the canonical `RunDelta` (without code) into a short
paragraph, cached by `digest`. Rules:
- It is labelled "summary written by <model>".
- It may not contain a claim that is not traceable to a delta row. A post-check rejects text
  naming a file, rule or number not present in the delta.
- With no route, it is omitted.
- It never alters a verdict.

### C14. Where deltas are computed and stored

- **VSIX and on-prem.** Computed in the extension host at run finalization, through
  `brainRunHostPorts` → `recordChangeSetAroundRun`, which already has the change set. Stored
  as a local-first record type `run-delta` (`run-delta:<runId>`), with the evidence objects
  in the content-addressed store.
- **Cloud runs.** The container sandbox executes the same `run-delta` package with the same
  analyzers. This is the ONE cloud runtime: the container is a sandbox, and the delta is a
  tool there. The result is attached to the run.
- **Sync.** `run-delta` is synced as a mirror record through the G15–G18 protocol with a
  named importer, `importMirrorRecord`. There is no generic payload writer.
- **Server persistence.** This is a storage-format decision, so it gets an Opus review and
  the expand/contract migration rule. The shape is 3NF, with dimensions as rows because they
  are registry data (principle 5):

  | Table | One row per | Columns |
  |---|---|---|
  | `run_deltas` | run | `run_id`, `digest`, `headline`, `blast_band`, `delta_version`, `created_at` |
  | `run_delta_dimensions` | run × dimension | `run_id`, `dimension_id`, `verdict`, `introduced`, `resolved`, `changed` |
  | `run_delta_findings` | finding in a delta | `run_id`, `anchor`, `dimension_id`, `rule_id`, `rule_version`, `severity`, `lineage`, `confidence`, plus the embedding columns below |

  A new dimension is a registry row, never a migration. Evidence stays a blob in R2, keyed by
  digest. *Decided 2026-11-06: tables, with vectors.*
- **Vectors** (decided 2026-11-06). These follow the **current** pgvector convention, migration
  `1256_memory_embedding_1024.sql` and `MEMORY_VECTOR_SPACES`
  (`memoryEmbeddingBackfill.ts:14-18`), not the legacy 1536 space of 1134:
  - the default bge-m3 1024-dimension space;
  - `embedding_model` and `embedded_at` columns;
  - an HNSW index with `vector_cosine_ops`;
  - a partial "unembedded" index;
  - the resumable keyset backfill sweep.
- **`run_delta_findings.embedding`** embeds the finding's canonical card text: rule, anchor,
  normalized snippet and evidence summary. It is used for similar findings across runs and
  repos, duplicate-finding collapse, and retrieving past fixes for *Fix with agent*.
  - A write never fails for lack of a vector.
  - The read filters on `embedding_model`.
  - The table is registered as one more space and row in `MEMORY_VECTOR_SPACES` and its sweep.
    The sweep is not copied.
  - Locally, the same cards go through the deterministic knowledge index, so offline similarity
    works without the server.
- **Run features are not a vector column.** A fixed-width `vector(k)` would break on every
  feature-schema change. `RunFeatures` are owned by the run-outcome context (D1) as rows of
  `run_features(run_id, feature_schema_version, values real[])`.
  - k-NN (D10.2) and the anomaly score (D2.5) run per repo over at most a few thousand rows.
  - They are computed in the application layer through the read-through cache, keyed by
    `(repo, schema version, latest run)`.
  - Euclidean distance on standardized values. No ANN index is needed at that scale.
- **Retention.**
  - `run_deltas`, `run_delta_dimensions` and `run_delta_findings`: 2 years.
  - R2 evidence: 1 year.
  - `run_features` and labels: kept while consent holds.
  - Person-score audit rows: 2 years.

  All of these are registered in `sweptTables.ts` in WS11 and WS16.

---

## Part D — Predicted measures

Parts B and C *measure*. Part D *predicts* what measurement cannot settle at run end:
- whether the run will need a follow-up fix;
- how many problems no detector found;
- whether a trend is a real change;
- which expensive checks are worth their cost;
- what the person should look at first.

Every formula below is classic and explainable, and it is computed reproducibly.

### D0. The rule: measured decides, predicted advises

1. **A prediction never sets or changes a verdict.**
   - `packages/run-delta/src/verdict/**` may not import `packages/run-delta/src/predict/**`.
   - A dependency guard (`check:run-delta-layers`) fails the build otherwise.
2. **Every prediction carries its uncertainty and its provenance:**

   ```ts
   interface Prediction {
     id: string;                         // 'risk.followup-fix', 'estimate.undetected.security', …
     modelId: string; modelVersion: string; featureSchemaVersion: number;
     value: number;                      // probability, count or metric
     interval?: [number, number];        // credible/confidence/prediction interval
     band?: 'low' | 'medium' | 'high';
     explanation: Array<{ feature: string; contribution: number }>;   // top contributions, sorted
     status: 'ok' | 'insufficient-data' | 'not-applicable' | 'model-disabled';
     inputDigest: string;                // sha256 of the canonical feature vector
   }
   ```

3. **Reproducible.**
   - Models are versioned data artifacts.
   - Inference uses fixed-point arithmetic (int16 weights, standardized features quantized
     to 1e-4).
   - Any randomness uses a PRNG seeded from `inputDigest`.
   - Outputs are quantized before display.
   - The same features and model version give the same prediction on every machine, offline
     included.
4. **Rendered apart.** Predictions sit in a "Predicted" section of the card and panel. They
   always carry the word "predicted" or "≈", and they never use verdict colours.
5. **Below the data threshold, `insufficient-data`.** No prediction is shown from a model
   that has not met its minimum sample size. A guess is never shown as a prediction.

### D1. The labels pipeline: start recording at the first delta

Every model in this part learns from outcomes, and outcomes cannot be reconstructed later.
So labels start recording in the same workstream that ships the delta (WS7), before any model
exists.

**One owner.** Run features and outcome labels belong to one bounded context, **run
outcomes**:
- Locally: the `run-outcome` record.
- On the server: the `run_features` and `run_outcome_labels` tables.
- The delta references them by `runId`, and the training store reads them.
- Nothing else keeps a copy.

**Features are frozen at run end.** A `RunFeatures` vector (versioned schema) is written to
that record:
- **Size:** lines added and deleted, files touched.
- **Spread:** change entropy (D2.1).
- **Structure:**
  - centrality sum and max of the touched symbols;
  - entry points reached;
  - layers touched;
  - cross-partition edges changed.
- **History:**
  - churn over 90 days of the touched files;
  - count of past follow-up fixes in those files, read **as of run end** (labels finalized
    before `finalizedAt` only, so the feature never sees the future);
  - age of the touched code.
- **Delta:**
  - introduced, resolved and changed counts per dimension;
  - integrity findings;
  - tests changed;
  - diff coverage when measured.
- **Run:**
  - entry point (VSIX, cloud, web);
  - autonomous or interactive;
  - model tier;
  - steps;
  - tool failures.
- **People** (decided 2026-11-06): requester, approver, reviewer and agent ids, plus
  experience features. Experience means prior runs in the repo, prior changes to the touched
  files, and tenure in the repo.
  - These are stored with the features, under the access rules of D14.
  - The trained artifact contains no code, no paths and no person ids: only aggregate
    experience values.

**Outcome labels** (`RunOutcomeLabel`, one row per run and label kind):

| Label | How it is derived | Window |
|---|---|---|
| `reverted` | A later commit reverts the run's commit, or more than 50% of the run's added lines are deleted | 30 days |
| `followup-fix` | **SZZ** (Śliwerski, Zimmermann, Zeller):<br>1. For each later *fix* change, blame the lines it modifies at its parent.<br>2. A fix is a bug-type ticket, a commit message matching the fix registry, or a run started from a delta finding's *Fix with agent*.<br>3. Lines whose facts-hash did not change (comments, whitespace) are ignored, using B1 early cutoff.<br>4. Blamed lines map back to the run through **per-run commit attribution**:<br>• when a commit includes content whose normalized hash equals a run's `afterHash` for that path, the run's change set records `{commitSha, path}`;<br>• the VSIX records this at commit time through the git extension API;<br>• the cloud runtime records it at `cloudFinalize`.<br>`runCommitMarker` is per task and cloud-only (`cloudFinalize.ts:219`), so it is not used. Making it per run is the separately logged defect in ROADMAP (branch residue), and WS16 closes both. | 30 days |
| `ci-red-after-merge` | The first CI run on the merged commit fails in a job touching the changed area | 7 days |
| `review-rejected` | PR review (PRD 23) requests changes on the run's PR | until the PR closes |
| `finding-actioned` / `finding-marked-wrong` / `finding-waived` | Panel actions (C11) | immediate |

- **Censoring.** A label is *final* only after its window ends. Before that, the run is
  right-censored. Survival estimates (D5.4) use censored runs correctly, and classifiers
  train only on final labels.
- **Storage.** Labels and features are local-first records (`run-outcome`), synced as mirror
  records. Training data lives in the ops database, tenant-scoped. A cross-tenant global
  model trains only on aggregated features, and only with the tenant's consent (§12.8).
- **Leakage guard.** A feature may only use data available at run end. A unit test fails any
  feature whose source timestamp is later than `run.finalizedAt`.

### D2. Deterministic statistics (no training, ship first)

**D2.1 Change entropy** (Hassan, 2009). With `pᵢ` the share of the run's changed lines that
fall in file *i*, over the *n* files touched:

```
H = −Σ pᵢ log₂ pᵢ        Hₙ = H / log₂ n   (n > 1; else 0)
```

High normalized entropy means a scattered change, which predicts defects better than raw
size. It is a `MetricDelta` in quality and a top feature for D5.

**D2.2 Maintainability Index.** Uses tree-sitter Halstead counts. `V` is Halstead volume
`N log₂ η`, `G` is cyclomatic complexity and `LOC` is lines of code. The normalized variant:

```
MI = max(0, (171 − 5.2 ln V − 0.23 G − 16.2 ln LOC) × 100 / 171)
```

It is a per-file metric, with its delta over changed files under `ilities.maintainability`.

**D2.3 Distance from the main sequence** (Martin), per partition. `A` is abstractness and
`I = Ce / (Ca + Ce)` is instability:

```
D = |A + I − 1|
```

**D2.4 Capture–recapture estimate of undetected problems.** For a **detector pair**
registered as covering the same scope and finding kinds:
- taint-lite × Semgrep (security), with both mapped to the C3 anchor scheme;
- jscpd (token clones) × `near-duplicate` (vector similarity).

A pair qualifies only if the two detectors use **different methods**. knip × `unused-export`
is excluded, because both compute the same definition and their overlap says nothing about
what is missed.

Let `n₁` and `n₂` be the findings each reports, and `m` those both report, matched by anchor.
The Chapman bias-corrected estimator:

```
N̂ = (n₁ + 1)(n₂ + 1) / (m + 1) − 1
Var(N̂) = (n₁ + 1)(n₂ + 1)(n₁ − m)(n₂ − m) / ((m + 1)²(m + 2))
undetected ≈ N̂ − (n₁ + n₂ − m)
```

- It is shown only when `m ≥ 3`, otherwise `insufficient-data`.
- It is always labelled ≈, because the two detectors are rarely truly independent, and the
  estimate is biased low when they share blind spots.

**D2.5 Run anomaly score.** This **extends memory-engine's existing `ml/tasks/run_anomaly`
task** and its `anomaly_composite` (robust-z plus EWMA) over the run's `RunFeatures`. It is
not a new implementation.
- The composite gains a Mahalanobis term for correlated features:
  `d² = (x − μ)ᵀ Σ̂⁻¹ (x − μ)`, with `Σ̂` the Ledoit–Wolf shrinkage covariance, computed on
  log-transformed count features.
- **Threshold.** The flag fires when the score exceeds the repo's own **empirical 99th
  percentile** of past scores, computed leave-one-out. The χ² quantile is not used, because
  skewed count features with *k* close to *n* break its normality assumption.
- The top contributing features explain the flag.
- It needs at least 30 past runs.

### D3. Bayesian rule precision (replaces the fixed demotion threshold)

Each rule *r* has precision `θᵣ ~ Beta(α₀, β₀)`.
- **Prior.** Fitted by empirical Bayes (method of moments) across all rules of the same
  family and all consenting tenants. This is hierarchical shrinkage, which solves the cold
  start for a new rule or a new repo.
- **Votes.** `finding-actioned` or `finding-waived` counts as a true positive (TP);
  `finding-marked-wrong` counts as a false positive (FP).
  - Votes are counted **once per finding lineage, per voter**: the latest vote wins.
  - A persisting finding shown in ten runs is one observation, not ten.
- **Posterior:**

  ```
  θᵣ | data ~ Beta(α₀ + TP, β₀ + FP)       E[θᵣ] = (α₀ + TP) / (α₀ + β₀ + TP + FP)
  ```

- **Demote** to `info` when the upper 90% credible bound falls below 0.6. **Restore** when the
  lower bound rises above 0.8.
- The bounds come from the regularized incomplete beta inverse, computed deterministically.
- A rule with 3 votes does not move. A rule with 300 moves as soon as the evidence says so.
- Per-repo posteriors shrink toward the global one, so one noisy repo cannot demote a rule
  everywhere.

### D4. Calibration

A heuristic score *s* becomes a calibrated probability:
- **Platt scaling:** `p = σ(A·s + B)` while there are fewer than 1,000 labelled examples.
- **Isotonic regression** (pool-adjacent-violators) at 1,000 or more.

Quality is tracked with:
- the **Brier score**: `(1/N) Σ (pᵢ − yᵢ)²`;
- the **expected calibration error** (ECE): 10 equal-mass bins, `Σ (|Bₖ|/N) |acc(Bₖ) − conf(Bₖ)|`;
- reliability diagrams in the superadmin analytics.

Every model is recalibrated when its ECE exceeds 0.05 on the trailing 30 days.

`packages/prefetch/src/calibrate.ts` already calibrates the prefetch gate. It moves into
the builderforce-memory `stats` module (D13), and prefetch imports it from there. The two do not keep separate
copies.

### D5. Run risk: just-in-time defect prediction

**D5.1 Model.** Regularized logistic regression (Kamei et al., 2013; McIntosh & Kamei, 2018):

```
P(followup-fix ∨ reverted | x) = σ(wᵀz + b),   z = (x − μ) / s   (stored scaler)
loss = −Σ [yᵢ log pᵢ + (1 − yᵢ) log(1 − pᵢ)] · cᵢ + λ‖w‖²
```

- `cᵢ` is the inverse class-frequency weight. Class weighting distorts probabilities, so **D4
  calibration is mandatory after every fit**, on a held-out window. Only calibrated
  probabilities are shown or used.
- The fit **extends memory-engine `ml/classical/logistic.ts`**, adding L2, class weights and
  IRLS where missing. It is registered as a memory-engine `ml/tasks` entry, `run_risk`, per
  the rule that the ML task catalog lives in builderforce-memory.
- The fit is Newton/IRLS with a fixed iteration cap. λ is chosen by **rolling-origin
  cross-validation**: train on the past and validate on the next month, with no random
  splits, so the future never leaks into training.

**D5.2 Explanations.** The contributions `wⱼ zⱼ`, the top 3 rendered as reasons, for example
"spread across 9 files (entropy 0.92)" or "touches 2 entry points".
- **Person and experience features are never rendered** as a reason on the run card. They
  still count in the probability.
- People-related information appears only on D14 surfaces, under D14's access rules.

**D5.3 Replacing blast radius `v1`.** The model replaces C10 `v1` as the risk band only when,
on a hold-out of at least 500 final-labelled runs, it beats `v1` on all three of:
- PR-AUC;
- Brier score;
- **effort-aware recall at 20%**: the share of bad runs caught when reviewing the riskiest
  runs that together hold 20% of changed lines.
- **Popt** is also reported: the normalized area between the model's effort-recall curve and
  the optimal and worst curves (Kamei et al.). It is not used in the gate.

Until then, `v1` stays and the model's output is shown only as a secondary "predicted risk".

- **Per-repo adaptation.** A mixed-effects variant (repo random intercept, shrunk toward the
  global model) is trained once a repo has 200 or more final labels.
- **Artifact** (canonical JSON, digest-named, bundled in the VSIX and refreshed when online):

  ```
  {modelId, version, featureSchemaVersion, weights(int16), scale, scaler{μ,s}, calibration,
   trainedOn{from, to, n, tenants}, metrics{prAuc, brier, ece, popt}}
  ```

**D5.4 Survival view.** For each risk band, a **Kaplan–Meier** estimate of the time until a
follow-up fix:

```
Ŝ(t) = Π_{tᵢ ≤ t} (1 − dᵢ / nᵢ)
```

- This uses the censored runs that classifiers cannot.
- It renders as, for example, "Runs in this band needed a fix within 14 days 23% of the time
  (95% CI 18–29%, Greenwood)".
- A Cox proportional-hazards model is a later option. It is not in v1.

### D6. Naturalness: unusual new code

This applies "On the Naturalness of Buggy Code" (Ray et al., 2016; Hindle et al., 2012). With
a local code model that exposes log-probabilities (the prefetch `logprob.ts` seam, served by
bfi-node, WebLLM or Ollama):

```
surprisal(line) = −(1/|T|) Σ_{t∈T} log₂ p(t | context)      z = (surprisal − μ_repo) / σ_repo
```

- Computed for **changed lines only**, capped at 2,000 lines per run.
- `μ_repo` and `σ_repo` come from a sample of the repo's unchanged lines under the same model
  fingerprint.
- Lines with `z > 3` are listed as "unusual code" (info), as a place to look. They are never
  a finding of a defect.
- Values are quantized to 0.01 bits and cached by `(model fingerprint, file hash)`.
- With no logprob-capable local model, the measure is `not_measured`.

### D7. Trends: statistical process control

Applied per repo and per metric in the trend view (C11.3): complexity, duplication, the share
of runs with integrity findings, introduced security errors per run, and so on.

- **EWMA:**
  - `zₜ = λxₜ + (1 − λ)zₜ₋₁`, with `λ = 0.2`;
  - control limits `μ ± 3σ√(λ/(2 − λ))`.
- **CUSUM** (Page), for slow drift:
  - `Sₜ⁺ = max(0, Sₜ₋₁⁺ + xₜ − μ − k)`, with `k = 0.5σ`;
  - signal at `h = 5σ`, and the same for the lower side.
- **Bayesian online change-point detection** (Adams & MacKay, 2007):
  - hazard `1/100`;
  - Gaussian model with unknown mean;
  - marks the run where the regime changed, with its posterior probability.
- Each needs at least 20 runs of history and shows "learning baseline" before that.
- A signal is a trend annotation ("duplication has risen for 8 runs since run #412"), with an
  optional notification. It is not a verdict.

### D8. Reliability growth: is the debt really going down?

**Goel–Okumoto NHPP**, fitted to the cumulative count of a dimension's introduced findings
over run index *t*:

```
μ(t) = a(1 − e^(−bt))        remaining ≈ a − μ(t)
```

- Fitted by maximum likelihood, with a 95% CI from a seeded bootstrap (1,000 resamples).
- Shown only when the fit converges, there are at least 10 points and `b > 0`. Otherwise
  `not-applicable`, because the process is not "growing reliability".
- This puts numbers on PRD 38's headline: "debt goes down".

### D9. Scheduling the expensive tier

**D9.1 Contextual Thompson sampling.**
- **Decides** whether to run mutation testing, benchmarks or deep SARIF tools on a run.
- **Context:** risk, blast radius, dimensions touched and files changed.
- **Model:** a Bayesian logistic regression with a Laplace-approximation posterior predicts
  `P(check changes a verdict | context)`.
- **Decision:** run when `P × value(dimension) ≥ cost(check)` and the budget allows.
- **Seed:** the sample comes from a PRNG seeded by the run's `inputDigest`, so the choice is
  reproducible.
- **Record:** the delta stores it as `scheduledBy: {policy, p, seed}`.
- Policy-mandated checks always run (C11.4).
- `learned-routing` already does bandit selection for models. Both use the one sampler in
  the builderforce-memory `stats` module.

**D9.2 Sequential testing for benchmarks: a sign-test SPRT.** This avoids assuming a
distribution for timings.
- For each interleaved pair, `sᵢ = 1` if after is slower than before by more than δ/2, else
  `sᵢ = 0`. Pairs within ±δ/2 are dropped as ties. δ is the metric's warn threshold.
- Hypotheses on `π = P(sᵢ = 1)`: `H₀: π = 0.5` against `H₁: π = π₁` (default 0.75). This is a
  simple-versus-simple Bernoulli SPRT with the exact likelihood ratio
  `Λₙ = Π (π₁/0.5)^{sᵢ} ((1−π₁)/0.5)^{1−sᵢ}`.
- α = 0.01, β = 0.05. Wald boundaries are `A = (1 − β)/α` and `B = β/(1 − α)`. The same test
  runs mirrored for improvements.
- Minimum 5 and maximum 30 pairs. **Truncation at 30 makes the realized error rates differ
  from α and β.** The realized rates for these boundaries and this cap are computed once by
  seeded simulation and recorded in the metric registry next to the thresholds.
- When stopped early, the SPRT decision is reported with `method: 'sprt-sign'`, not a
  fixed-sample p-value, which would be invalid after optional stopping. At the cap, C6.2
  reporting (Wilcoxon signed-rank) applies.

### D10. What to look at first

**D10.1 Learning to rank findings.**
- **Model:** pairwise logistic loss, `log(1 + e^{−(sᵢ − sⱼ)})`, over finding features.
- **Features:** severity, rule precision posterior (D3), lineage, dimension, centrality,
  entry-point reach and confidence.
- **Labels:**
  - Fix with agent or Accept risk: relevant;
  - Mark as wrong: negative;
  - Shown and ignored: weak negative, with **inverse propensity weighting** for position bias.
- **Effect:** it changes **order only**. Ties break by `findingId`. Evaluated with NDCG@5.

**D10.2 Similar past runs (k-NN).**
- Uses standardized `RunFeatures` and Euclidean distance, `k = 10`, ties broken by `runId`,
  over final-labelled runs only.
- Renders as, for example, "7 of the 10 most similar runs needed no follow-up; 2 were
  reverted", with links to those runs.
- It needs at least 50 final-labelled runs in the repo, or in consenting tenants with the
  same language mix.

### D11. Presentation

The card gains a **Predicted** block under the verdict rows:
- risk (probability, band and top 3 reasons);
- the outcome of similar runs;
- "≈ N undetected" per dimension where capture–recapture applies;
- the count of unusual lines;
- an anomaly flag.

Each item opens its explanation in the panel. Trend annotations (D7, D8) live in the trend
view. All strings are localized, and the theme and 360 px rules apply as in C11.

### D12. Model governance

- **Model cards.** Each model publishes a card: data window, n, tenants, metrics, known
  limits and intended use.
- **Drift.**
  - The population stability index on each feature, `PSI = Σ (aᵢ − eᵢ) ln(aᵢ / eᵢ)`, over 10
    bins.
  - PSI above 0.2 or ECE above 0.05 triggers recalibration.
  - Recalibration failing its gate disables the model, with the status `model-disabled`.
- **Kill switch.** Per model, in the registry.
- **Audit.** Every prediction is logged with its model version and `inputDigest`, so any shown
  prediction can be replayed.
- **People.** People are scored only through D14, never as a side output of another model.
  The person-score view shows only risk-adjusted, shrunk and interval-bounded figures, never
  raw counts as a league table.

### D13. One home for the maths: the builderforce-memory `stats` module

*Decided 2026-11-06: no new package.* The maths lives in builderforce-memory as a `stats` module
(`packages/memory/src/stats/`, exported as the `@seanhogg/builderforce-memory/stats` subpath).
builderforce-memory already owns the deterministic retrieval maths (BM25, MMR, decay) and the
knowledge graph's PageRank, and every Builderforce package that needs these already depends on
it. Graph-level predictions (PRD 38 › Predicted measures) call this module at graph build.

**Reuse first.** builderforce-memory's `memory-engine` already has the classical ML catalog in
`ml/classical`: logistic, linear, kNN, EWMA, robust-z, anomaly composite, isolation forest,
GBM, naive Bayes and k-means. Its task catalog in `ml/tasks` already includes `run_anomaly`,
`local_success` and `experience`. So:
- The `stats` module holds **only what that catalog lacks**. It imports, and never
  re-implements, the `ml/classical` primitives.
- Where `ml/classical` needs more (L2, class weights or IRLS in `logistic.ts`; a Mahalanobis
  term in `anomaly_composite.ts`), it is extended in place.
- Part D's *models* are registered as `ml/tasks` entries (`run_risk`, `case_mix`,
  `finding_rank`, `check_scheduler`). The run anomaly score extends the existing `run_anomaly`.

The module is pure and deterministic: seeded PRNG (xoshiro128**), fixed iteration caps,
quantized outputs. **New in `stats`:**

- **Distributions:** Beta posterior and quantile (regularized incomplete beta inverse); Gamma
  quantile; exact Poisson (Garwood) interval.
- **Fitting:** Bayesian logistic with a Laplace posterior; Platt scaling; isotonic regression
  (PAV).
- **Tests:** Wilcoxon signed-rank and paired Hodges–Lehmann; seeded (paired) bootstrap CI;
  sign-test SPRT.
- **Time series:** CUSUM; Bayesian online change-point detection. EWMA is reused from
  `ml/classical`.
- **Multivariate:** Ledoit–Wolf shrinkage; PSI.
- **Information theory:** Shannon entropy.
- **Estimators:** Chapman / Lincoln–Petersen; Kaplan–Meier with Greenwood variance;
  Goel–Okumoto MLE; Gamma–Poisson empirical Bayes.
- **Scores:** Brier; ECE; PR-AUC; NDCG; Popt; effort-aware recall.
- **Policies:** Thompson sampling.

**Migrate, then delete, every existing copy** in the same workstream, with their tests run
unchanged:
- `packages/prefetch/src/calibrate.ts`;
- the learned-routing Thompson sampler (`exploration.ts`);
- `packages/difficulty-router/src/head.ts` (a logistic head, which moves onto
  `ml/classical/logistic`);
- `packages/pipeline-route/src/score.ts`, where it duplicates a primitive;
- `wilsonInterval` in `api/src/domain/replay/prescriptions/impact.ts`;
- the seeded layout RNG in `packages/knowledge-graph-view` `layout3d.ts`, which moves onto the
  shared PRNG.

### D14. People scores for managers

*Decided 2026-11-06: managers need people scored.* This covers humans and agents alike.
An agent is a first-class worker here: the manager is an agent, and agents are hired and
unhired. The section defines how scoring is done fairly enough to act on.

**D14.1 Attribution.** Every run records its roles:
- `requester`: who started it;
- `approvers`;
- `reviewer` (PRD 23);
- `agent`: the executing agent;
- `manager`: the supervising manager agent, if any.

Each outcome label (D1) and each delta finding is attributed to every role on the run, and
a score is always reported **per role**. Being the approver of a reverted run is a different
fact from being its requester.

**D14.2 Measures** per person or agent, per role, per period (rolling 90 days):

| Measure | Definition |
|---|---|
| Run quality | Share of runs whose headline is `worse` |
| Follow-up-fix rate | `followup-fix` labels ÷ final-labelled runs |
| Revert rate | `reverted` ÷ final-labelled runs |
| Integrity rate | Runs with a C8.2 error ÷ runs. Agents mainly. |
| Security introductions | Introduced measured security errors per run |
| Review rejection rate | `review-rejected` ÷ runs with a PR |
| Fix effectiveness | Share of *Fix with agent* runs whose finding is resolved in the next delta |
| Approval accuracy (approvers) | Share of approved runs not later `reverted` or `followup-fix` |

**D14.3 Risk adjustment: observed ÷ expected.** Raw rates punish whoever takes the hard
work. Each rate is **indirectly standardized**, the method used for hospital standardized
mortality ratios:

```
E = Σ_{runs of p} P̂(outcome | case-mix features)       O = observed count
SR = O / E          95% CI: exact Poisson (Garwood) on O, divided by E
```

- The **case-mix model** (`ml/tasks/case_mix`) is a separate logistic model of the same form
  as D5. It uses every factor **outside the scored person's control in their role**:
  - *change* features: size, entropy, centrality, entry points, churn, layer and dimension
    flags;
  - for human roles, also the **executing agent and model tier**. A requester or approver is
    not penalized for an agent's quality.
- It deliberately **excludes the scored person's own identity and experience features**.
  Otherwise it would explain away the very person effect being measured.
- It is trained in WS22 from the WS16 labels. It does not wait for the D5 gate.
- The D5 risk model may use experience features for prediction. The two models are
  different by design.

**D14.4 Shrinkage.** Small samples are pulled toward the team. The rate posterior is
Gamma–Poisson (empirical Bayes):

```
λ_p | data ~ Gamma(α₀ + O, β₀ + E)        shown: posterior mean of λ_p and its 95% interval
```

- The prior comes from everyone in the same tenant and role.
- **Minimum sample.** Below 20 final-labelled runs in the window, the score is
  `insufficient-data` and is not shown.
- **Shrinkage still matters above the minimum.** A person with 25 runs is pulled toward the
  team average in proportion to their small expected count, rather than showing an extreme
  rate.
- **One interval rule.** The posterior interval is 95%, matching the inner funnel limit. The
  99.8% funnel limit is used only to call a point "outside limits".

**D14.5 Presentation.**
- **Funnel plot** (Spiegelhalter, 2005): standardized ratio against expected volume, with
  95% and 99.8% control limits. Only points outside the limits are called out.
- A ranked table is never the default view. When a table is shown, it is sorted by the
  posterior, with the interval drawn, and an "outside limits" flag.
- Every score links to the runs behind it and their deltas, so a manager can see *why*.
- The trend per person uses the D7 control charts: is this person's ratio drifting?
- **Surface.** A **People** view on the team (`dev_teams`) page, which is the only
  manager-to-reports structure. It is not the ticket "Sign-off & Accountability" tab
  (`AccountabilityTab.tsx`), which is per ticket. The manager agent reads the same scores
  through an application port for its coaching and stall-triage loop.
- The manager agent may use agent scores to route work and to coach. It may not act on a
  *human's* score automatically.

**D14.6 Access and audit.**
- **Reporting line.** Today's only reporting line is `dev_teams.manager_id` → contributors
  (`schema/canvas.ts:850`).
  - WS22 adds one application-layer policy, `mayViewPersonScore(viewer, subject)`.
  - It resolves a contributor to the user and agent identities that runs record. Where that
    mapping is missing, WS22 adds it as an id reference, not a copied table.
  - The server enforces the policy in the route. The frontend `RoleGate` only disables the UI.
  - `resolveMembership` (private in `gatewayAccess.ts:128`) is not reused for this; it answers
    a different question.
- **Who sees what:**
  - a person sees their own scores;
  - a manager sees their team's contributors;
  - a tenant admin sees everyone in the tenant;
  - superadmin sees nothing cross-tenant without the existing audited cross-tenant scope.
- Every view of another person's score is audit-logged (viewer, subject, time).
- **Human scoring is off by default for enterprise plans** and on by default for others.
  - A tenant admin can switch it on or off.
  - Enabling it on an enterprise tenant shows a DPIA notice: lawful basis, purpose limited to
    coaching and capacity, and the works-council consultation the tenant owns.
  - Agent scoring cannot be disabled.
- **Data-subject rights.**
  - A person can export their own scores, inputs and the audit rows about them (access).
  - On erasure, their person scores and person-feature values are deleted. Their identity in
    run roles is pseudonymized, so aggregate models are not invalidated. Audit rows keep the
    pseudonym.
- No automatic consequence follows from a human score: no blocking, no reassignment and no
  notification to others.

**D14.7 Done-checks.**
- [ ] A person with 3 runs shows `insufficient-data`. A person with 25 runs, all
      high-risk, does not come out worse than the team on raw size alone (a case-mix test).
- [ ] An approver whose runs all used a weak agent and model tier is not flagged when the
      agent is the cause (a case-mix test).
- [ ] A unit test on the case-mix feature schema enforces that it contains none of the scored
      person's identity or experience features.
- [ ] Erasure: after the person's erasure request, their scores and person features are gone
      and their run roles are pseudonymized.
- [ ] An enterprise tenant has human scoring off by default.
- [ ] A manager cannot see a non-report's score (an RBAC test), and each view writes an
      audit row.
- [ ] With the tenant setting off, every human-score endpoint returns 404 for that tenant.
      Agent scores are unaffected.

### D15. Adoption order

| Phase | Ships | Needs |
|---|---|---|
| P1 | D0 rule and guard, D1 labels pipeline, D2 deterministic statistics, D13 package | WS7 (the delta exists) |
| P2 | D3 rule precision, D4 calibration, D7 statistical process control | About 4 weeks of votes and runs |
| P3 | D5 risk model, survival view, D10.2 similar runs | At least 500 final-labelled runs (global) |
| P4 | D9 scheduling, D10.1 ranking | WS12 (the optional tier exists) and click data |
| P5 | D6 naturalness, D8 reliability growth | A logprob-capable local model; at least 10 runs per dimension |
| P2–P3 | D14 people scores: case-mix model, then views | WS16 labels; at least 20 final-labelled runs per scored person |

---

## 4. Contracts summary (new or changed)

| Contract | Package | Change |
|---|---|---|
| `FileFacts` v3 (`exports`, `calls`, `entryPoints`, `capabilityImports`, `testFacts`) | memory `/knowledge` (types), agent-tools (extractors) | Extended; `EXTRACTOR_VERSION = 3` |
| Stat manifest, Merkle directory hashes, git blob alternate keys | memory `/knowledge` `plan` | New |
| `FactStorePort` (objects, manifest transaction, derived, `canonicalDump`) | memory `/knowledge` (port only; stays Worker-safe) | New |
| Node fact-store adapter (`objects/` + `index.sqlite`) | VSIX and on-prem, on the G03 store (`localRecordTransaction.ts`) | Replaces the single snapshot file as the system of record. The snapshot becomes a projection. |
| `FactRule` (scope, reads, version) | memory `/knowledge` | Formalizes `findings.ts` and `codeFindings.ts` |
| `FindingIdentity` (`anchor`, `members`), lineage matcher | memory `/knowledge` | New. jscpd and knip ids migrate to it. |
| `comparability.ts` | memory `/knowledge` | Merges `compareAnalysis` and the baseline `comparable` |
| `RunDelta`, `DimensionRegistry`, `computeRunDelta`, `DeltaPorts` | `packages/run-delta` (new, pure) | New |
| Rule registries: guards, sources, sinks, sanitizers, I/O, weak crypto, perf, ilities, integrity | `packages/run-delta/src/registry/*` + `.builderforce/delta.json` overrides | New, data only |
| Analyzer adapters (osv, gitleaks, jscpd, knip, dep-cruiser, diagnostics, coverage, stryker, bench, SARIF import) | `packages/agent-tools/src/delta/adapters/*` | New; wrap existing executors |
| SARIF parse and emit | `packages/sarif` (new, source-only) | Extracted from api, plus export |
| `run-delta` local entity type | `packages/local-first` records | New union member |
| Capability visibility hook and context keys | `clients/vscode` + `packages/local-first` capability matrix | New. Replaces `signedIn` gating where it is not account-only. |
| `Prediction`, `RunFeatures` (versioned schema), `RunOutcomeLabel`, model artifact format | `packages/run-delta/src/predict/*` | New (Part D) |
| `run-outcome` local entity type | `packages/local-first` records | New union member |
| Statistics primitives | builderforce-memory `stats` module (`@seanhogg/builderforce-memory/stats`) on top of memory-engine `ml/classical` | New module, no new package. Holds only what `ml/classical` lacks, and absorbs the copies listed in D13. |
| Part D models | memory-engine `ml/tasks`: `run_risk`, `case_mix`, `finding_rank`, `check_scheduler`; `run_anomaly` extended | New task entries |
| Server tables | `run_deltas`, `run_delta_dimensions`, `run_delta_findings` (+ embedding in the 1024 space), `run_features`, `run_outcome_labels`, `person_score_views` (audit) | New, expand migrations, registered in `sweptTables.ts` |
| Verdict/predict layering guard | `scripts/check-run-delta-layers.mjs`, wired into `pnpm run check` and CI (WS15) | New |
| `signedIn` allowlist guard | `clients/vscode/scripts/check-signed-in-when.mjs`, wired into the VSIX check and CI (WS1) | New |
| Telemetry events | `delta.computed`, `delta.card_opened`, `delta.finding_action`, `index.level_ready`, `index.plan_ms`, `offline.session` (counted locally, sent with the next granted sync batch), `prediction.shown`, `person_score.viewed`; emitted through the existing entry-point-attributed telemetry, `surface` per host | New event names. The owner is the workstream that ships each emitter. |

## 5. Code map

```
builderforce-memory/packages/memory/src/knowledge/
  plan.ts                 + stat manifest, racy rule, Merkle dirs, git blob keys
  stores/factStorePort.ts NEW  port only (objects, manifest txn, derived, canonicalDump); no I/O here
  rules/factRule.ts       NEW  FactRule contract + incremental evaluator (trace + early cutoff)
  findings.ts             → rules/*.ts (one rule per file), findingIdentity.ts NEW
  lineage.ts              NEW  deterministic lineage matcher
  comparability.ts        NEW  (absorbs Builderforce agent-tools codeAnalysis.compareAnalysis)
  review.ts               analyzer failure recorded, never swallowed; level reporting
builderforce-memory/packages/memory/src/stats/          NEW  only what ml/classical lacks (D13)
builderforce-memory/packages/memory-engine/src/ml/classical/   logistic.ts (+L2, weights, IRLS), anomaly_composite.ts (+Mahalanobis)
builderforce-memory/packages/memory-engine/src/ml/tasks/       + run_risk, case_mix, finding_rank, check_scheduler; run_anomaly extended

Builderforce.ai/packages/
  run-delta/              NEW  pure: computeRunDelta, dimensions/, registry/, headline.ts, blastRadius.ts, sarifExport.ts
  sarif/                  NEW  source-only: parse (moved from api), emit
  agent-tools/src/knowledge/   extractors → tree-sitter queries (complexity, routes, entry points, capability, test facts)
  agent-tools/src/delta/adapters/  NEW  one adapter per analyzer; reuse prefetch checkExecutors
  knowledge-graph-view/src/delta/  NEW  RunDeltaCard, RunDeltaPanel, DimensionRow, DeltaTrend (presentational) + labels
  local-first/src/records.ts       + 'run-delta', 'run-outcome'
  run-delta/src/predict/           NEW  features.ts, labels/ (szz.ts, revert.ts, ci.ts, review.ts), risk.ts, survival.ts,
                                        captureRecapture.ts, anomaly.ts, rulePrecision.ts, naturalness.ts, ranking.ts,
                                        similarRuns.ts, scheduler.ts, trends.ts, reliabilityGrowth.ts, models/ (artifacts)
  (no packages/stats — the maths is in builderforce-memory, D13; prefetch calibrate.ts, learned-routing exploration.ts,
   difficulty-router head.ts, pipeline-route score.ts, knowledge-graph-view layout3d RNG migrate there)
  sarif/ registered in scripts/check-source-package-graph.mjs aliasing for api and agent-tools

Builderforce.ai/clients/vscode/src/
  knowledge/backgroundIndexer.ts   NEW  watcher + reconcile + priority scheduler (B2, B6)
  knowledge/knowledgeService.ts    linked = selected ∧ session ∧ synchronize (A2)
  knowledge/factStoreAdapter.ts    NEW  FactStorePort on localRecordTransaction (G03) at .builderforce/cache/ (B4)
  knowledge/knowledgeStores.ts     reads through the port; one-time import of .builderforce/knowledge/*.json (B4 migration)
  power/powerSource.ts             NEW  OS power-source query, cached (B6)
  package.json                     engines.vscode ^1.101.0; configurationDefaults watcher/search excludes
  runDelta/runDeltaHost.ts         NEW  DeltaPorts over the fact store, pre-images, before-tree export
  runChangeBaseline.ts             + dirty pre-image capture (C1.3)
  brainRunHostPorts.ts             finalize → computeRunDelta → card
  codebaseScan.ts                  → projection of the fact store (B9); scan.json + versionToken deleted
  capabilityContext.ts             NEW  capability → context keys (A1)
  installRunChangeSets.ts (+ installRunChangeSets.test.ts), runChangeSetRecorder.ts   DELETE (zero production references, verified first)
  l10n/bundle.l10n.*.json, package.nls.*.json   VSIX strings for new commands/settings, all locales (plus webview labels.ts catalogs)

Builderforce.ai/api/
  src/domain/security/scanReportParsers.ts   SARIF parsing moves to packages/sarif
  run delta persistence + importer            (WS11, Opus-reviewed)
  run outcome labels: SZZ/revert/CI/review label jobs over the ops DB (WS16, Opus-reviewed)
  scripts/train-run-models.cjs               offline training driver → digest-named model artifacts (WS18)
  application/people/mayViewPersonScore.ts   the ONE person-score visibility policy (WS22)
  application/maintenance/sweptTables.ts     + retention rows for the new tables (WS11, WS16, WS22)
```

No module in this map may grow past about 400 lines. Dimensions, rules and adapters are one
file each, registered as data.

## 6. Sequences

**Open a folder, offline.**
activate (policy `local-only`) → `backgroundIndexer.start(root)` → reconcile plan, using the
stat prefilter and the git fast path → L0 published → visible and open files extracted (L1)
→ visualizer opens on `localSession` and renders L0/L1 → L2 rules → L3 analyzers from the
bundled tools → snapshot projection → codebaseScan projection files written. Zero
platform requests.

**Edit a file.**
watcher event → 100 ms coalesce → stat changed → hash → facts changed?
- No (early cutoff): done.
- Yes: file rules → neighbourhood rules for 1-hop neighbours → global rules whose read kinds
  changed → derived traces updated → visualizer receives the changed nodes and findings.

**Agent run.**
run start → `runChangeBaseline` (+ dirty pre-images) → the indexer keeps running → run ends →
`recordChangeSetAroundRun` finalizes → `computeRunDelta`:
1. Resolve before facts (C1 steps 1–3).
2. Compute the impact set.
3. Run the static rules per dimension.
4. Run L3 analyzers on the after side, and on the before side via cache or the materialized
   tree.
5. Match lineage.
6. Apply comparability.
7. Compute verdicts, the headline and the blast radius.

Then the card is posted to the chat in "measuring" state and filled as each analyzer settles.
After that: an optional narrative, then the delta is stored as a local record, with sync if
granted. A policy check on autonomous runs can then block finalization.

## 7. Workstreams

The loop for every workstream: a Sonnet subagent at medium effort implements → a Haiku
subagent verifies (targeted typecheck, guards, the named test files) → review → fixes. Review
goes to an **Opus** subagent at medium effort where marked; otherwise Sonnet.

| WS | Scope | Depends on | Review |
|---|---|---|---|
| WS1 | **Offline closure** (A1–A5): capability hook and context keys plus the `signedIn` allowlist guard; linked-means-granted; bundled analyzers (with `typescript@5.6.3`, size measured before and after); both `maybeScan` early returns removed; visualizer capability-first checks; `engines.vscode ^1.101.0`; delete the two unreferenced change-set files and the test; VSIX l10n bundles | — (runs in parallel with WS2) | Sonnet |
| WS2 | **Change detection + fact store** (B2, B4): EOL-normalized hashing, BigInt stat manifest, racy rule, Merkle, git blob hints and multi-root (memory `plan`); `FactStorePort` in memory; the Node adapter on the G03 `localRecordTransaction` store (wires G03); `.builderforce/cache/.gitignore`, watcher and search excludes; the object sweep; migration of `.builderforce/knowledge/*` for the VSIX, knowledge index, on-prem and `uploadLocalSnapshot`; `canonicalDump`. Publish memory and bump the pin. | — | **Opus** (storage format) |
| WS3 | **Background indexer** (B6): watcher, reconcile, priority scheduler, levels, budgets, pause rules, the `powerSource` port, level status to the visualizer, `index.*` telemetry | WS2 | Sonnet |
| WS4 | **Extraction v3 + rules** (B3, B5): tree-sitter queries for complexity, routes, entry points and guard chains, capability imports, test facts; fact kinds (`structure`, `body`, `content`); composite `EXTRACTOR_VERSION` including grammar versions; WASM parser in the worker; `FactRule` evaluator with `reads` and `hops`; the existing findings ported to rules; the determinism oracle over `canonicalDump` (B8.6), including an autocrlf fixture | WS2 | Sonnet |
| WS5 | **Consolidation** (B9): codebaseScan as a projection; repo-map `FileFacts` convergence; VSIX stops importing the repo-map extract. Existing tests run unchanged. | WS3, WS4 | Sonnet |
| WS6 | **Finding identity v2, lineage, comparability** (C3, C9): `unusedCodeRule` split per item; anchor-kind and minimum-member rule; jscpd and knip ids migrated; `compareAnalysis` plus `CodeAnalysisSnapshot` types moved to memory; the VSIX baseline `comparable` | WS4 | **Opus** (cross-package) |
| WS7 | **run-delta core** (C1, C2, C4, C10): full-sha256 baseline, pre-images, before-tree export, edge cases, the in-house rename matcher, attribution filter, impact set, verdicts, headline, blast radius, quantized digest property test; **the autonomous-run block policy (§12.5)**; `delta.computed` telemetry | WS6 | **Opus** (cross-package, storage) |
| WS8 | **Security dimension** (C5): guard, source, sink and sanitizer registries, taint-lite, capability delta, osv and gitleaks adapters, config rules, STRIDE template; the `guard-removed` block wired into the WS7 policy | WS7, and WS4 entry-point and guard-chain facts | **Opus** (security) |
| WS9 | **Performance, -ilities and quality dimensions** (C6.1, C7, C8.1–C8.3), as one Sonnet brief per dimension; the C8.2 integrity block wired into the WS7 policy | WS7, and WS4 `testFacts` | Sonnet |
| WS10 | **Presentation** (C11): card, panel, history and trend, on VSIX and web; localization in all catalogs; both themes; 360 px | WS7 | Sonnet |
| WS11 | **SARIF package** (C12), registered in `check-source-package-graph`, with an adapter from `NormalizedFinding` to `DeltaFinding`; plus persistence and sync (C14): the `run-delta` record, the mirror importer, the `run_deltas`, `run_delta_dimensions` and `run_delta_findings` expand migration, the 1024-space embedding registered in `MEMORY_VECTOR_SPACES`, and `sweptTables` retention | WS7; G15–G18 | **Opus** (migration, storage) |
| WS12 | **Optional dynamic tier** (C6.2, C8.4): benchmark runner, Wilcoxon signed-rank statistics, diff coverage, Stryker incremental | WS9 | Sonnet |
| WS13 | **Packaged offline acceptance** (A6) and cloud-run delta (C14) | WS1–WS10 | Sonnet |
| WS14 | **Local-first visualizer** (A7): linked reviews write the local store first and sync as a replica; the host computes cut, outline, roll-up and data coverage from the local projection; Sync shows two real counts; one-time seed from the server via the PRD 40 import path; the A7 network-denied map-digest test. Does not wait for WS2: it uses today's local snapshot store and moves to B4 segments when WS2 lands | WS1 (A2) | Sonnet; Opus review (storage, sync) |
| WS15 | **builderforce-memory `stats` module and deterministic statistics** (D13, D2, D0 guard): only what `ml/classical` lacks; `ml/classical` extended in place; migrate and delete every copy listed in D13, with their tests unchanged; `check-run-delta-layers` wired into `pnpm run check` and CI | — (pure maths, in parallel) | Sonnet |
| WS16 | **Labels pipeline** (D1): the run-outcomes context as one owner; `RunFeatures` frozen at run end; per-run commit attribution (VSIX git API, `cloudFinalize`), closing the per-task `runCommitMarker` defect; SZZ, revert, CI and review labellers; censoring; point-in-time features and the leakage guard; consent-scoped training store. Local records start with WS7; the server tables follow WS11. | WS7 (server half: WS11) | **Opus** (storage, privacy, cross-package) |
| WS17 | **Rule precision, calibration, process control and reliability growth** (D3, D4, D7, D8) | WS15, WS16 | Sonnet |
| WS18 | **Run risk model** (D5): training driver, rolling-origin validation, artifact format, quantized inference, the replace-`v1` gate, Kaplan–Meier view, model cards and drift (D12) | WS16 with at least 500 final labels | **Opus** (model governance, storage) |
| WS19 | **Naturalness** (D6), on the prefetch logprob seam | WS15 | Sonnet |
| WS20 | **Thompson scheduling and SPRT** (D9) | WS12, WS15 | Sonnet |
| WS21 | **Ranking and similar runs** (D10), plus the card's Predicted block (D11), localized | WS10, WS16 | Sonnet |
| WS22 | **People scores** (D14): role attribution; the contributor-to-identity mapping; `mayViewPersonScore`; the `case_mix` model (its own, not WS18's); Gamma–Poisson shrinkage; funnel plot and table on the team People view; audit; enterprise default-off with the DPIA notice; access, export and erasure; `person_score.viewed` telemetry. Localized; both themes; 360 px. | WS16 | **Opus** (auth/RBAC, privacy) |
| WS23 | **Review run view and parallel review** (A8): memory — per-file extraction failure is a step not a fatal error, `extractPool` port, N-wide judging with one ordered writer, `onStep` events, byte-equal parallel vs sequential test; host — `worker_threads` extract pool (its own esbuild worker entry), `ReviewRun` recorder and `runs/` persistence, `run` events, Retry; view — Run panel (`SlideOutPanel`), history, localized, both themes, 360 px | — (ships with WS14) | Sonnet; Opus review (concurrency, storage) |
| WS14 | **Ship.** This is a new capability, so: a `release_notes` row (category `new`); an Idea-to-Real blog post on the template in `frontend/src/content/blog/run-your-app-on-the-canvas.md`, placing the delta in the **Measure** act of the arc (proof that a run made things better, not just different); DONE.md moves by section number. | WS10, WS13 | Session model |

Version bumps and ROADMAP/DONE entries stay with the session model.

## 8. Done-checks

**Part A**
- [ ] The packaged VSIX passes A6 with egress denied: zero BuilderForce and zero npm requests.
      The graph renders, a local-model run completes and a delta appears.
- [ ] Signed out with a persisted project selection, a review completes on the local store
      (regression test for `NOT_SIGNED_IN`).
- [ ] No view or command uses `builderforce.signedIn` except account-only ones, as listed in
      the capability table. A guard script fails on a new `signedIn` `when` clause outside an
      allowlist.

**Part B**
- [ ] Warm plan of the `agentic` tree takes under 3 s; cold plan in git under 30 s.
- [ ] Saving one file in a 16k-file tree: p95 under 200 ms to updated L1/L2 facts for that
      file. Global rules are skipped when the read fact kinds did not change (asserted by a
      trace test).
- [ ] Determinism oracle (B8.6): the `canonicalDump` of the incremental store equals the
      scratch build and equals a second OS (Windows with autocrlf), byte for byte, over 500
      seeded edit sequences.
- [ ] A body-only edit reruns `body`-reading rules (for example `io-in-loop`) and skips
      `structure`-only rules (a trace test).
- [ ] The repo's own `.gitignore` is untouched, and `.builderforce/cache/.gitignore` contains
      `*`.
- [ ] `scan.json` and its version token are gone. `codebaseScan` tests pass unchanged against
      the projection.
- [ ] An analyzer failure shows as `not_measured` with a reason, never as zero findings.

**Part C**
- [ ] A clone group gaining a member reads as `changed (grew)`, not resolved plus introduced.
- [ ] A fixture run that removes `requireAuth` from a route gives security `worse` with
      `guard-removed` and the route key in evidence.
- [ ] A fixture run that adds `.skip` to a test and loosens a matcher gives quality `worse`
      with the headline "tests were weakened".
- [ ] A fixture run that adds an awaited DB call inside a `.map` gives `io-in-loop`.
- [ ] A fixture run that changes an exported signature gives `ilities.compatibility`
      `api-breaking`.
- [ ] An analyzer version bump between sides makes that kind `not_comparable` and emits no
      introduced or resolved entries.
- [ ] The same before/after on Windows and Linux CI gives the same `RunDelta.digest`.
- [ ] SARIF export validates against the 2.1.0 schema, and `baselineState` round-trips through
      import.
- [ ] Static tier p95 under 10 s for runs touching 50 files or fewer on the `agentic` tree.
      The card shows "measuring" rows until L3 settles.
- [ ] Card and panel are localized in 5 catalogs, readable in both themes and free of
      horizontal overflow at 360 px.

**Part D**
- [ ] `check:run-delta-layers` fails when any `verdict/` file imports `predict/`. A fixture
      shows a high predicted risk leaving every verdict unchanged.
- [ ] The same features and model artifact give a byte-identical `Prediction` on Windows and
      Linux CI, offline.
- [ ] Below the data threshold, every model returns `insufficient-data` and the card shows
      nothing for it.
- [ ] The leakage guard fails a fixture feature that reads data later than `finalizedAt`.
- [ ] SZZ labeller: on a fixture history with a known fix-inducing run, that run gets
      `followup-fix`. A comment-only later edit does not.
- [ ] Chapman estimate: unit tests against textbook values. `m < 3` gives
      `insufficient-data`.
- [ ] Rule precision: a rule with 3 votes is never demoted. A rule with 200 votes at 30%
      precision is demoted, and its per-repo posterior shrinks toward the global one.
- [ ] Risk model replaces `v1` only when it passes the D5.3 gate. The gate result is
      recorded in the model card.
- [ ] `prefetch/calibrate.ts` and the learned-routing sampler import from `@seanhogg/builderforce-memory/stats`.
      No second implementation remains (grep check). Their existing tests pass unchanged.
- [ ] The SPRT stops early on a fixture with a 20% regression, and runs to the maximum on a
      no-change fixture.

## 9. Non-goals

- Full-precision inter-procedural taint analysis or symbolic execution. Taint-lite is a
  heuristic signal. Deep analysis comes in through SARIF from Semgrep or CodeQL when
  installed.
- Running the project's full test suite or build by default. The dynamic tier is opt-in or
  policy-driven.
- Proving functional correctness. The delta reports measured change, not whether the feature
  is right. Acceptance evidence (PRD 23/37) stays the place for that.
- Replacing the knowledge review's docs judgement. L4 is unchanged except for caching and
  capability gating.

## 10. Measure

- **Use.**
  - The share of runs that produce a delta, by entry point: VSIX, cloud, web.
  - Delta cards opened, and panel opens per card.
  - Offline sessions, meaning sessions with the platform denied for their whole life. These
    are counted locally and reported in the next granted sync batch.
- **Value.**
  - Fix-with-agent clicks from delta findings, and the share that resolve the finding in the
    follow-up run's delta.
  - Introduced error-level findings caught per 100 runs, split by dimension.
  - Autonomous runs blocked by policy that were later confirmed as correct blocks.
  - Integrity findings (C8.2) per 100 autonomous runs, trending down as prompts and policies
    adapt.
- **Precision.** The Beta posterior precision per rule (D3). Demotion and restoration follow
  its credible bounds, and demoted rules are listed for rework.
- **Prediction quality.** For each model:
  - Brier score, ECE and PR-AUC on the trailing 30 days;
  - Popt for run risk;
  - NDCG@5 for ranking;
  - coverage of the KM interval;
  - PSI drift.

  Report also the share of verdict-changing optional checks the scheduler ran versus random
  scheduling, and the count of labelled runs per week, which gates P3.
- **Cost.**
  - Plan time.
  - Per-save update latency.
  - Indexer CPU share.
  - Delta p50/p95 per tier.
  - Cache hit rate for extract, rules and analyzers.
  - Pre-image bytes per run.
- **Kill condition.** After 8 weeks, if fewer than 15% of delta cards are opened **and**
  "mark as wrong" exceeds 30% across rules, cut the scope back to quality and integrity (C8)
  plus security `guard-removed`, `secret` and `capability-added`. Retire the rest.
- **Kill condition for Part D.** Each model stands or falls on its own:
  - **Run risk:** if it has not passed the D5.3 gate after 2,000 final labels, retire it and
    keep `v1`.
  - **Ranking:** if it does not beat severity-then-centrality ordering on NDCG@5 after 8
    weeks, retire it.
  - **Naturalness:** if fewer than 5% of "unusual" lines appear in later `followup-fix` blame,
    retire it.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Bundled analyzers inflate the VSIX | Measure the size delta in WS1. Bundle only the analyzers' production dependencies, tree-shaken, and lazy-load them at L3. |
| The cache in the repo directory loads watchers and git | `.gitignore` entry, `configurationDefaults` for `files.watcherExclude` and `search.exclude`, own watcher ignore (B4) |
| People scores are unfair or misused | D14: case-mix standardization, shrinkage, intervals and funnel limits, RBAC with audit, the tenant switch, no automatic consequences for humans |
| Heuristic security and performance rules cause noise, and people stop reading the card | `confidence: heuristic` with ≈; per-rule precision metric with automatic demotion; waivers persist |
| Pre-image capture of large dirty trees costs disk | Caps (1 MB per file, 50 MB per run); retention until the delta is final plus 14 days; content-addressed dedupe |
| Background indexing slows typing (see the open slow-typing gap) | Worker thread, 50 ms slices, yield on keystroke, render-count test on the composer before WS3 ships |
| Determinism breaks through a dependency's nondeterministic output order (jscpd, knip) | Every adapter sorts and canonicalizes its output; the oracle test includes analyzer outputs |
| Two extractor families (Worker regex, Node tree-sitter) diverge | The `extractor` tag is part of comparability; Worker and VSIX deltas never cross-compare |
| Predictions are read as verdicts | D0: separate block, "predicted"/≈ wording, no verdict colours, layering guard |
| Labels are noisy (SZZ misattributes; reverts for non-defect reasons) | Facts-hash early cutoff drops cosmetic lines; label kinds kept separate; models report per-label metrics; Kaplan–Meier is used where censoring dominates |
| Too few labels for a repo | Hierarchical shrinkage to a global prior; `insufficient-data` rather than a guess; consent-scoped cross-tenant pooling (§12.8) |
| Feedback loop: ranking hides findings, so they never get labels | Inverse propensity weighting; 10% of card slots are deterministic exploration chosen by seeded order |
| Delta policy blocks legitimate autonomous work | Policy is per-project data; blocks are overridable with an audited waiver (managed-board authority rule) |

## 12. Operator decisions (taken 2026-11-06)

1. **Analyzer distribution: bundle** dependency-cruiser, jscpd and knip in the VSIX, with the
   TypeScript version they pin. There is no download fallback.
2. **Fact store location: the repo directory**, `.builderforce/cache/`, with the gitignore,
   watcher and search exclusions in B4. VS Code's `storageUri` has no I/O advantage; its only
   gain was keeping watcher load away, and the exclusions provide that.
3. **Auto-index on open: on.** L0–L2 always; L3 when idle and on mains power.
4. **Signed-out views:** `health` and `evermind` run on local data behind capability keys.
5. **Autonomous-run policy:** C8.2 errors and `guard-removed` block finalization of an
   autonomous run. Everything else is advisory. Interactive runs are never blocked.
6. **Server persistence: tables with vectors.** `run_deltas` and `run_delta_findings`, plus
   pgvector columns (C14).
7. **Engine floor:** `engines.vscode` rises to `^1.101.0`. G03 is unblocked, and WS2 uses
   SQLite from the start.
8. **Cross-tenant training:** opt-in. Default off for enterprise plans, on for free plans,
   stated in the privacy terms.
9. **People are scored** (managers need it). Person and experience features are allowed in
   the D5 risk model, and D14 defines the fair scoring method:
   - risk-adjusted;
   - shrunk toward the team;
   - shown with intervals;
   - RBAC with audit;
   - a tenant switch for human scoring, off by default for enterprise plans (EU and
     works-council alignment, confirmed by the operator 2026-11-06);
   - data-subject access and erasure;
   - no automatic consequences for humans.
10. **Label windows:** 30 days for `followup-fix` and `reverted`, 7 days for CI.

No decisions remain open. A new one found during implementation is added here.

## 13. Methodology references

- Local-first software — Kleppmann, Wiggins, van Hardenberg, McGranaghan (Ink & Switch, 2019).
- *Build Systems à la Carte* — Mokhov, Mitchell, Peyton Jones (ICFP 2018): verifying traces,
  early cutoff.
- Salsa / rust-analyzer; rustc red-green incremental queries.
- Merkle trees; git's index and the racy-git problem.
- tree-sitter incremental parsing; GitHub stack graphs (file-incremental name binding); SCIP.
- Datalog semi-naive evaluation; DRed (deletion and re-derivation); CodeQL and Meta Glean as
  fact-plus-rule code models.
- Tarjan's SCC; PageRank for code centrality (as in Aider's repo map).
- Attack-surface metric — Manadhata and Wing (IEEE TSE 2011); STRIDE (Microsoft threat
  modelling); taint analysis (source, sink, sanitizer).
- ISO/IEC 25010:2023 product quality model.
- Robert C. Martin's package metrics (Ca, Ce, instability, abstractness).
- Change coupling and hotspots — Tornhill, *Your Code as a Crime Scene*; Gall et al. on
  logical coupling.
- Wilcoxon signed-rank test, paired Hodges–Lehmann estimator, paired bootstrap CIs for
  interleaved benchmark comparison.
- Mutation testing (StrykerJS incremental mode).
- SARIF 2.1.0 (OASIS): `baselineState`, `partialFingerprints`.
- Just-in-time defect prediction — Kamei et al. (IEEE TSE 2013); McIntosh and Kamei (TSE 2018);
  effort-aware evaluation (Popt).
- SZZ — Śliwerski, Zimmermann and Zeller (MSR 2005).
- Change entropy — Hassan (ICSE 2009).
- Naturalness — Hindle et al. (ICSE 2012); Ray et al., "On the Naturalness of Buggy Code"
  (ICSE 2016).
- Maintainability Index — Oman and Hagemeister (1992); Halstead (1977).
- Capture–recapture — Lincoln–Petersen; Chapman (1951); its use in software inspection by
  Eick et al. (1992).
- Goel–Okumoto NHPP software reliability growth (1979).
- Beta–Binomial, empirical Bayes and hierarchical shrinkage — Efron and Morris.
- Platt scaling (1999); isotonic regression (Zadrozny and Elkan 2002); Brier score; ECE
  (Guo et al. 2017).
- Kaplan–Meier (1958) with Greenwood's variance; Cox proportional hazards (1972).
- EWMA (Roberts 1959); CUSUM (Page 1954); Bayesian online change-point detection (Adams and
  MacKay 2007).
- Mahalanobis distance; Ledoit–Wolf shrinkage (2004); population stability index.
- Thompson sampling (1933; Agrawal and Goyal 2012); Laplace approximation for Bayesian logistic
  regression.
- Wald's sequential probability ratio test (1945).
- Indirect standardization (standardized mortality ratio); Garwood exact Poisson intervals;
  funnel plots for institutional comparison — Spiegelhalter (Statistics in Medicine, 2005);
  Gamma–Poisson empirical Bayes.
- Pairwise learning to rank (RankNet, Burges 2005); unbiased LTR with inverse propensity
  weighting (Joachims et al. 2017); NDCG.
