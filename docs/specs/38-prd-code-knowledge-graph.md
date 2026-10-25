# PRD 38 — The code knowledge graph

| | |
|---|---|
| Status | Draft, waiting for operator review. No code yet (design-before-code rule). |
| Owner | Agents program (planning: the session model; implementation: Opus agents; verify: Sonnet agents) |
| Entry points | Web · Canvas · VS Code · Rovr |
| Builds on | The VS Code Visualization panel, fixed and shipped in VSIX 2026.10.78 (DONE.md 2026-10-25). PRD 35's rule that entry points supply ports and never behaviour. |
| Roadmap | `ROADMAP.md` › Agent runtime, desktop (Synapse) and VS Code › "The Visualization panel is VS Code-only…" |

## 1. The rule

**One graph, one component, many hosts.** A person sees the same picture of their codebase
in every place they work: what the code is, what the project knows about it, and what the
current run is changing. A host decides only *where the data comes from*. It never decides
what the graph contains or how it is drawn.

**No second copy of the code graph.** Structure is computed from the code. It is never
written into memory. Knowledge is the memory the platform already keeps, joined to that
structure by file.

## 2. Why

- **The Visualization panel shows only the current run.** Today it is a file tree of
  uncommitted changes. Its only edges are import specifiers found on changed diff lines
  (`clients/vscode/webview/src/visualization/diffModel.ts` `buildChangeGraph`). It cannot
  show how the rest of the codebase fits around those changes.
- **It exists in one host.** The panel is VS Code-only. Web, canvas and Rovr users have no
  view of their code at all.
- **What the project knows is invisible.** Every run already writes durable facts and
  `codemap:<area>` maps to the project's memory (`project_facts`; written by
  `clients/vscode/src/memoryCommit.ts` and `api/src/application/runtime/cloudAgent/runEndMemory.ts`).
  Nobody can see which files a fact is about, or which areas a team has mapped. That memory
  is read only by agents, through recall.
- **The structure already exists, unused for this.** `@builderforce/repo-map` builds a file
  reference graph with symbol-weighted edges and personalized PageRank, in pure TypeScript.
  It is cached per commit in R2 for the cloud runner. No surface draws it.

## 3. What a person can do

1. Open **Code** from any host and see their repository as a graph:
   - files are grouped by directory;
   - node size is the file's PageRank importance;
   - an edge means one file uses identifiers another file defines.
2. See the **knowledge layer** on top:
   - a badge on every file that a project fact is about;
   - areas outlined where a `codemap:` map exists.

   Selecting a file lists its facts, newest first, with source and age.
3. See the **live layer** while a run works:
   - files the run changed are highlighted, with +/− counts;
   - files touched together in one run are linked by co-change edges;
   - selecting a changed file opens the same before/after rows the Changes view shows.
4. **Search and focus.** Type a file or symbol name to centre on it and show its
   neighbourhood two hops deep. Large repositories open focused on the most important files,
   not as one hairball.
5. Remember something about a file from the graph (**Add fact**). The fact lands in the same
   `project_facts` row every other host and agent reads.

Non-goals for this PRD:
- editing code from the graph;
- call graphs or type-level analysis beyond what `repo-map` extracts;
- graphs across repositories (a multi-repo workspace shows one repository at a time, see §6.3);
- a new memory store.

## 4. End state

```
              ┌──────────────── hosts supply a KnowledgeGraphSource ───────────────┐
              │ Web / Canvas            VS Code                  Rovr               │
              │ GET /api/projects/:id/  host builds structure    same API as web    │
              │   knowledge-graph       from workspace files                        │
              └──────────────┬──────────────────────┬──────────────────┬───────────┘
                             ▼                      ▼                  ▼
       @builderforce/knowledge-graph  buildKnowledgeGraph(structure, knowledge, live)
                             │   pure, Worker-safe, tested
                             ▼
       frontend/src/components/knowledge-graph/KnowledgeGraphView   (@xyflow/react)
                             │
          canvas surface "code" (registry entry)  ·  VS Code Visualization panel tab
          ·  Rovr side panel
```

### 4.1 The projection: `@builderforce/knowledge-graph` (new, pure)

A new package rather than growth in `repo-map`. `repo-map` owns *ranking a repository for a
prompt*; this package owns *joining structure, knowledge and live work for a person*. They
have one reason each to change.

```ts
export interface KnowledgeGraphInput {
  repo: { id: string; name: string; sha?: string };             // id = provider/host/owner/repo
  structure: SerializedRepoGraph;                               // from @builderforce/repo-map
  facts: ReadonlyArray<{ key: string; content: string; source: string; importance: number;
                         updatedAt: string; fileAnchors: Array<{ path: string; line?: number }> }>;
  live?: { changes: PendingChangeSet; diffs: FileDiff[]; runFiles?: string[] };
}

export interface KnowledgeGraph {
  nodes: KgNode[];          // files and areas
  edges: KgEdge[];
  stats: { files: number; facts: number; changed: number; truncated: boolean };
}

export type KgNodeId = `${string}::${string}`;                  // `${repo.id}::${path}`, see §6.3
export interface KgNode {
  id: KgNodeId; kind: 'file' | 'area'; path: string; label: string;
  area?: KgNodeId;          // parent area (directory, or the codemap area that covers it)
  rank: number;             // PageRank, normalized 0–1 (files); sum of children (areas)
  facts: number;            // fact count anchored here
  mapped?: boolean;         // an area with a `codemap:` fact
  change?: { status: string; added: number; removed: number };
}
export interface KgEdge {
  from: KgNodeId; to: KgNodeId;
  kind: 'references' | 'co-changed';
  weight: number;           // identifier count (references) or runs-together count (co-changed)
}

export function buildKnowledgeGraph(input: KnowledgeGraphInput, opts?: { maxNodes?: number; focus?: string[] }): KnowledgeGraph;
```

Rules the function enforces:
- **References** come only from `structure.graph.out`. Nothing re-parses code.
- **Facts join by `fileAnchors[].path`.** A fact with no anchor belongs to no node. It
  appears in a "project-wide" list, never on an invented node.
- **`codemap:<area>` facts mark their area as `mapped`.** Their listed files produce
  `co-changed` edges, weighted by how many maps list both files. This is the only edge the
  memory contributes, and it is derived, never stored.
- **Live changes overlay existing nodes.** A changed file that `structure` has never seen
  (new since the graphed sha) is added as a node with `rank: 0`.
- **Bounded output.** Past `maxNodes` (default 400), the graph keeps the top-ranked files.
  It always includes every changed file, every `focus` file and their one-hop neighbours,
  and folds the rest into their areas. `stats.truncated` says it happened.

### 4.2 Sources: one port, three adapters

```ts
export interface KnowledgeGraphSource {
  load(scope: { projectId: number | null; repoId?: string }): Promise<KnowledgeGraphInput | null>;
  subscribeLive?(cb: (live: KnowledgeGraphInput['live']) => void): () => void;
  rememberFact?(fact: { content: string; path: string }): Promise<void>;
}
```

| Host | `structure` | `facts` | `live` |
|---|---|---|---|
| Web / canvas / Rovr | `GET /api/projects/:id/knowledge-graph` (§4.3) | same response | not available, since the web has no working tree |
| VS Code | the extension host runs `repo-map` over workspace files (`RepoGraphBuilder`, `isMapCandidate`), cached by HEAD sha plus dirty-file hashes | `recallProjectFacts` (`bfApi.ts`), already authenticated | `pendingChanges` + `usePendingDiff` (shipped in 2026.10.78) |

Each adapter lives beside its host: `frontend/src/lib/knowledgeGraphSource.ts`,
`clients/vscode/webview/src/knowledgeGraph/hostKnowledgeGraphSource.ts` and
`clients/chrome/src/sidepanel/knowledgeGraphSource.ts`. The component imports none of them.

### 4.3 API: `GET /api/projects/:projectId/knowledge-graph`

- **Layering.** Route → application use case `getProjectKnowledgeGraph` → ports
  `RepoGraphPort` (wraps `cloudRepoMap` / `getOrBuildRepoGraph`) and `ProjectFactsPort`
  (the existing facts repository). The route imports no table.
- **Response.** The finished `KnowledgeGraph`, built server-side by the same
  `buildKnowledgeGraph`, plus `repo` and `sha`. Query: `?repo=&focus=&maxNodes=`.
- **Caching (required).** Use `getOrSetCached` (`api/src/infrastructure/cache/readThroughCache.ts`).
  - Key: `kg:v1:${tenant}:${project}:${repo}:${sha}:${factsVersion}:${focusHash}:${maxNodes}`.
  - `factsVersion` is a per-project version token, bumped by every fact write or delete
    in the facts routes and in run-end memory.
  - The keyspace is unbounded, so there is no TTL-based invalidation. A new sha or a fact
    write simply changes the key.
  - The repo graph underneath is already cached by sha in L1 and R2.
- **Tenancy.** `resolveMembership` on the project, the same as `projectFactsRoutes.ts`.
- **Bound.** `maxNodes` is capped at 2000 server-side.

### 4.4 The component: `KnowledgeGraphView`

`frontend/src/components/knowledge-graph/`. The VS Code webview already imports from
`@/components/...`; it mounts `CreationCanvas` that way. Split by responsibility, none past
~400 lines:

- `KnowledgeGraphView.tsx`: the presentational root. Props are
  `{ source: KnowledgeGraphSource; projectId: number | null; initialFocus?: string[] }`.
  Nothing else.
- `useKnowledgeGraph.ts`: load, live subscription, focus and search state.
- `layout.ts`: pure and deterministic (areas as groups, files placed by area, then rank). The
  same input always gives the same picture, so refreshes don't reshuffle.
- `KgNodeFace.tsx` and `KgFactsPanel.tsx`: the node face, and the selected node's facts in a
  `SlideOutPanel`, not a modal.
- Rendering uses `@xyflow/react`, already a frontend dependency used by the canvas.

Standards that apply in full:
- **Localization.** Every string is under `knowledgeGraph.*` in all five catalogs. VS Code's
  labels arrive in the host bundle, the same way `canvas.*` labels do. Rovr's go in
  `_locales`.
- **Theme.** Theme tokens only. Both themes are checked.
- **Narrow screens.** At 360px the graph becomes the focused neighbourhood with a list
  fallback, with tap targets of at least 40px.
- **Visibility.** The component returns null when the source returns `null` (no repository
  linked), and renders an explained empty state instead.

### 4.5 Where it appears

- **Canvas.** A new `code` entry in the surface registry (`frontend/src/lib/canvasSurfaces.ts`),
  as data, not as a branch in the router. Every host that mounts `CreationCanvas` (the web
  `/creation-canvas` page and the VS Code editor tab) gets it with no further edits.
- **VS Code Visualization panel.** The panel's toggle gains a third view next to *Canvas*
  and *Changes*: **Code**. Its live layer is the same change data the Changes view uses.
- **Rovr.** A side-panel destination that mounts the component with the web source.

## 5. Memory: what it can and cannot hold

Evaluated 2026-10-25 against `builderforce-memory` and the platform store:

- **Records are flat.** `MemoryEntry` (`packages/memory/src/memory/types.ts`) and
  `project_facts` are keyed text with tags, importance, scope and provenance. Neither has a
  relation between records. The vector store's records are flat as well.
- **The one join that already exists is `project_facts.file_anchors`** (`{path, line?, contentHash?}[]`).
  It is the knowledge layer's entire link to the code, and it is already shared by VS Code,
  the web and the cloud agent through one table and one route.
- **`codemap:<area>` facts** (`consolidate()` in `/working`) are area → file lists from a run.
  They give area membership and co-change, but no references.
- **Decision.** No edge or relation fields are added to `MemoryEntry` or `project_facts`. The
  graph is a projection, recomputed from code plus anchored facts. Storing edges would be a
  second copy of `repo-map`'s output with no single writer.
- **One change memory does need:** writers must populate `file_anchors`.
  - **Already populated:** codemap facts (`codemapFactMeta`).
  - **Not populated:** run-end durable facts that name files in their content (`runEndMemory.ts`) don't set anchors today.
  - **WS1 fix:** extract workspace-relative paths from the content, with the same extractor as `contextPack/focusPaths.ts`. Otherwise the knowledge layer is nearly empty.

## 6. Decisions and edge cases

1. **Freshness.**
   - The web graph is the last graphed sha of the linked repository's default branch, and
     the header says which sha.
   - VS Code graphs the working tree.
   - The two can differ. That is expected, and the header says so.
2. **Big repositories.**
   - `repo-map`'s own limits apply (`DEFAULT_REPO_MAP_LIMITS`, `stats.truncated`).
   - The view opens on the top 400 files by rank plus everything changed.
   - Search reaches every file because it runs over `structure`, not over the rendered nodes.
3. **Node identity is repository plus path** (`KgNodeId`).
   - **Bug this fixes:** in a multi-root workspace, the change graph keys by repo-relative
     path, so `package.json` changed in two repositories merges into one node.
   - **WS3 change:** `buildChangeGraph` (`diffModel.ts`) adopts the same id, and its tests are
     updated to the new key. A behaviour change, recorded in DONE.md.
4. **Privacy.**
   - The graph shows paths and fact text the viewer can already read through
     `/api/projects/:id/facts`.
   - Nothing new is exposed, and no file contents are sent.

## 7. Workstreams

| WS | Scope | Acceptance |
|---|---|---|
| WS1 | `@builderforce/knowledge-graph` package: types, `buildKnowledgeGraph`, bounding, codemap co-change. Run-end facts populate `file_anchors`. | Pure unit tests: references only from `structure`; anchored facts on the right nodes; unanchored facts in the project-wide list; truncation keeps changed and focused files. A run-end fact that names a path stores that anchor. |
| WS2 | API use case, ports, route, `factsVersion` token, `getOrSetCached`. | Route test: tenancy refused for a non-member; second call served from cache; a fact write changes the response; `maxNodes` capped. |
| WS3 | `KnowledgeGraphView`, hook, layout, node face, facts panel; `code` canvas surface; five catalogs. `KgNodeId` adopted by `buildChangeGraph`. | Component tests on a fixture graph: renders, focuses, searches, opens facts; null source gives the empty state. Layout is deterministic for equal input. Both themes and 360px checked. |
| WS4 | VS Code source: `repo-map` over workspace files in the host (cached by sha + dirty hashes), facts via `bfApi`, live layer; **Code** view in the Visualization panel. | Visualization-panel test: the Code view mounts with the host source; a run write highlights the node without a reload. VSIX packaged and installed by a Sonnet agent. |
| WS5 | Rovr side-panel destination with the web source; `_locales` in five languages. | Rovr builds; the destination renders the same fixture graph as the web. |
| WS6 | Add fact from the graph (all hosts), writing `project_facts` with the anchor. | The fact appears on that node in a second host after refresh. |

WS1 → WS2 and WS3 in parallel → WS4, WS5 and WS6. Each workstream ships with its DONE.md
entry. This is a new capability, so WS3's release also carries a `release_notes` row
(category `new`) and an Idea-to-Real blog post, per the new-feature rule.

## 8. Measure

- **Use.** Knowledge-graph opens per host per week, from the surface/panel open event with an
  entry-point attribution, the same attribution `llm_usage_log` uses.
- **Value.** The share of graph opens that select a node with facts, and Add-fact writes from
  the graph per week.
- **Cost.** p95 latency of `GET /knowledge-graph` (cold vs cached), and cache hit rate.
- **Kill condition.** If fewer than 10% of opens select a node with facts after eight weeks,
  the knowledge layer isn't earning its place. Cut the view back to structure plus live
  changes, and revisit how facts get anchored before investing more.

## 9. Open decisions for the operator

1. **The canvas surface's name:** `code` (proposed) or `map`.
2. **Should VS Code also offer the server graph,** the default branch, as a toggle next to
   the working tree? Proposed: no, to keep one source per host.
3. **Should the facts panel allow deleting or superseding a fact,** not only adding one?
   Proposed: delete only for the fact's author or a project admin, through the existing
   `DELETE /api/projects/:projectId/facts/:key`.
