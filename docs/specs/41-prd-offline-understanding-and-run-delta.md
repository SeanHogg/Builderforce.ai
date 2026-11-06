# PRD 41 — Offline understanding and the run delta

| | |
|---|---|
| Status | Design for review. No code started. This document is the end state to build against; get review before any workstream starts. |
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
| Code-pack analyzers: dependency-cruiser 16.10.4, jscpd 4.0.5, knip 5.30.0 and the repo-map file graph | `AT/codeAnalysisTool.ts:9-11`, `AT/knowledge/codeAnalyzers.ts:29-38` | Built. They are **downloaded via `npm exec --yes` on first use** (`codeAnalysisTool.ts:62`), whole-repo, and a failure is swallowed (`BM/review.ts:242-257`). |
| Findings: cycle, clone-group, near-duplicate, partition-violation, unpartitioned, stale, plus unused-file, unused-export and unused-dependency for code | `BM/findings.ts:78-146`, `AT/knowledge/codeFindings.ts:28-52` | Built |
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
| `VS/codebaseScan.ts` | Walks the workspace and writes `.builderforce/{context.yaml, project-map.md, architecture.md, README.md, memory/, scan.json}`, plus one `routeComplete` overview (`:278-294`) | One `versionToken` over the whole workspace (`:155-165`), so any edit invalidates everything. The LLM overview is the only non-deterministic part. `maybeScan` returns early when there is no key and the route needs sign-in (`VS/extension.ts:1691`). |
| `packages/repo-map` | Regex facts plus a file graph, serialized for the R2 cache | A second extractor beside the knowledge code pack. It runs in Workers, where there is no parser. |
| Knowledge review (code pack) | The canonical, incremental pipeline in §3.1 | Starts only from `/review` (`VS/knowledge/knowledgeCommands.ts:86`) |

### 3.6 Signed-out gaps found

| Gap | Where |
|---|---|
| A selected project persisted while signed out makes every knowledge call throw `NOT_SIGNED_IN`. "Linked" means a project was selected; it does not mean signed in. | `VS/knowledge/knowledgeService.ts:64-75`, `VS/projectState.ts:20-21` |
| Analyzers download from npm on first use and fail with no network | `AT/codeAnalysisTool.ts:62` |
| The `work`, `inbox`, `health` and `evermind` views are hidden until sign-in | `clients/vscode/package.json:100,105,114,120` |
| The workspace scan is skipped with no key | `VS/extension.ts:1691` |
| `installRunChangeSets.ts` and `runChangeSetRecorder.ts` have no references. Their "not referenced" comments are stale against `brainRunHostPorts`. | `VS/installRunChangeSets.ts:4-5`, `VS/runChangeSetRecorder.ts:15-16` |

---

## Part A — Offline VSIX

### A1. Capability states, not a login gate

The extension's capabilities are a product of the platform policy (`packages/local-first`
capability matrix, G01/G21) and what is installed locally:

| Capability | Signed out, offline | Signed in, sync off | Signed in, sync on |
|---|---|---|---|
| Understand folder (L0–L3, §B6) | ✔ | ✔ | ✔ |
| Visualizer, graph, findings, compare | ✔ (local board) | ✔ | ✔ (+ server board) |
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
directory. Versions stay pinned in one place, `codeAnalysisTool.ts`, and are reported in each
analysis record so comparability (C9) can check them.

If bundling makes the VSIX too large (Open decision §12.1), the fallback is a one-time
**analyzer pack** download into `globalStorage`, triggered when the person is online. Until
it exists:
- each missing analyzer's findings are `not_measured` with the reason `analyzer-not-installed`;
- a missing analyzer is never shown as zero findings.

### A4. The scan never needs a key

`maybeScan` always runs the deterministic part. Only the optional narrative needs a model
route (§B9). With no route, the overview section is omitted and marked
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

## Part B — Incremental, deterministic understanding

### B1. Model: a content-addressed fact graph with early cutoff

Understanding is a **build system over facts**, in the sense of *Build Systems à la Carte*
(Mokhov, Mitchell, Peyton Jones 2018) and Salsa/rustc red-green queries:

- **Inputs** are files, identified by content hash.
- **Per-file queries** run as `extract(fileHash, extractorVersion) → FileFacts`. They are
  pure and cached by key. This already exists (§3.1).
- **Cross-file queries** derive facts such as `resolveImports`, `fileGraph`, `layers` and
  `findings`. Their inputs are the *fact hashes* of the files they read, not the file hashes.
- **Early cutoff.** If an edit changes a file's bytes but not its `FileFacts` hash (a comment,
  whitespace, a body edit that keeps imports and symbols), no cross-file query reruns.
- **Verifying traces.** Each derived result stores the hashes of the inputs it read. It is
  valid while those hashes are current. No dirty flags propagate through the store, so the
  store can be thrown away and rebuilt to the same bytes.

### B2. Change detection: Merkle tree plus a stat prefilter

Planning today hashes every file (329 s for 16.7k files). That cost goes:

1. **Stat manifest.** `(path, size, mtimeNs, ino/fileId)` per file, persisted with the plan
   manifest. A file whose stat tuple is unchanged reuses its stored hash without being read.
2. **Racy-file rule** (from git's index): if a file's `mtime` is within 2 s of the manifest's
   write time, it is re-hashed on the next plan, whatever its stat says.
3. **Git fast path.** In a git repo, `git ls-files -s` plus `git status --porcelain=v2 -z`
   give blob ids for tracked, clean files without reading them. A blob id is stored as an
   alternate key (`git:<sha1>`) beside the sha256 content hash, so the cache is shared across
   branches and clones.
4. **Directory Merkle hashes.** A directory's hash is sha256 over its sorted
   `(name, kind, childHash)`. An unchanged directory hash skips the whole subtree, and two
   roots compare in O(changed).
5. **Watcher plus reconcile.** A `FileSystemWatcher` feeds a coalescing queue (100 ms debounce,
   path dedupe). Watchers drop events, so activation and every window refocus run a
   **reconciling plan** (steps 1–4) that catches whatever was missed.

**Target:** a warm plan of the `agentic` tree in under 3 s; a cold plan in git under 30 s.

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
does not suit continuous indexing. The store becomes:

```
<storageUri>/knowledge/<rootId>/
  objects/<aa>/<sha256>.json     # FileFacts and analyzer outputs, immutable, content-addressed
  manifest.json                  # path → {stat, sha256, gitBlob?, factsHash}; written atomically
  derived/<queryId>.json         # cross-file query results + their input-hash trace
  snapshot.json                  # the PRD 38 KnowledgeSnapshot, now a projection rebuilt from the above
```

- Writes use the existing `atomicWrite` and `renameDurably` (`packages/local-first`).
- Objects are write-once, so a crash leaves at worst an unreferenced object, which a sweep
  removes.
- The `KnowledgeSnapshot` and PRD 40 portable pack formats do not change. Both are
  projections of the store.
- **Location.** The cache moves from the workspace's `.builderforce/` to VS Code's
  workspace `storageUri`, so it is never committed. `.builderforce/` keeps only
  human-facing outputs (B9).
- When G03 (SQLite) unblocks, `manifest.json` and `derived/` move into it. `objects/` stays
  file-based.
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
- **`neighbourhood` rules** (for example "a route lost its guard") recompute for the changed
  files plus their 1-hop graph neighbours.
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
2. Canonical JSON uses sorted keys, with no floats in identities (scores are quantized as in
   the [knowledge index](../design/deterministic-knowledge-index.md)).
3. Every cache key includes extractor, rule and tool versions. Wall-clock time and mtime never
   appear in an output. mtime is only a hint to skip hashing (B2).
4. Each computation runs against one manifest generation. A result built from mixed
   generations is discarded.
5. Community detection and layout use fixed seeds, and nodes are visited in sorted order.
   PageRank-style centrality uses power iteration with a fixed iteration cap and tolerance
   over sorted nodes.
6. **The oracle test.** For a fixture repo and random sequences of edits, renames and deletes
   (property-based, seeded), the following three must be byte-identical:
   - the store after the incremental updates;
   - a from-scratch build;
   - a from-scratch build on a second OS in CI.

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

**Renames.** Paths are mapped before diffing using git's rename detection
(`git diff -M50% --name-status`) or, without git, content-hash equality plus a token-set
similarity of at least 0.5.

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
3. Same `kind`, with a member-set Jaccard of at least 0.5. Pairs are matched greedily by
   descending Jaccard, then ascending ids: `changed`.
4. Remainder: `introduced` (after only) or `resolved` (before only), subject to C9.

The jscpd and knip issue ids in `AT/codeAnalysis.ts:36-47` adopt the same `anchor` scheme,
so the web analysis compare and the knowledge compare share one identity. Their two
implementations collapse into one in the memory package.

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
  significance?: { method: 'mann-whitney' | 'none'; p?: number; ci?: [number, number] };
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
- **Mann–Whitney U** with a Hodges–Lehmann shift estimate and a bootstrap 95% CI.
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
  the expand/contract migration rule. The proposed shape is one `run_deltas` row per run
  (digest, headline, dimension verdicts as columns) plus `run_delta_findings` rows (anchor,
  dimension, rule, severity, lineage), so trends query without JSON scans (3NF). Evidence
  stays a blob in R2, keyed by digest.

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

**Features are frozen at run end.** A `RunFeatures` vector (versioned schema) is stored with
the delta:
- **Size:** lines added and deleted, files touched.
- **Spread:** change entropy (D2.1).
- **Structure:**
  - centrality sum and max of the touched symbols;
  - entry points reached;
  - layers touched;
  - cross-partition edges changed.
- **History:**
  - churn over 90 days of the touched files;
  - count of past follow-up fixes in those files;
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
- No code, no paths in the trained artifact, and no person-level features (§12.9).

**Outcome labels** (`RunOutcomeLabel`, one row per run and label kind):

| Label | How it is derived | Window |
|---|---|---|
| `reverted` | A later commit reverts the run's commit, or more than 50% of the run's added lines are deleted | 30 days |
| `followup-fix` | **SZZ** (Śliwerski, Zimmermann, Zeller):<br>1. For each later *fix* change, blame the lines it modifies at its parent.<br>2. A fix is a bug-type ticket, a commit message matching the fix registry, or a run started from a delta finding's *Fix with agent*.<br>3. Lines whose facts-hash did not change (comments, whitespace) are ignored, using B1 early cutoff.<br>4. Blamed lines map back to the run through `runCommitMarker` and the run's change set. | 30 days |
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
- taint-lite × Semgrep (security);
- knip × the `unused-export` rule;
- jscpd × `near-duplicate`.

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

**D2.5 Run anomaly score.** The Mahalanobis distance of the run's standardized `RunFeatures`
from the repo's past runs:

```
d² = (x − μ)ᵀ Σ̂⁻¹ (x − μ)
```

- `Σ̂` is the Ledoit–Wolf shrinkage covariance, which stays stable with few runs.
- A run is flagged "unusual for this project" when `d² > χ²₀.₉₉(k)`, with *k* the number of
  features.
- The top contributing features explain the flag.
- It needs at least 30 past runs.

### D3. Bayesian rule precision (replaces the fixed demotion threshold)

Each rule *r* has precision `θᵣ ~ Beta(α₀, β₀)`.
- **Prior.** Fitted by empirical Bayes (method of moments) across all rules of the same
  family and all consenting tenants. This is hierarchical shrinkage, which solves the cold
  start for a new rule or a new repo.
- **Votes.** `finding-actioned` or `finding-waived` counts as a true positive (TP);
  `finding-marked-wrong` counts as a false positive (FP).
- **Posterior:**

  ```
  θᵣ | data ~ Beta(α₀ + TP, β₀ + FP)       E[θᵣ] = (α₀ + TP) / (α₀ + β₀ + TP + FP)
  ```

- **Demote** to `info` when the upper 90% credible bound falls below 0.6. **Restore** when the
  lower bound rises above 0.8.
- The bounds come from the regularized incomplete beta inverse, computed deterministically.
- This replaces §10's fixed "20% for 2 weeks" rule. A rule with 3 votes no longer moves; a
  rule with 300 moves as soon as the evidence says so.
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
`packages/stats` (D13), and prefetch imports it from there. The two do not keep separate
copies.

### D5. Run risk: just-in-time defect prediction

**D5.1 Model.** Regularized logistic regression (Kamei et al., 2013; McIntosh & Kamei, 2018):

```
P(followup-fix ∨ reverted | x) = σ(wᵀz + b),   z = (x − μ) / s   (stored scaler)
loss = −Σ [yᵢ log pᵢ + (1 − yᵢ) log(1 − pᵢ)] · cᵢ + λ‖w‖²
```

- `cᵢ` is the inverse class-frequency weight.
- The fit is Newton/IRLS with a fixed iteration cap. λ is chosen by **rolling-origin
  cross-validation**: train on the past and validate on the next month, with no random
  splits, so the future never leaks into training.

**D5.2 Explanations.** The contributions `wⱼ zⱼ`, the top 3 rendered as reasons, for example
"spread across 9 files (entropy 0.92)" or "touches 2 entry points".

**D5.3 Replacing blast radius `v1`.** The model replaces C10 `v1` as the risk band only when,
on a hold-out of at least 500 final-labelled runs, it beats `v1` on all three of:
- PR-AUC;
- Brier score;
- **effort-aware recall**: the share of bad runs caught when reviewing the riskiest 20% of
  changed lines (Popt).

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
  `packages/stats`.

**D9.2 Sequential testing for benchmarks** (Wald's SPRT).
- Hypotheses: `H₀: shift ≤ 0` against `H₁: shift ≥ δ` (δ = the metric's warn threshold).
- α = 0.01, β = 0.05.
- Boundaries `A = (1 − β)/α` and `B = β/(1 − α)` on the likelihood ratio.
- Minimum 5 and maximum 30 interleaved sample pairs.
- When stopped early, the SPRT decision is reported, not a fixed-sample Mann–Whitney p-value,
  which would be invalid after optional stopping. At the maximum, C6.2 reporting applies.

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
- **People.** No model scores, ranks or displays individual people. Person-level features are
  excluded (§12.9).

### D13. `packages/stats`: one home for the maths

A new pure, source-only package. It is deterministic: seeded PRNG (xoshiro128**),
fixed iteration caps, quantized outputs. It holds:

- **Distributions:** sigmoid; logit; Beta posterior and quantile (regularized incomplete beta
  inverse); χ² quantile.
- **Fitting:** logistic regression (IRLS with L2, class weights); Bayesian logistic with a
  Laplace posterior; Platt scaling; isotonic regression (PAV).
- **Non-parametric tests:** Mann–Whitney U and Hodges–Lehmann (moved here from C6.2); seeded
  bootstrap CI; SPRT.
- **Time series:** EWMA; CUSUM; Bayesian online change-point detection.
- **Multivariate:** Mahalanobis with Ledoit–Wolf shrinkage; PSI.
- **Information theory:** Shannon entropy.
- **Estimators:** Chapman / Lincoln–Petersen; Kaplan–Meier with Greenwood variance;
  Goel–Okumoto MLE.
- **Scores:** Brier; ECE; PR-AUC; NDCG; Popt.
- **Policies:** Thompson sampling.

Before WS15 starts, existing implementations must be found and **migrated, not
duplicated**, at minimum `packages/prefetch/src/calibrate.ts` and the sampler in
`packages/learned-routing`.

### D14. Adoption order

| Phase | Ships | Needs |
|---|---|---|
| P1 | D0 rule and guard, D1 labels pipeline, D2 deterministic statistics, D13 package | WS7 (the delta exists) |
| P2 | D3 rule precision, D4 calibration, D7 statistical process control | About 4 weeks of votes and runs |
| P3 | D5 risk model, survival view, D10.2 similar runs | At least 500 final-labelled runs (global) |
| P4 | D9 scheduling, D10.1 ranking | WS12 (the optional tier exists) and click data |
| P5 | D6 naturalness, D8 reliability growth | A logprob-capable local model; at least 10 runs per dimension |

---

## 4. Contracts summary (new or changed)

| Contract | Package | Change |
|---|---|---|
| `FileFacts` v3 (`exports`, `calls`, `entryPoints`, `capabilityImports`, `testFacts`) | memory `/knowledge` (types), agent-tools (extractors) | Extended; `EXTRACTOR_VERSION = 3` |
| Stat manifest, Merkle directory hashes, git blob alternate keys | memory `/knowledge` `plan` | New |
| Segment fact store (`objects/`, `manifest.json`, `derived/`) | memory `/knowledge` stores + VSIX `knowledgeStores.ts` | Replaces the single snapshot file as the system of record. The snapshot becomes a projection. |
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
| Statistics primitives | `packages/stats` (new, pure, source-only) | New. Absorbs `prefetch/calibrate.ts` and the learned-routing sampler. |
| Verdict/predict layering guard | `scripts/check-run-delta-layers.mjs` | New |

## 5. Code map

```
builderforce-memory/packages/memory/src/knowledge/
  plan.ts                 + stat manifest, racy rule, Merkle dirs, git blob keys
  stores/segmentStore.ts  NEW  content-addressed objects + manifest + derived
  rules/factRule.ts       NEW  FactRule contract + incremental evaluator (trace + early cutoff)
  findings.ts             → rules/*.ts (one rule per file), findingIdentity.ts NEW
  lineage.ts              NEW  deterministic lineage matcher
  comparability.ts        NEW  (absorbs Builderforce agent-tools codeAnalysis.compareAnalysis)
  review.ts               analyzer failure recorded, never swallowed; level reporting

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
  stats/                  NEW  pure maths (D13); prefetch/calibrate.ts and learned-routing sampler migrate here

Builderforce.ai/clients/vscode/src/
  knowledge/backgroundIndexer.ts   NEW  watcher + reconcile + priority scheduler (B2, B6)
  knowledge/knowledgeService.ts    linked = selected ∧ session ∧ synchronize (A2)
  knowledge/knowledgeStores.ts     segment store at storageUri (B4)
  runDelta/runDeltaHost.ts         NEW  DeltaPorts over the fact store, pre-images, before-tree export
  runChangeBaseline.ts             + dirty pre-image capture (C1.3)
  brainRunHostPorts.ts             finalize → computeRunDelta → card
  codebaseScan.ts                  → projection of the fact store (B9); scan.json + versionToken deleted
  capabilityContext.ts             NEW  capability → context keys (A1)
  installRunChangeSets.ts, runChangeSetRecorder.ts   DELETE (zero references, verified first)

Builderforce.ai/api/
  src/domain/security/scanReportParsers.ts   SARIF parsing moves to packages/sarif
  run delta persistence + importer            (WS11, Opus-reviewed)
  run outcome labels: SZZ/revert/CI/review label jobs over the ops DB (WS16, Opus-reviewed)
  scripts/train-run-models.cjs               offline training driver → digest-named model artifacts (WS18)
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
| WS1 | **Offline closure** (A1–A5): capability hook and context keys; linked-means-granted; bundled analyzers, with the size decision first; scan without key; visualizer capability-first checks; delete the two unreferenced change-set files | Decision §12.1, §12.4 | Sonnet |
| WS2 | **Change detection + segment store** (B2, B4) in memory: stat manifest, racy rule, Merkle, git keys, segment store, snapshot as projection, migration of existing `.builderforce/knowledge/*.json`. Publish memory; bump the VSIX pin. | — | **Opus** (storage format) |
| WS3 | **Background indexer** (B6): watcher, reconcile, priority scheduler, levels, budgets, pause rules, level status to the visualizer | WS2 | Sonnet |
| WS4 | **Extraction v3 + rules** (B3, B5): tree-sitter queries for complexity, routes, entry points, capability imports, test facts; `FactRule` evaluator; the existing findings ported to rules; the determinism oracle test (B8.6) | WS2 | Sonnet |
| WS5 | **Consolidation** (B9): codebaseScan as a projection; repo-map `FileFacts` convergence; VSIX stops importing the repo-map extract. Existing tests run unchanged. | WS3, WS4 | Sonnet |
| WS6 | **Finding identity v2, lineage, comparability** (C3, C9), with jscpd and knip ids migrated and the VSIX baseline `comparable` | WS4 | **Opus** (cross-package) |
| WS7 | **run-delta core** (C1, C2, C4, C10): before resolution, pre-images, before-tree export, impact set, verdicts, headline, blast radius, digest property test | WS6 | **Opus** (cross-package, storage) |
| WS8 | **Security dimension** (C5): entry-point facts, guard, source, sink and sanitizer registries, taint-lite, capability delta, osv and gitleaks adapters, config rules, STRIDE template | WS7 | **Opus** (security) |
| WS9 | **Performance, -ilities and quality dimensions** (C6.1, C7, C8.1–C8.3), as one Sonnet brief per dimension | WS7 | Sonnet |
| WS10 | **Presentation** (C11): card, panel, history and trend, on VSIX and web; localization in all catalogs; both themes; 360 px | WS7 | Sonnet |
| WS11 | **SARIF package** (C12), plus persistence and sync (C14): the `run-delta` record, the mirror importer, the `run_deltas` and `run_delta_findings` expand migration | WS7; G15–G18 | **Opus** (migration, storage) |
| WS12 | **Optional dynamic tier** (C6.2, C8.4): benchmark runner, statistics, diff coverage, Stryker incremental, delta policy for autonomous runs | WS9 | Sonnet |
| WS13 | **Packaged offline acceptance** (A6) and cloud-run delta (C14) | WS1–WS10 | Sonnet |
| WS15 | **`packages/stats` and deterministic statistics** (D13, D2, D0 guard). Migrate `prefetch/calibrate.ts` and the learned-routing sampler; their tests run unchanged. | WS7 | Sonnet |
| WS16 | **Labels pipeline** (D1): `RunFeatures` frozen at run end, the `run-outcome` record, SZZ/revert/CI/review labellers, censoring, the leakage guard, consent-scoped training store. **Starts with WS7.** | WS7, WS11 | **Opus** (storage, privacy, cross-package) |
| WS17 | **Rule precision, calibration, process control and reliability growth** (D3, D4, D7, D8) | WS15, WS16 | Sonnet |
| WS18 | **Run risk model** (D5): training driver, rolling-origin validation, artifact format, quantized inference, the replace-`v1` gate, Kaplan–Meier view, model cards and drift (D12) | WS16 with at least 500 final labels | **Opus** (model governance, storage) |
| WS19 | **Naturalness** (D6), on the prefetch logprob seam | WS15 | Sonnet |
| WS20 | **Thompson scheduling and SPRT** (D9) | WS12, WS15 | Sonnet |
| WS21 | **Ranking and similar runs** (D10), plus the card's Predicted block (D11), localized | WS10, WS16 | Sonnet |
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
- [ ] Determinism oracle (B8.6): incremental equals scratch equals the second OS, byte for
      byte, over 500 seeded edit sequences.
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
- [ ] `prefetch/calibrate.ts` and the learned-routing sampler import from `packages/stats`.
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
| Bundled analyzers inflate the VSIX | Size decision §12.1; analyzer-pack fallback; tree-sitter rules cover the per-edit path anyway |
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

## 12. Open decisions for the operator

1. **Analyzer distribution.** Bundle dependency-cruiser, jscpd and knip in the VSIX (larger
   package, fully offline from install) or download an analyzer pack on first online launch
   (smaller package, offline only after one connection). *Proposed: bundle.*
2. **Fact store location.** VS Code workspace `storageUri` (never committed, lost if the
   folder moves) or `.builderforce/cache/` gitignored in the repo (survives moves, visible).
   *Proposed: `storageUri`, with `.builderforce/` keeping human-facing outputs only.*
3. **Auto-index on open.** Default on for every folder, or on only after the first `/review`
   or an explicit opt-in. *Proposed: on, L0–L2 always, L3 when idle and on mains power.*
4. **Signed-out views.** Should `health` and `evermind` run on local data when signed out?
   *Proposed: yes for both, behind capability keys.*
5. **Delta policy default for autonomous runs.** Block finalization on C8.2 errors and
   `guard-removed`, or advisory only at first. *Proposed: block those two; everything else
   advisory.*
6. **Server persistence of deltas.** The `run_deltas` and `run_delta_findings` tables (C14), or
   keep deltas as run artifacts in R2 only and compute trends client-side.
   *Proposed: tables, for trend queries.*
7. **G03 engine floor.** WS2 is designed to move into SQLite later. Raising `engines.vscode`
   to ≥ 1.101 unblocks that sooner.

8. **Cross-tenant training.** May the global priors and models (D3, D5, D10.2) pool
   aggregated, code-free features across tenants, opt-in per tenant? *Proposed: opt-in,
   default off for enterprise plans and on for free plans, stated in the privacy terms.*
9. **Person-level features.** Exclude author experience and identity from all features, even
   though the JIT literature finds them predictive. *Proposed: exclude. Never score people.*
10. **Label windows.** 30 days for `followup-fix` and `reverted`, 7 days for CI.
    *Proposed as stated. Shorter windows give labels sooner but miss slower failures.*

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
- Mann–Whitney U, Hodges–Lehmann estimator, bootstrap CIs for benchmark comparison.
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
- Pairwise learning to rank (RankNet, Burges 2005); unbiased LTR with inverse propensity
  weighting (Joachims et al. 2017); NDCG.
