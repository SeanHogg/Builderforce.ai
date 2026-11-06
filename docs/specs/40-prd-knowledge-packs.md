# PRD 40 — Portable knowledge packs (any LLM can use reviewed knowledge)

| | |
|---|---|
| Status | Shipped; see DONE.md, "PRD 40". All decisions are settled. This file keeps the binding rules. |
| Owner | Agents program. Model roles are in CLAUDE.md. |
| Roadmap | `ROADMAP.md` › Cloud and IDE agent runs; builds on PRD 38 (the knowledge graph). |
| Date | 2026-11-03; shipped work moved to DONE.md 2026-11-06 |

This PRD now holds only open work. The shipped scope is recorded in DONE.md under "PRD 40". That covers the format, the VS Code commands, the pack registry and retrieval-port seam, the Measure proof, and the platform pack store. Section names below are the ones DONE.md cites.

## Naming (still binding)

The memory package's `KnowledgePack` type is the **plugin** contract: parsers, partitions, findings and judgement. The artifact is the **portable knowledge pack** (`PortableKnowledgePack`, "portable pack", `.bfpack` on disk). Code and docs never call the portable artifact `KnowledgePack` alone.

## The seam (still binding)

There is exactly one seam between knowing which packs exist and retrieving from them: `PackRegistry` → `PackRetrievalPort`, plus `withPacks` and `mergeRecalls` in `packages/agent-tools/src/knowledge/index/packRetrieval.ts`. Every consumer goes through it: VS Code chat, the context pack and Synapse, web chat `knowledge.ask`, and the Canvas Evermind turn. A new consumer adds a registry implementation, never a second merge or retrieval path.

## Decided

- **OD-2: the platform pack store.** Decided by the operator on 2026-11-06 and shipped.
  - Uploading a pack turns it into a knowledge root of the project it was uploaded to. Its root id uses the `pack` host (`packRootIdFor` / `isPackRootId`).
  - There is no new table. The pack is visible to the project's members.
  - Every fact written to a pack root carries the root as its `source`. Removing a pack deletes only those facts, and only a developer or higher may remove one.
  - Uploaded pack facts join the project's facts, so they seed that project's Evermind. The Evermind pack picker steers retrieval only.

- **OD-1: no embeddings in the pack.** Decided by the operator on 2026-11-06. Packs stay model-agnostic: consumers re-embed from card text by hash, and no format version adds an embeddings section.
- **OD-3: provenance.** Decided by the operator on 2026-11-06.
  - A pack carries an optional `provenance: { reviewedBy?, judgeModel?, policy?, reviewedAt? }`, filled automatically on Create and Update.
  - Uploading stores it on the pack's scope row, in the `knowledge_scopes.provenance` column (nullable jsonb).
  - The Evermind pack picker and the VS Code pack lists show it as a "Reviewed by … with …" line.
  - Packs without provenance stay valid, and their bytes are unchanged.

## Open decisions

None.
