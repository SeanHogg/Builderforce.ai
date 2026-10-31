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
