# PRD 38 — The knowledge graph (any directory; code and docs first)

| | |
|---|---|
| Status | Built. This document holds **only what is left to complete**. Everything finished is in DONE.md (2026-10-31), under its original section numbers. Checked 2026-10-31. |
| Owner | Agents program. Model roles are in CLAUDE.md. |
| Roadmap | `ROADMAP.md` › Cloud and IDE agent runs |

## What is left

### A knowledge review of the `agentic` workspace fails

The exact exception has not been observed. The failure card and the BuilderForce output channel report it (since 2026.10.115). A headless run of the shared review over `c:\code\agentic` on 2026-10-31 found two scale defects, either of which can stop a review of a tree this size:

| Measure | Value |
|---|---|
| Files planned | 16,722 (the walk stops at `MAX_LISTED_FILES`, 20,000) |
| Estimated model calls | 17,949, against a budget of 200 |
| Time to plan | 329 s on node fs; `vscode.workspace.fs` is expected to be slower |

- **Unlinked folders: fixed in builderforce-memory 2026.10.36, not yet in a VSIX.** Each change used to rewrite the whole snapshot: 16.4 GB written over 2,340 files for a 5.8 MB snapshot. A review now writes a bounded number of times, and stores everything before it saves a manifest.
- **Linked projects: open.** The knowledge client makes 3 requests per file on the tenant's plan-rpm bucket (300 to 3,000 a minute), about 50,000 for this tree. A 429 from any of them ends the review, and so does a 413 from a file over the 1 MB limit. The largest of the first 2,346 files was 170 KB, so the 413 has not been seen. The workspace holds no snapshot file, which fits this path.

**Do:**

1. Move Builderforce to builderforce-memory 2026.10.36 and package a VSIX.
2. Implement `batched` and `preloadExtracted` in `packages/knowledge-client`, with bulk routes for extracted output in `projectKnowledgeRoutes.ts`. The routes must land on both doors, and stale marks already batch through `/knowledge/write`.
3. Honour 429 and `Retry-After` in the client with bounded retries. A file too large to store is skipped and counted, and never ends the review.
4. Check the analyzer step on a folder that is not a git repository. `pack.analyzers.analyse` runs uncaught in `reviewDirectory`, and the headless run did not reach it.
5. Rerun the review. If it still fails, read the reason from **Copy details** or the output channel and fix that cause.

**Accept.** The review of the `agentic` workspace finishes and the graph opens.

### The visualizer, Option B+: acceptance

The surface shipped in VS Code 2026.10.130. DONE.md (2026-11-05) records what was built. Acceptance is still open:

Memory 2026.10.40 is published and in use from VS Code 2026.10.131.

1. Re-review the `agentic` workspace with 2026.10.131 and check:
   - At most 5% of files are drawn as "No partition".
   - The server's source count equals the local count.
   - Pasting a screenshot of the review progress card filters to `ReviewProgress.tsx` → `labels.ts` → `useReviewRun.ts` → the review runner.

### Predicted measures: deterministic ML over the graph (planned 2026-11-06, not started)

The graph already holds what these formulas need: reference edges, file badges (complexity, coverage, churn, owner, clones, unused, layer verdicts) and git history. Each formula below is arithmetic that runs when the graph is built, not a model call. The result is stored as a node badge or an area value. Every prediction then also counts as an answer that skipped the model on the savings ledger.

**Rules for every formula below:**
- **Where it lives.** Formulas live in builderforce-memory under `packages/memory/src/knowledge/`, next to `importance.ts`, as pure functions with tests.
- **When it runs.** They run inside `buildGraph`, so the cut graph and the outline carry the result.
- **What the UI reads.** Builderforce only reads the result. The view never computes a prediction.
- **Determinism.** The same graph and history give the same numbers. Fixed iterations and seeded order, as PageRank already does (`PAGERANK_DAMPING` 0.85, 40 iterations).
- **Missing inputs.** When an input is missing (no git history, no coverage), the badge is absent. The channel then reads "Not set up", never a guess.
- **Display.** Every number on screen that comes from a rate or a prediction shows its uncertainty (see P3).

**What exists today:**
- PageRank sets node importance (`knowledge/importance.ts`).
- Retrieval uses BM25, cosine over HNSW, MMR and time decay (`retrieval/`).
- Nothing predicts a measure yet.

#### P1. Partitions from community detection (first)

- **Formula.** Louvain modularity maximisation over the file reference graph:
  - Q = (1/2m) Σᵢⱼ [Aᵢⱼ − kᵢkⱼ/2m] δ(cᵢ,cⱼ)
  - Edge weight is the reference count. Order is seeded for determinism.
  - Label propagation is the fallback above the outline cap.
- **Predicts.** The partition of every file the packs could not place, plus a membership confidence: the share of a file's edge weight that falls inside its community.
- **Uses.** It removes "No partition" on the map. It also gives station groupings by cohesion instead of by folder, which replaces the directory roll-up used when stations exceed the cap.
- **Accept.** At most 5% of files in "No partition" on the `agentic` workspace. This is the open acceptance check above. Modularity Q is reported in the graph stats.

#### P2. Defect-risk score

- **Formula.** Logistic regression: P(defect) = 1 / (1 + e^−(β·x)).
- **Features x:**
  - churn, time-decayed with a half-life
  - change entropy H = −Σ pₖ log pₖ over the file's share of each commit's changes (Hassan 2009)
  - cyclomatic complexity
  - coverage
  - fan-in (references in)
  - owner entropy
  - clone-group membership
- **Training labels.** Files touched by bug-fix commits, found by message and linked-issue heuristics, then traced to the commits that introduced the changed lines (SZZ).
- **Fitting and fallback.**
  - Coefficients are fitted per repository by gradient descent with L2 regularisation.
  - Below 30 labelled fixes, use the published default coefficients and say so in the provenance badge.
- **Uses.**
  - It replaces the hand-weighted w1–w5 heat ramp with calibrated quintiles of P.
  - It orders the "What is wrong?" answers and the Act cards.
  - It feeds the Coverage drawer's "test this first".
- **Accept.**
  - On a held-out 20% of history, AUC ≥ 0.70 on the `agentic` workspace.
  - Calibration error (ECE) ≤ 0.1.
  - Both are reported in the Coverage drawer's provenance badge.

#### P3. Honest rates: Beta–Binomial shrinkage and Wilson intervals

- **Formula.** Every displayed rate of k successes in n trials uses the posterior mean (k + α)/(n + α + β), with the prior (α, β) fitted to the repository's own distribution (empirical Bayes). The Wilson score interval gives the range shown.
- **Applies to:**
  - coverage per station
  - owner share
  - tested-response share in the API drawer
  - the Measure section's kill-condition metrics: the share of opens that act on a finding, and the `knowledge.ask` answer rate
- **Uses.** A 1-of-1 never reads as 100%. Small samples render with "≈" and their range, which is the existing analytics-UI convention.
- **Accept.**
  - No rate on the surface renders without its n.
  - Rates with n < 10 render as "≈ x% (a–b)".

#### P4. Co-change association (impact prediction)

- **Formula.** For files A and B over commits:
  - support = P(A∧B)
  - confidence = P(B|A)
  - lift = P(A∧B) / (P(A)P(B))
- **Thresholds and limits.**
  - Kept pairs need support ≥ 3 commits and lift ≥ 2.
  - Commits touching more than 50 files are excluded, because they are bulk changes.
  - At most 8 partners per file.
- **Predicts.** Which files a change to A will also need, including coupling that has no reference edge (hidden coupling).
- **Uses.**
  - "What changed?" shows the predicted, not-yet-touched partners.
  - The staged fix flow's "Run checks" includes partners' tests.
  - "This path is done when…" lists them.
  - A new overlay channel shows hidden coupling.
- **Accept.** On held-out commits, recall@8 ≥ 0.5 for files changed together with A.

#### P5. Owner entropy and bus factor

- **Formula.** H = −Σ pₐ log pₐ over each author's share of a file's changes, time-decayed. The bus factor is the smallest number of authors covering 50% of a station's changes.
- **Uses.** The owner channel, a "single owner" risk in "What is wrong?", and a P2 feature.

#### P6. Trend forecasting for cost and debt

- **Formula.** Holt's linear exponential smoothing (level + trend) over:
  - per-review model calls and spend
  - re-review cost
  - violation, clone-group and unused counts per project
  - Least squares is the fallback below 6 points.
- **Predicts.**
  - Next-period values with a prediction interval.
  - A pre-review estimate of model calls against the budget. The review of `agentic` planned 17,949 calls against 200; the estimate should flag that before the review starts.
- **Uses.**
  - The Measure section's headline ("debt goes down") becomes a forecast with a direction and a range.
  - The review launcher warns when the estimate exceeds the budget.

#### P7. Station transition probabilities (Simulate)

- **Formula.** A first-order Markov chain over stations. P(j|i) comes from recorded run traces when present, otherwise from normalised reference weights.
- **Uses.** Simulate and "Run to end" follow the most likely path and show the probability of each hop. Path strip hops show the probability next to the count.

**Order.**
1. P1, P2 and P3 come first: P1 closes an open acceptance check, P2 gives the main colour channel a meaning, and P3 makes every number trustworthy.
2. P4 comes with the staged fix flow, which needs impact prediction.
3. P5 rides along with P2, since it is one of P2's features.
4. P6 and P7 follow.

**Contract.**
- New badge keys go into `OUTLINE_BADGE_KEYS` so the outline carries them: `risk`, `riskBand`, `ownerEntropy`, `community`, `communityConfidence`, `coChange` (top partner refs).
- Area values carry `busFactor`, the shrunk coverage rate and its interval.
- Graph stats carry `modularity`, `riskAuc` and `riskCalibration`.
- Adding these is a memory minor release. Builderforce then bumps and moves the API cache key.

**Not in scope.** Training neural models, any per-request model call, and sending repository history off the machine for fitting. Fitting runs where the review runs.

### The data pack (later)

A pack for json, yaml and csv. It was left out of this release and has no date.

## 7. Measure

- **Use.** Reviews and graph opens per host per week, by entry-point attribution. Folders
  reviewed, split by pack.
- **Value.**
  - The share of opens that act on a finding (Fix with agent or Add fact).
  - `knowledge.ask` answers with `skippedLlm` on the savings ledger.
  - Exploration turns avoided on questions about reviewed roots.
  - Code-pack violations, clone groups and unused counts per project over time. **The
    headline is that debt goes down.**
- **Cost.** Model calls and spend per review, by pack. Re-review cost compared with the
  first review (it should approach zero for unchanged folders). p95 of `GET /knowledge-graph`
  and the cache hit rate. Client layout time at 400 and 2000 nodes.
- **Kill condition.** After eight weeks, if fewer than 10% of opens act on a finding *and*
  `knowledge.ask` answers under 5% of questions about reviewed roots, cut back to the code
  pack's Structure, Partitions and Live, and drop the docs judgement pass.
