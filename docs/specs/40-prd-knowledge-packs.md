# PRD 40 — Portable knowledge packs (any LLM can use reviewed knowledge)

| | |
|---|---|
| Status | Design for review. No code started; the VS Code surface and the Synapse/Canvas seam below are the contract to build against. |
| Owner | Agents program. Model roles are in CLAUDE.md. |
| Roadmap | `ROADMAP.md` › Cloud and IDE agent runs; builds on PRD 38 (the knowledge graph). |
| Date | 2026-11-03 |

## What and why

A **portable knowledge pack** (file extension `.bfpack`) makes a reviewed folder's
knowledge LLM-agnostic. Today the knowledge graph (PRD 38) lives where it was built: in
the reviewing host's knowledge index and snapshot. A portable pack lifts that knowledge
into one self-contained file that carries:

- the **knowledge graph** — judged facts, relations, entities and claims, each anchored
  to its source refs — as the canonical `KnowledgeSnapshot` the review already writes;
- the **extracted cache** — the deterministic per-file extraction records, keyed by
  content hash, so a consumer can re-derive structure without re-reading the folder;
- the **retrieval cards** — one card per graph node (deterministic text + keys + content
  hash), the same cards the host knowledge index serves.

With those three payloads, **any LLM or host** can consume the pack with no toolchain
installed: it reads the cards, retrieves the top cards for a question, and injects them
as context. Embeddings are deliberately not required in the file: every card carries its
deterministic text and content hash, so a consumer re-embeds by hash and gets
reproducible embeddings. RAG over the pack is therefore reproducible on any host, and
the file stays small and diffable.

The feature ships in the BuilderForce VS Code extension as four commands — create from a
directory, load, export, update — and becomes a retrieval source in the Synapse/Canvas
flow that composes an Evermind.

## Naming: two different "knowledge packs"

The memory package already exports a `KnowledgePack` type (`knowledge/model.ts`): it is
the **plugin** contract — parsers, partitions, findings and judgement — implemented by
the builtin "docs pack" and the host "code pack". That name keeps its meaning and does
not change. The artifact in this PRD is the **portable knowledge pack** (`PortableKnowledgePack`,
"portable pack", `.bfpack` on disk). The plugin produces knowledge; the portable pack
carries it. Code and docs must never call the portable artifact `KnowledgePack` alone.

## The format (v1)

A portable pack is one JSON file, serialized **canonically** — the same sorted-key
serialization `localSnapshotStore` uses for snapshots — so equal content is equal bytes,
and a pack dedupes, diffs and caches by its own hash.

```ts
interface PortableKnowledgePack {
  version: 1;
  name: string;        // pack name, kept across updates
  createdAt: string;   // ISO
  rootId: string;      // the reviewed root this pack was created from
  title: string;       // human label, defaults to the folder name
  snapshot: KnowledgeSnapshot; // {version:1, scopes, facts, relations, extracted} — the PRD 38 payload
  cards?: IndexDoc[];  // retrieval cards; optional because derivable from the graph
}
```

- `snapshot` is exactly the `KnowledgeSnapshot` the review writes today — scopes,
  facts (deduped by `key`), relations (deduped by `(from, to, kind)`), and the
  `extracted` cache keyed by content hash. Nothing new is invented here.
- `cards` is the output of `toCards(graph)` — one retrieval `IndexDoc` per node. It is
  optional in the file: a consumer can rebuild cards from the snapshot, and MUST rebuild
  embeddings from card text regardless (re-embed by hash — the host knowledge index
  already does this).
- **Merge semantics for update:** updating a pack re-reviews its source folder into a
  fresh snapshot and merges — facts by fact `key`, relations by the relation triple
  (`from` + `\0` + `to` + `\0` + `kind`, matching `localSnapshotStore`'s `relKey`),
  extracted records by content hash. The pack's `name` and `rootId` are preserved;
  `createdAt` reflects the update. The merge is idempotent, so re-exporting an unchanged
  folder yields equal bytes.

The pure code for this — serialize, parse, merge, validate — lives in
`packages/agent-tools/src/knowledge/` (the workspace package the VS Code client consumes
directly), exported through its `index.ts`. It does NOT go into `builderforce-memory`:
the client pins the *published* npm version of memory, so new memory code cannot reach
the client until a publish.

## VS Code surface

Four commands, contributed in `clients/vscode/package.json` `contributes.commands`
(category "BuilderForce", `%command.*%` titles resolved in `package.nls.json`), and
registered from `knowledgeCommands.ts` `registerKnowledgeCommands` in the same style as
the existing review commands (`vscode.commands.registerCommand`, `vscode.l10n.t`):

| Command | Behaviour |
|---|---|
| **Create Knowledge Pack** | Pick a directory. Runs the existing review pipeline (`reviewRoot` → `runKnowledgeReview`) if the folder has no fresh snapshot, then writes a `.bfpack` into the pack library. |
| **Load Knowledge Pack** | Pick a `.bfpack` file. Registers it as a read-only reviewed root in the editor: upserts its graph and cards into the host knowledge index (`getHostKnowledgeIndex(rootId)`, `upsertFromGraph`) and remembers the loaded pack (globalState), so chat and Synapse queries see it. Re-loading is idempotent (canonical content, index upsert by hash). |
| **Export Knowledge Pack** | Pick a reviewed root (or loaded pack) and a destination; writes the canonical `.bfpack`. |
| **Update Knowledge Pack** | Pick a loaded pack whose source folder is reachable; re-review into a fresh snapshot, merge per the semantics above, keep the pack name. |

The **pack library** lives at `<workspace>/.builderforce/knowledge/packs/` — created and
exported packs land there by default, and loading indexes the pack into the existing
`<workspace>/.builderforce/knowledge/<rootId>.idx` index. Loaded packs appear alongside
reviewed roots; a pack root is read-only (no re-review of a folder the workspace does
not hold).

## Synapse and Canvas consumption

This is the section the PRD exists to settle: a loaded pack is a **retrieval source in
the Canvas creation flow for Evermind/LLMs**. When a user composes an Evermind, the
packs they select contribute two things:

1. **Their cards to the model's retrieval context.** At run time, a question against
   the Evermind retrieves the top cards from the selected packs and injects them as
   context — the same retrieval the host knowledge index serves in VS Code.
2. **Their facts as seeded knowledge.** The pack's judged facts/relations seed the
   Evermind's knowledge, so the composed model starts from the reviewed graph rather
   than re-judging the folder.

### The seam: pack registry → retrieval port

Define exactly one seam between "knowing which packs exist" and "retrieving from them":

- A **pack registry** enumerates the packs available to the composing user or project —
  the VS Code pack library locally, plus any shared packs the platform serves.
- A **retrieval port** is the interface a consumer queries: given a pack set and a
  query, return the top cards. Synapse (the native engine) and the Canvas composer both
  query loaded packs **through the same port the VS Code knowledge index serves**, so
  there is one retrieval implementation, one embedding policy (re-embed by hash), and
  one dedupe rule — not three consumers each re-implementing pack reading.

Nothing else is shared: the registry is a list, the port is a query function, and the
`.bfpack` file is the only on-disk contract.

### Open decisions (not settled here)

- **Embeddings inside the pack vs re-embed on load.** v1 ships without embeddings and
  consumers re-embed from card text (the index already re-embeds by hash). Shipping
  embeddings inside the pack would skip that compute but ties the file to one embedding
  model and bloats it; the decision is whether a later format version offers it as an
  optional section. Default stays: no embeddings in the file.
- **Platform-side pack storage for shared packs.** Whether the API gains a pack store
  (upload a pack, share it to a project or tenant, version it) so Canvas can compose
  Everminds from packs the user never had locally. This PRD settles the local flow; the
  platform store is a follow-up decision.
- **Pack trust / provenance badges.** A pack is judged knowledge from someone's review;
  whether packs carry provenance (who reviewed, which model judged, what policy) and how
  the UI badges that is open. The format has room (top-level fields), but no provenance
  field is specified in v1.

## Measure

The end-to-end proof, run as an acceptance script:

1. Create a pack from a docs folder in one workspace.
2. Load that pack in a **clean workspace** (no snapshot, no index, folder absent).
3. Ask a question that only the folder's content can answer.
4. The right card appears in the model's context, and the answer cites it.

Metrics once shipped: packs created/loaded/exported/updated per week; share of chat and
Synapse answers about a loaded pack that used a pack card; Evermind compositions that
select at least one pack; load-to-first-answer latency in a clean workspace.

## Acceptance criteria

- [ ] `PortableKnowledgePack` v1 (format above) is implemented in
      `packages/agent-tools/src/knowledge/`, with canonical serialization — equal content
      serializes to equal bytes — and unit tests for parse/serialize/merge.
- [ ] The four commands are contributed in `clients/vscode/package.json` and registered
      in `registerKnowledgeCommands`; all user-facing strings localized via
      `package.nls.json`.
- [ ] Create writes a `.bfpack` to `.builderforce/knowledge/packs/`; Export writes one
      to a chosen destination; Update merges by fact key / relation triple / extracted
      hash and preserves the pack name.
- [ ] Load registers the pack as a read-only root and upserts its cards into the host
      knowledge index; a query in chat surfaces a pack card.
- [ ] The pack registry → retrieval port seam is documented in code (one interface both
      Synapse and the Canvas composer call); the three open decisions above are recorded
      as open in the tracking tickets, not decided by the implementation.
- [ ] The Measure script passes end to end on a clean workspace.
