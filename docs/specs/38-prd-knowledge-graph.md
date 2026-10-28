# PRD 38 — The knowledge graph (any directory; code and docs first)

| | |
|---|---|
| Status | **Rev 3, approved 2026-10-28, in implementation.** |
| History | **Rev 1** (2026-10-25): a 2D code graph. <br>**Rev 2** (2026-10-28): 3D, layers, duplication. <br>**Rev 3** (2026-10-28, operator): <br>• **The knowledge graph is a structure of memory.** Facts on their own are recollections; facts connected by edges are knowledge. The engine moves into builderforce-memory, and there is no Builderforce `knowledge-graph` package. <br>• **A person can ask any host to review a directory**, code or not, and get a knowledge graph of it. <br>• **The first release ships two packs: code and docs.** Data (json/yaml/csv) is a later pack. |
| Owner | Agents program. Planning is done by the session model, implementation by Opus agents, and verification by Sonnet agents. |
| Entry points | Web · Canvas/Studio · VS Code · Rovr · on-prem/cloud container |
| Builds on | builderforce-memory `ingest` (`IngestionPipeline`, `ParserRegistry`, content-hash manifest), `retrieval`, `/working` codemap. `project_facts` + `file_anchors`. `@builderforce/repo-map`. `agent-tools/codeAnalysis.ts`. [deterministic-prefetch.md](../design/deterministic-prefetch.md). [deterministic-knowledge-index.md](../design/deterministic-knowledge-index.md). |
| Roadmap | `ROADMAP.md` › Agent runtime, desktop (Synapse) and VS Code › "The knowledge graph…" |

## 1. The rules

1. **Knowledge is memory.**
   - A fact is a memory. A fact connected to other facts, and to the sources it came from,
     is knowledge.
   - The graph's model, its joins, its traversal and its stored relations live in
     builderforce-memory (`@seanhogg/builderforce-memory/knowledge`), beside `ingest`,
     `retrieval` and `/working`.
   - Builderforce supplies ports and packs. It never re-implements the graph.
2. **Store judgement; compute perception.** Every node and edge has an `origin`:

   | Origin | Means | Kept |
   |---|---|---|
   | `extracted` | a deterministic extractor read it from a source: an import, a heading, a link, a clone pair | **computed**, cached by the source's content hash, and never written as memory. Re-reading the source reproduces it exactly. |
   | `model` | a model judged it: a claim, a summary, a merged entity, "contradicts" | **stored** as memory, with its confidence and the content hash it was judged from. It goes **stale** when the source changes. |
   | `human` / `agent` | a person or a run asserted it: Add fact, a codemap, run-end facts, co-change | **stored** as memory, with provenance |

   Re-reviewing a directory re-reads only changed files. Only judgement costs model calls.
3. **One walk, one registry.** Reviewing a directory runs through the existing
   `IngestionPipeline` and `ParserRegistry`. A file kind is a registry row (a pack), never a
   branch. Packs add what the kind needs: an extractor, partitions, lenses and findings.
4. **One graph, one view, many hosts.** A host decides only where files come from and where
   memory is persisted. It never decides what the graph contains or how it is drawn.
5. **Deterministic first.** Deterministic extraction, entity resolution and search run before
   any model. A model is called only for judgement the person asked for (a review), within a
   budget the person saw.

## 2. Why

- **People no longer read the files; agents write them.** People need to judge *shape*:
  - is it layered;
  - is it duplicated;
  - what does it say;
  - what contradicts what;
  - what did this run change.

  Nothing shows shape today:
  - The Visualization panel draws only a run's changed files (`diffModel.ts`).
  - `CodeAuditVisualizer` is a 2D SVG of one tool result.
- **Not all of a person's work is code.** Specs, contracts, research notes and policy folders
  are reviewed by reading every file. An agent asked about them re-reads them every time,
  because nothing durable is built.
- **The pieces exist but are not joined:**
  - `ingest` parses markdown, HTML and plain text, and tracks content hashes;
  - `repo-map` ranks code references;
  - `codeAnalysis.ts` runs dependency-cruiser, jscpd and knip;
  - `project_facts` holds what the team knows.

  All four are flat or isolated. Rev 1 §5 decided memory would hold no relations, and that
  decision is reversed here.

## 3. What a person can do

1. **Review a directory.** From any host, the person asks the agent to review a folder: they
   type "review ./contracts", use `/review <dir>`, or use **Review with BuilderForce** on a
   folder in the VS Code explorer.
   - A confirm chip states the scope: files by pack, files unchanged since the last review,
     and **≈ model calls and cost** for the judgement pass.
   - The graph builds as the review runs, and opens when the review finishes.
2. **See it in 3D.**
   - **Planes** are the pack's partitions: code layers, or doc folders and sections.
   - **Clusters** are areas.
   - **Node size** is importance (PageRank over the graph).
   - **Edges are vectors** from user to used, or from citing to cited. Edges that break the
     rules and cycles are highlighted.
   - Orbit, zoom and fly-to work by mouse and touch.
3. **Switch lenses.** Lenses are registry rows. Each one declares the packs it applies to:

   | Lens | Packs | Shows |
   |---|---|---|
   | Structure | all | extracted edges and importance |
   | Partitions | code (layers) | rule-breaking arcs and the partition matrix |
   | Duplication | all | exact clones (jscpd, code), and near-duplicates (sections or files) from the index |
   | Claims | docs | model-extracted claims, with **contradiction** and **agreement** edges |
   | Links | docs | link and reference edges, with broken links as findings |
   | Unused | code | knip's unused files, exports and dependencies |
   | Knowledge | all | facts and entities attached to their sources, with stale ones marked |
   | Live | code | the run's changed files, with co-change edges |
   | Compare | all | before and after of two reviews or analysis snapshots: what got better or worse |

4. **Trace a path.** The person picks a node:
   - In **code** they see a **layer sequence**: lanes are layers, messages are references,
     and skipped or climbed layers are marked.
   - In **docs** they see how one document reaches another through links and citations.

   *Copy as Mermaid* exports the trace.
5. **Act.** Every finding has **Fix with agent**, which routes a fixed, prefilled request into
   the ONE composer:
   - "Consolidate clone group #3";
   - "Move the db import behind a port";
   - "Reconcile §4.2 of a.md with §2 of b.md";
   - "Repair 3 broken links".

   The requests are a fixed list, never a model call.
6. **Ask.** Questions about a reviewed directory are answered from memory, without re-reading
   the files:
   - "what does the lease say about termination";
   - "where is billing handled".

   Recall returns the hits plus their graph neighbours, through the deterministic knowledge
   index and graph expansion. The prefetch row `knowledge.ask` answers with no model when the
   graph alone is confident.
7. **Remember.** **Add fact** on a node writes a `human` fact, anchored to its source, that
   every host and agent sees.

Non-goals for this release:
- the data pack (json/yaml/csv);
- OCR or image understanding (pdf and office files contribute only the text that can be
  extracted deterministically);
- editing sources from the graph;
- graphs across tenants.

## 4. End state

```
 hosts supply a DirectorySource + a KnowledgeStore (ports only)
 ┌────────────────────┬──────────────────────┬──────────────────────┬──────────────────────┐
 │ VS Code            │ on-prem / container  │ Web·Canvas·Studio    │ Rovr                 │
 │ workspace folders  │ container fs         │ webcontainer VFS ·   │ File System Access   │
 │                    │                      │ Cloud Drive · upload │ directory picker     │
 └─────────┬──────────┴──────────┬───────────┴──────────┬───────────┴──────────┬───────────┘
           ▼                     ▼                      ▼                      ▼
  builderforce-memory  /knowledge
    reviewDirectory()  ─▶ ingest: IngestionPipeline + ParserRegistry (packs: docs builtin, code registered)
                       ─▶ extract (deterministic) ─▶ resolveEntities (deterministic keys)
                       ─▶ JudgementPort (model, budgeted, cached by content hash)  [review only]
                       ─▶ KnowledgeStore.write(model/human facts + relations)
    buildGraph(scope)  ─▶ join extracted (computed) + stored (memory) ─▶ KnowledgeGraph
    partitions · traceGraph · findings · toCards ─▶ knowledge index (retrieval)
           │
           ▼
  @builderforce/knowledge-graph-view  (source-only React; three + @react-three/fiber)
           │
  canvas surface · VS Code Visualization panel tab · Rovr side panel · web project page
```

### 4.1 Memory: `@seanhogg/builderforce-memory/knowledge` (new subpath)

The model is generic. It knows sources, entities, facts and relations, and nothing about
imports or headings.

```ts
export type NodeRef = `src:${string}` | `ent:${string}` | `fact:${string}`;   // src: `${rootId}::${path}`
export type Origin = 'extracted' | 'model' | 'human' | 'agent';

export interface KNode {
  ref: NodeRef; kind: string;                 // pack-defined: 'file' | 'section' | 'symbol' | 'party' | 'claim' | 'area' …
  label: string; pack: string; partition?: string; area?: NodeRef;
  importance: number;                         // PageRank over the joined graph, 0–1
  origin: Origin; sourceHash?: string; stale?: boolean;
  badges?: Record<string, number | string>;   // pack data: { added, removed }, { unused: 'file' }, …
}
export interface KEdge {
  from: NodeRef; to: NodeRef; kind: string;   // 'references' | 'links' | 'contains' | 'mentions' | 'duplicate'
                                              // | 'near-duplicate' | 'contradicts' | 'agrees' | 'supersedes'
                                              // | 'about' | 'co-changed'
  weight: number; origin: Origin; confidence?: number;
  verdict?: 'allowed' | 'same' | 'skips' | 'upward';   // set by partitions (§4.4)
  cycle?: boolean;
}
export interface KnowledgeGraph {
  scope: { rootId: string; packs: string[]; digest: string };
  nodes: KNode[]; edges: KEdge[]; findings: Finding[];
  stats: { sources: number; nodes: number; stale: number; truncated: boolean };
}

// pack contract: registered on the ONE ParserRegistry
export interface DocumentParser {            // existing ingest contract, extended
  id: string; accepts(s: SourceDocument): boolean; parse(s: SourceDocument): ParsedSection[];
  extract?(s: SourceDocument, sections: ParsedSection[], ctx: ExtractContext): Extracted;   // NEW, optional, pure
}
export interface Extracted { nodes: KNode[]; edges: KEdge[]; keys: Array<{ ref: NodeRef; key: string }> }

export interface KnowledgePack {
  id: string;                                // 'docs' | 'code'
  parsers: DocumentParser[];                 // registered into ParserRegistry
  partitions?: PartitionRegistry;            // §4.4
  findings?: FindingRule[];                  // pure: (graph) => Finding[]
  judgement?: JudgementSpec;                 // what the model is asked, per section kind (schema-validated)
  analyzers?: AnalyzerPort;                  // host-run tools (code: codeAnalysis) → Extracted
}

export interface KnowledgeStore {            // port: platform API adapter or local snapshot adapter
  facts(scope: Scope): Promise<StoredFact[]>;            // project_facts rows (+ file_anchors)
  relations(scope: Scope): Promise<StoredRelation[]>;    // §4.2
  write(batch: { facts: StoredFact[]; relations: StoredRelation[] }): Promise<void>;
  markStale(sourceRef: NodeRef, newHash: string): Promise<void>;
}
export interface DirectorySource {           // port: one adapter per host
  rootId: string; list(): AsyncIterable<{ path: string; hash: string; size: number }>;
  read(path: string): Promise<SourceDocument>; watch?(cb: (paths: string[]) => void): () => void;
}
export interface JudgementPort { judge(req: JudgementRequest): Promise<JudgementResult> }   // routed model call

export function reviewDirectory(args: { source: DirectorySource; store: KnowledgeStore; packs: KnowledgePack[];
  judgement?: JudgementPort; budget: { modelCalls: number; ms: number }; signal?: AbortSignal;
  onProgress?(p: ReviewProgress): void }): Promise<ReviewReport>;
export function planReview(source: DirectorySource, manifest: IngestManifest, packs: KnowledgePack[]): Promise<ReviewPlan>; // the confirm chip's numbers
export function buildGraph(input: { extracted: Extracted[]; facts: StoredFact[]; relations: StoredRelation[];
  packs: KnowledgePack[]; live?: LiveOverlay }, opts?: { maxNodes?: number; focus?: NodeRef[] }): KnowledgeGraph;
export function traceGraph(g: KnowledgeGraph, from: NodeRef, opts?: { edgeKinds?: string[]; maxDepth?: number; maxSteps?: number }): Trace;
export function toMermaid(t: Trace, label: (r: NodeRef) => string): string;
export function toCards(g: KnowledgeGraph): IndexDoc[];   // feeds the knowledge index
```

Files are under `packages/memory/src/knowledge/`: `model.ts`, `build.ts`, `review.ts`,
`plan.ts`, `resolve.ts`, `partitions.ts`, `trace.ts`, `findings.ts`, `cards.ts`,
`importance.ts`, `stores/localSnapshotStore.ts` and `packs/docs.ts`. Each is under 300 lines.
`ingest/types.ts` gains the optional `extract`, `markdownParser`, `htmlParser` and
`plainTextParser` implement it, and existing ingest tests run unchanged.

### 4.2 Stored relations: one table, single writer

There is no new entity table:

- Judgement nodes (claims, merged entities, summaries) are **`project_facts` rows**, in key
  namespaces `ent:<pack>:<normalized-name>` and `claim:<hash>`.
- They are anchored by `file_anchors`, which already carry `{path, line?, contentHash?}`. The
  `contentHash` is what marks them stale.
- A new kind is a key namespace, never a new table.

New tables, shipped as an expand/contract migration (the add goes in push 1):

```sql
-- 1278_knowledge_relations.sql
CREATE TABLE IF NOT EXISTS project_fact_relations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   integer NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  project_id  integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_ref    varchar(512) NOT NULL,          -- NodeRef
  to_ref      varchar(512) NOT NULL,          -- NodeRef
  kind        varchar(32)  NOT NULL,          -- edge kind (§4.1); a new kind is a value
  weight      real NOT NULL DEFAULT 1,
  origin      varchar(8)   NOT NULL CHECK (origin IN ('model','human','agent')),  -- 'extracted' is never stored
  confidence  real,
  source_hash varchar(64),                    -- content hash judged from; null for human
  stale_at    timestamp,
  created_by  varchar(36) REFERENCES users(id) ON DELETE SET NULL,   -- users.id is varchar(36)
  created_at  timestamp NOT NULL DEFAULT now(),
  CONSTRAINT uq_fact_relation UNIQUE (tenant_id, project_id, from_ref, to_ref, kind)
);
CREATE INDEX IF NOT EXISTS idx_fact_relations_from ON project_fact_relations (tenant_id, project_id, from_ref);
CREATE INDEX IF NOT EXISTS idx_fact_relations_to   ON project_fact_relations (tenant_id, project_id, to_ref);

CREATE TABLE IF NOT EXISTS knowledge_scopes (            -- one row per reviewed root
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   integer NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  project_id  integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  root_id     varchar(512) NOT NULL,          -- `${host}:${repoId or folder id}:${path}`
  packs       varchar(64)[] NOT NULL,
  title       varchar(255) NOT NULL,
  last_digest varchar(64), last_reviewed_at timestamp,
  CONSTRAINT uq_knowledge_scope UNIQUE (tenant_id, project_id, root_id)
);
```

- **3NF.** A scope's membership is derived from the anchor path prefix and is not stored. A
  relation's endpoints are refs, never copied text.
- **Origin is checked server-side, not trusted.** The writer accepts:
  - `human` only from a person, who becomes the author (`created_by`);
  - `agent` only from a machine caller (the agent-host door);
  - `model` from either, with no author, because a review a person starts runs the judgement under their session.

  Any other combination is rejected with `400 origin_mismatch`.
- **Single writer.** The application use case `writeKnowledge` is the only writer. The facts
  routes and run-end memory route through it.
- **`project_facts` gains two columns** in the same migration: `created_by varchar(36)` (the
  author, which the delete rule needs) and `origin` (`model` | `human` | `agent`).
  - Facts written before 1278, and agent-written facts with no author, stay deletable by any
    project member. That keeps `memory_forget` working.
  - Ticket-scoped run outcomes live in `agent_memory`, which has no anchors, so they do not
    join the graph. Project-scoped outcomes and codemaps do.
- **Extracted cache layout.** One R2 object per source path
  (`knowledge/{tenant}/{project}/{rootId}/src/{pathHash}.json`, holding `{path, hash}`) plus
  the extracted output by content hash. The graph lists the root by prefix, so concurrent
  reviews never read-modify-write a shared manifest.
- **Local, with no project linked.** `localSnapshotStore` persists the same shapes beside the
  memory MCP snapshot (`shared-json-file.ts`), and uploads when the folder is linked to a
  project.

### 4.3 Review: the sequence

```
review request ─▶ planReview (walk + manifest diff; no reads of unchanged files) ─▶ confirm chip (files·packs·≈calls·≈cost)
   ─▶ IngestionPipeline per changed file: parse ─▶ extract (pure) ─▶ cache extracted by content hash
   ─▶ resolveEntities: exact normalized keys merge; near-duplicates (knowledge index) become 'possible-same' findings, never auto-merged
   ─▶ judgement (only sections the pack marks, only changed hashes, ≤ budget; routed: local engines → cheap tier):
        claims · summaries · contradicts/agrees on near-duplicate claim pairs only
   ─▶ KnowledgeStore.write · markStale(changed sources) · knowledge_scopes.last_digest
   ─▶ knowledge index upsert(toCards) ─▶ view opens on the graph
```

Rules:

- **Writes need confirmation.** Review writes memory, so the confirm chip is mandatory
  whatever the gate's confidence (the deterministic-prefetch write rule).
- **The budget is enforced.** Past the budget, the remaining sections stay extracted-only
  and the report says how many. The person can continue, and continuing reuses the plan.
- **Stop aborts the review.** Facts already written stay, and are consistent per file.
- **Deterministic.** The same files at the same hashes give the same extracted graph and
  digest. Model output is never re-requested for an unchanged hash.
- **Respect ignores.** `.gitignore`, `.builderforce/ignore`, binary detection and a size cap
  (2 MB per file, configurable) all apply.

### 4.4 Partitions: ordered groups and who may use whom (generic)

```ts
export interface PartitionRule { id: string; order: number; match: string[] }           // globs
export interface PartitionRegistry { partitions: PartitionRule[]; allow?: Record<string, string[]> }
export function loadPartitions(pack: KnowledgePack, override?: unknown): PartitionRegistry;  // `.builderforce/partitions.json`
```

Each edge gets a verdict: `same`, `allowed`, `upward` (to a lower order) or `skips`
(anything else). The verdict is set only when the pack defines `allow`.

- **The code pack's default** is the N-layer rule:

  | Layer | Default globs | May use |
  |---|---|---|
  | presentation | `**/routes/**`, `**/components/**`, `**/app/**`, `**/pages/**`, `**/webview/**` | application, domain |
  | application | `**/application/**`, `**/use-cases/**` | domain |
  | domain | `**/domain/**` | (nothing) |
  | infrastructure | `**/infrastructure/**`, `**/db/**`, `**/adapters/**` | domain, application |

  The code pack also generates the dependency-cruiser `forbidden` rules from the same
  registry (`toDependencyCruiserRules`), so the gate and the view never disagree.
- **The docs pack's default** partitions by top-level folder, with no `allow`, so planes
  without verdicts.

### 4.5 Packs in this release

**docs** is built into memory:
- **Parsers:** markdown, HTML and plain text, plus the deterministic text of pdf and office
  files when an extractor is available on the host.
- **Extracted:** `file`, `section` (the heading breadcrumb), `contains`, `links` (relative and
  wiki links, resolved to `src:` refs), `mentions` (exact normalized match against known
  entity keys) and front-matter keys.
- **Judgement:** for each section, `claims[]` (subject, predicate, object, quote span) and
  `entities[]` (name, type). For near-duplicate claim pairs, `contradicts` or `agrees`. The
  output is schema-validated, and invalid output is dropped and counted.
- **Findings:** broken link, orphan document (no inbound links), near-duplicate sections,
  contradiction, stale claim.

**code** is registered by Builderforce from `packages/agent-tools/src/knowledge/codePack.ts`:
- **Parser and extractor:** a `repo-map` extractor gives `references`, weighted by shared
  identifiers. Symbols come from `WorkspaceSymbolIndex` or tree-sitter, and areas from the
  `/working` `areaOfPath`.
- **Analyzers:** the existing `codeAnalysis.ts` produces `duplicate` edges (jscpd), cycles
  (dependency-cruiser) and unused badges (knip), and is cached per sha. On web hosts the
  analyzer output is the last uploaded snapshot (`PUT …/code-analysis/:sha`).
- **Partitions:** the N-layer default.
- **Findings:** layer violation, cycle, clone group, near-duplicate, unused, unlayered share.
- **Judgement:** none by default. Code review stays the agent's job, and Fix with agent
  routes to it.
- **Live:** `pendingChanges` and diffs (VS Code), or VFS watch (web).

### 4.6 The view: `@builderforce/knowledge-graph-view` (source-only React)

It lives in a package rather than `frontend/src` because Rovr can import only source-only
packages. The package is pack-agnostic: lenses, legends and finding actions come from
registries.

| File | Responsibility |
|---|---|
| `KnowledgeGraphView.tsx` | Root. Props: `{ source: KnowledgeGraphSource; labels: KnowledgeGraphLabels; onCompose?(text: string): void; initialFocus?: string[]; initialLens?: LensId }`. Shows an explained empty state when there is no scope, with **Review a folder** as the call to action. |
| `useKnowledgeGraph.ts` | load, live updates, lens, focus, search and review progress |
| `lenses.ts` | `LENSES: Record<LensId, { packs; nodeStyle; edgeFilter; legend; insights }>`. A lens is a row. |
| `scene/GraphScene.tsx` | r3f; instanced nodes; one `LineSegments` buffer per edge kind; OrbitControls (touch); fly-to |
| `scene/layout3d.ts` | Deterministic. Partition → plane; areas → seeded spiral by importance; nodes → fixed-iteration relaxation with the seed from the root id. Equal input gives equal coordinates. |
| `scene/themeColors.ts` | `--kg-*` tokens via `getComputedStyle`, re-read on theme change; no literals |
| `TracePanel.tsx` | SVG lanes and arrows from `Trace`; *Copy as Mermaid* |
| `PartitionMatrix.tsx` · `FindingsPanel.tsx` · `NodePanel.tsx` · `ReviewProgress.tsx` | Insights; findings with *Fix with agent*; the node's facts, claims and *Add fact*; live review progress. Side panels use SlideOutPanel semantics. |
| `ListFallback.tsx` | No WebGL, or reduced motion: the same data grouped by partition, with every lens's findings |

Standards that apply in full:

- **Labels.** Typed `KnowledgeGraphLabels` with English defaults (the brain-ui pattern).
  Hosts pass `knowledgeGraph.*` from all five catalogs; Rovr uses `_locales` in five
  languages. The package hardcodes no strings.
- **Theme.** Tokens only; both themes checked.
- **360px.** The view opens focused (top 60 nodes), lenses sit in a deliberate horizontal
  scroller, panels are sheets, and tap targets are at least 40px.
- **Performance.** Up to 2000 nodes and 8000 edges as instanced geometry. Layout runs in a
  worker or on idle. The 3D chunk is lazy, and the first paint is the list.

```ts
export interface KnowledgeGraphSource {
  scopes(): Promise<Array<{ rootId: string; title: string; packs: string[]; lastReviewedAt?: string }>>;
  load(rootId: string, opts?: { focus?: string[]; maxNodes?: number }): Promise<KnowledgeGraph | null>;
  review?(req: { rootId?: string; pick?: boolean }): AsyncIterable<ReviewProgress>;   // plan → confirm → run
  search?(rootId: string, q: string): Promise<Array<{ ref: string; score: number; tier: string }>>;
  subscribeLive?(rootId: string, cb: (g: KnowledgeGraph) => void): () => void;
  rememberFact?(fact: { content: string; ref: string }): Promise<void>;
}
```

### 4.7 Hosts

| Host | DirectorySource | KnowledgeStore | Review runs | Graph built |
|---|---|---|---|---|
| VS Code | workspace folder (`vscode.workspace.fs`), with an explorer context menu | the platform API when the workspace is linked to a project, else `localSnapshotStore` | extension host | extension host |
| On-prem / container | container fs | platform API | agent runtime | agent runtime; it uploads its code-analysis snapshot |
| Web · Canvas · Studio | the webcontainer VFS (`list`/`readFile`/`watch`), a Cloud Drive connection, or a folder upload (`webkitdirectory`) | platform API | browser worker. Docs and code extraction are pure TS. Judgement goes through the API's routed model call. | `GET …/knowledge-graph` (server-built, cached) |
| Rovr | File System Access `showDirectoryPicker` | platform API | side-panel worker | same API as the web |

The adapters live beside their hosts:
- `clients/vscode/src/knowledge/*`
- `agent-runtime/src/agents/knowledge/*`
- `frontend/src/lib/knowledge/*`
- `clients/chrome/src/sidepanel/knowledge/*`

The two browser hosts share one host package, `packages/knowledge-browser`
(`@builderforce/knowledge-browser`): the `KnowledgeGraphSource` over the client, the Web
Worker review runner, the IndexedDB manifest, the upload and File System Access directory
sources, the Live overlay and the catalog → labels mapper. The web keeps only its VFS and
Cloud Drive sources, its fetch and its next-intl feed; Rovr keeps its fetch, its worker URL
and its catalog feed.

The view imports none of them.

### 4.8 API

| Route | Does |
|---|---|
| `GET /api/projects/:id/knowledge/scopes` | lists the reviewed roots |
| `GET /api/projects/:id/knowledge-graph?root=&focus=&maxNodes=&at=` | the use case `getKnowledgeGraph` calls ports `KnowledgeStorePort`, `ExtractedCachePort` (R2, by content hash), `RepoGraphPort` (code pack) and `AnalysisSnapshotPort`, then `buildGraph`. `at` = a past review digest (Compare's baseline, a scope's `previousDigest`): built from that review's immutable snapshot `knowledge/{t}/{p}/{root}/reviews/{digest}.json` with the current facts and relations |
| `POST /api/projects/:id/knowledge/write` | the `writeKnowledge` use case, the single writer: facts + relations + scope digest, batched and bounded (≤ 500 rows per call) |
| `PUT /api/projects/:id/code-analysis/:sha` | the code pack's analyzer snapshot (≤ 2 MB, schema-validated, R2) |
| `PUT /api/projects/:id/knowledge/extracted/:hash` | extracted output by content hash (≤ 1 MB). Extracted output is immutable per hash, so web hosts can build without re-uploading the source. |
| `POST /api/projects/:id/knowledge/judge` | the judgement port for browser hosts. It is a routed model call through the existing gateway and usage rows, so savings and spend are attributed as for any call. |
| `GET /api/projects/:id/knowledge/search?root=&q=` | knowledge index search |

- **Layering.** Routes take application ports. No route imports a table or R2.
- **Caching** goes through `getOrSetCached`.
  - The key is `kg:v3:${tenant}:${project}:${root}:${scopeDigest}:${knowledgeVersion}:${focusHash}:${maxNodes}`.
  - `knowledgeVersion` is a per-project version token, bumped by `writeKnowledge` and by
    every fact write.
  - There is no TTL invalidation: new data changes the key.
- **Tenancy.** `resolveMembership`. Privacy: paths, fact text and quote spans of no more than
  3 lines; never whole files.

### 4.9 Prefetch rows

These rows are added to the deterministic-prefetch registry:

| id | kind | Does |
|---|---|---|
| `knowledge.review-dir` | answer (**write**, so always confirmed) | `/review <dir>`; "review / map / build a knowledge graph of <dir>". Runs `planReview`, shows the confirm chip, then `reviewDirectory`. |
| `knowledge.ask` | answer (read) | Questions about a reviewed root. Knowledge index + graph expansion. It settles with no model only above its threshold; otherwise the hits ride into the turn as PREFETCH context. |
| `knowledge.graph` | answer (read) | `/graph`; "show me the graph / layers / duplicates". Opens the view focused on the files named in the text. |
| `dup.check` · `deps.cycles` · `deadcode.check` · `arch.boundaries` | as specified there | The executors call the code pack's analyzers. The summary is rendered from `buildGraph(...).findings` and carries an **Open in graph** chip. |

### 4.10 Consolidation

- **`CodeAuditVisualizer` becomes `KnowledgeGraphView`.**
  - Its tabs map to the Structure, Duplication, Unused and Compare lenses.
  - The file becomes an adapter, a source built from the tool's `CodeAnalysisComparison`.
  - Its **existing test file runs unchanged** as the parity oracle. The old SVG code is then
    deleted, after a grep across frontend, webview and packages.
- **`buildChangeGraph`** (`diffModel.ts`) adopts `NodeRef` ids (`src:${rootId}::${path}`).
  This fixes the multi-root `package.json` merge.
- **Run-end durable facts populate `file_anchors`** (including `contentHash`), using the
  `contextPack/focusPaths.ts` extractor, so they join the graph and can go stale.

## 5. Edge cases

1. **Not linked to a project.** The graph builds and persists locally. Linking uploads it
   through `writeKnowledge`, with idempotent upserts on the unique keys.
2. **A source changes after judgement.** Its `model` facts and relations get `stale_at`.
   They stay visible, marked stale, until the next review re-judges or drops them. They are
   never silently treated as current.
3. **A huge directory.**
   - `planReview` is a walk plus a manifest diff only.
   - The confirm chip shows the file count and the ≈ budget.
   - The graph opens bounded: by default the top 400 by importance, plus every finding's
     nodes and their one-hop neighbours, with the rest folded into areas.
   - Search reaches everything through the index.
4. **No model available or allowed.** The review runs extracted-only. Lenses that need
   judgement (Claims) show an explained empty state. Everything else works.
5. **Mixed folders.** Packs compose: a repository's `docs/` is docs-pack nodes beside
   code-pack nodes in one graph. `mentions` links a doc section to a code symbol by exact key.
6. **No WebGL, or reduced motion:** `ListFallback`.
7. **`mentions` freshness.** A file's `mentions` are extracted against the entity keys known
   when that file was extracted, and cached with its content hash. A newly judged entity is
   linked from unchanged files at their next change. This is intended: recomputing mentions
   on every build would re-extract every source per request, which the caching rule
   forbids. A full re-review (*Re-review all*) refreshes them.
8. **Re-review granularity is the section.** Inside a changed file, sections whose hash is
   unchanged keep their claims: they are re-anchored to the new file hash, not re-judged.
   A file the budget cut short stays "changed", so *Continue* judges only what's left.

## 6. Workstreams

| WS | Repo | Scope | Acceptance |
|---|---|---|---|
| WS1 | memory | `/knowledge`: model, `buildGraph`, `resolveEntities`, partitions, `traceGraph`, `toMermaid`, findings, importance, `toCards`; the optional `ingest` `extract` and the docs pack; `planReview` / `reviewDirectory` with ports; `localSnapshotStore`. Released via tag. | Pure tests: <br>• equal input gives a byte-identical graph and digest; <br>• extracted edges are never written to the store; <br>• a changed hash marks only that source's model facts stale; <br>• the budget stops judgement and the report counts the rest; <br>• existing ingest tests run unchanged. |
| WS2 | api | Migration 1278 (expand); `writeKnowledge` as the single writer; the seven routes; `knowledgeVersion`; caching; the facts routes and run-end memory routed through the writer; run-end anchors. | Route tests: <br>• tenancy; <br>• a cache hit, then a miss after a write; <br>• the batch and size bounds; <br>• `origin: 'extracted'` is rejected; <br>• a run-end fact naming a path stores an anchor with its hash. |
| WS3 | Builderforce | `@builderforce/knowledge-graph-view` + the web host (VFS, Cloud Drive, upload); a canvas surface row; `knowledgeGraph.*` in five catalogs. | Component tests on fixture graphs (code, docs and mixed): <br>• every lens; <br>• search; <br>• trace; <br>• Fix with agent goes to `onCompose`; <br>• review progress; <br>• list fallback parity; <br>• the empty state. <br>Both themes and 360px checked. |
| WS4 | Builderforce | The code pack (`agent-tools/knowledge/codePack.ts`): the repo-map extractor, analyzers and partitions with dependency-cruiser rule generation; the prefetch analyzer executors and `knowledge.graph`. | The code fixture graph shows violations, cycles and clone groups that match `codeAnalysis` output. `/dup` answers with `skippedLlm` and an Open in graph chip. |
| WS5 | Builderforce | VS Code: the explorer menu, `/review`, `knowledge.review-dir` and `knowledge.ask`, the confirm chip, the extension-host review, a tab in the Visualization panel, live updates. On-prem host. | Panel test: <br>• review a fixture folder, and the graph renders; <br>• editing one doc marks its claims stale; <br>• `knowledge.ask` answers from the graph. <br>A Sonnet agent packages and installs the VSIX. |
| WS6 | Builderforce | Rovr (directory picker, view, lazy three chunk, `_locales` × 5); the `CodeAuditVisualizer` consolidation; `buildChangeGraph` `NodeRef`; Add fact. | Rovr renders the WS3 fixtures identically. `CodeAuditVisualizer.test.tsx` passes unchanged, then the old code is deleted. A fact added in VS Code shows on the web. |

Ordering:
- WS1 comes first, released before any Builderforce WS imports it.
- WS2 and WS3 run in parallel after it.
- WS4, WS5 and WS6 come after those.
- The knowledge index ([deterministic-knowledge-index.md](../design/deterministic-knowledge-index.md))
  WS1–2 run beside WS1–2 here. Search and near-duplicates are optional ports until they land.

This is a new capability. WS5's release carries a `release_notes` row (category `new`) and an
Idea-to-Real blog post, "Point it at a folder and see what it knows". It sits in **Idea →
Read** for docs (understand what you have) and **Make → Build** for code (judge the shape,
not the lines).

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

## 8. Decisions (operator, 2026-10-28)

1. **The canvas surface name** is `knowledge`.
2. **The default review budget** is 200 judged sections per review before the chip asks
   again, routed to local engines first.
3. **Deleting or superseding a fact from the node panel** is allowed for its author or a
   project admin only, through `DELETE …/facts/:key`, which also removes its relations.
4. **Unlinked VS Code folders** stay local-only (`localSnapshotStore`) until linked; linking
   uploads them.

Knowledge index decisions (taken as proposed):
- the cloud embedder stays bge-m3;
- `bf-index` gets the shared comparator only;
- there are no per-symbol cards.
