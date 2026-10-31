# PRD 38 — The knowledge graph (any directory; code and docs first)

| | |
|---|---|
| Status | Built. This document holds **only what is left to complete**. Everything finished is in DONE.md (2026-10-31), under its original section numbers. Checked 2026-10-31. |
| Owner | Agents program. Model roles are in CLAUDE.md. |
| Roadmap | `ROADMAP.md` › Cloud and IDE agent runs |

## What is left

### A knowledge review of the `agentic` workspace fails

The cause is unknown. The failure card and the BuilderForce output channel now report it (since 2026.10.115).

- **Do.** Rerun the review on the current VSIX, read the reason from **Copy details** or the output channel, and fix the cause.
- **Accept.** The review of the `agentic` workspace finishes and the graph opens.

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
