# PRD 38 — The knowledge graph (any directory; code and docs first)

| | |
|---|---|
| Status | **Rev 3, approved 2026-10-28, in implementation.** |
| History | **Rev 1** (2026-10-25): a 2D code graph. <br>**Rev 2** (2026-10-28): 3D, layers, duplication. <br>**Rev 3** (2026-10-28, operator): <br>• **The knowledge graph is a structure of memory.** Facts on their own are recollections; facts connected by edges are knowledge. The engine moves into builderforce-memory, and there is no Builderforce `knowledge-graph` package. <br>• **A person can ask any host to review a directory**, code or not, and get a knowledge graph of it. <br>• **The first release ships two packs: code and docs.** Data (json/yaml/csv) is a later pack. |
| Owner | Agents program. Planning is done by the session model, implementation by Sonnet agents, review by Opus agents, and compile, test and packaging by Haiku agents. |
| Entry points | Web · Canvas/Studio · VS Code · Rovr · on-prem/cloud container |
| Builds on | builderforce-memory `ingest` (`ParserRegistry`, the parsers, the content-hash `IngestManifest`), `retrieval`, `/working` codemap. `project_facts` + `file_anchors`. `@builderforce/repo-map`. `agent-tools/codeAnalysis.ts`. [deterministic-prefetch.md](../design/deterministic-prefetch.md). [deterministic-knowledge-index.md](../design/deterministic-knowledge-index.md). |
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
   | `model` | a model judged it: a claim, a merged entity, "contradicts" | **stored** as memory, with its confidence and the content hash it was judged from. It goes **stale** when the source changes. |
   | `human` / `agent` | a person or a run asserted it: Add fact, a codemap, run-end facts, co-change | **stored** as memory, with provenance |

   Re-reviewing a directory re-reads only changed files. Only judgement costs model calls.
3. **One walk, one registry.** Reviewing a directory resolves every file through ONE
   `ParserRegistry`, composed from the packs by `composePacks`. A file kind is a registry row
   (a pack's parser), never a branch. Packs add what the kind needs: an extractor, partitions,
   lenses and findings.
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
    reviewDirectory()  ─▶ parse: the ONE ParserRegistry, composed from the packs (docs builtin, code registered)
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
                                              // 'supersedes' is reserved: no review or host emits it.
                                              // A person supersedes a fact by deleting it and adding
                                              // the new one (§8, decision 3).
  weight: number; origin: Origin; confidence?: number;
  verdict?: 'allowed' | 'same' | 'skips' | 'upward';   // set by partitions (§4.4)
  cycle?: boolean;
  stale?: boolean;                            // a stored relation whose source changed since it was judged (§5.2)
  byName?: string;                            // extracted edges only: the `[[Name]]` the link was written with.
                                              // buildGraph re-points it to the one present file of that name;
                                              // never emitted in the graph
}
export interface KnowledgeGraph {
  scope: { rootId: string; packs: string[]; digest: string };
  nodes: KNode[]; edges: KEdge[]; findings: Finding[];
  stats: { sources: number; nodes: number; edges: number; stale: number; truncated: boolean };
}

// pack contract: parsers are rows of the ONE ParserRegistry, composed from the packs (composePacks)
export interface DocumentParser {            // the ingest contract, extended
  id: string; accepts(s: SourceDocument): boolean; parse(s: SourceDocument): ParsedSection[];
  extract?(s: SourceDocument, sections: ParsedSection[], ctx: ExtractContext): Extracted;   // optional, pure
}
export interface Extracted {
  sourceRef: NodeRef; sourceHash: string;
  extractorVersion?: number;                 // EXTRACTOR_VERSION that produced it; a cached entry of another version is ignored
  nodes: KNode[]; edges: KEdge[]; keys: Array<{ ref: NodeRef; key: string }>;
}

export interface KnowledgePack {
  id: string;                                // 'docs' | 'code'
  parsers: KnowledgeParser[];                // a DocumentParser; composePacks registers them
  partitions?: PartitionRegistry;            // §4.4
  findings?: FindingRule[];                  // pure: (graph) => Finding[]
  judgement?: JudgementSpec;                 // what the model is asked, per section kind (schema-validated)
  analyzers?: AnalyzerPort;                  // host-run tools (code: codeAnalysis) → Extracted
}

export interface KnowledgeStore {            // port: platform API adapter or local snapshot adapter
  scopes(): Promise<ScopeRecord[]>;                      // { rootId, title, packs, lastDigest?, lastReviewedAt? }
  facts(scope: Scope): Promise<StoredFact[]>;            // project_facts rows (+ file_anchors)
  relations(scope: Scope): Promise<StoredRelation[]>;    // §4.2
  write(batch: { scope: ScopeRecord; facts: StoredFact[]; relations: StoredRelation[] }): Promise<void>;
  markStale(scope: Scope, sourceRef: NodeRef, currentHash: string): Promise<void>;
  getExtracted?(hash: string): Promise<Extracted[] | undefined>;      // extracted cache, by content hash
  putExtracted?(hash: string, extracted: Extracted[]): Promise<void>;
}
export interface DirectorySource {           // port: one adapter per host
  rootId: string; title: string; list(): AsyncIterable<{ path: string; hash: string; size: number }>;
  read(path: string): Promise<SourceDocument>; watch?(cb: (paths: string[]) => void): () => void;
}
export interface JudgementPort { judge(req: JudgementRequest): Promise<JudgementResult> }   // routed model call

export interface ReviewArgs {
  source: DirectorySource; store: KnowledgeStore; packs: KnowledgePack[]; manifest: IngestManifest;
  judgement?: JudgementPort;
  similar?: (ids: string[], texts?: ReadonlyMap<string, string>) => Promise<SimilarPair[]>;   // near-duplicate claim pairs (§4.3)
  budget: { modelCalls: number; ms: number };
  plan?: PlanDetail;                         // Continue: the confirmed plan, refreshed against the manifest, not re-walked
  force?: boolean;                           // Re-review all; ignored with `plan`
  signal?: AbortSignal; onProgress?(p: ReviewProgress): void;
}
export interface ReviewReport {
  rootId: string; digest: string; extracted: number; judged: number;
  unjudged: number;                          // sections and compare pairs left for Continue
  invalidJudgements: number; factsWritten: number; relationsWritten: number; staleMarked: number;
  readErrors: number;                        // files whose read threw: skipped, never retired (§4.3)
  aborted: boolean; durationMs: number;
}
export function reviewDirectory(args: ReviewArgs): Promise<ReviewReport>;

export interface PlanOptions {
  maxFileBytes?: number;                     // default 2 MB
  force?: boolean;                           // every file is `changed`; `removed` still comes from the real manifest
  compare?: boolean;                         // default true. A host that will not pass `similar` MUST pass false (§4.3)
}
export interface PlannedFile { path: string; hash: string; size: number; pack: string; changed: boolean; owed: boolean }
export interface PlanDetail {
  plan: ReviewPlan;
  files: PlannedFile[];                      // every included file, sorted by path
  prior: Map<string, string>;                // the manifest's path → hash
  extractor: ExtractorState;                 // the `:extractor` entry the plan was made against (§4.3)
  carried: string[];                         // owed paths the manifest holds that `files` does not list
}
export function planReview(source: DirectorySource, manifest: IngestManifest, packs: KnowledgePack[], opts?: PlanOptions): Promise<ReviewPlan>;   // the confirm chip's numbers
export function planDetail(source: DirectorySource, manifest: IngestManifest, packs: readonly KnowledgePack[], opts?: PlanOptions): Promise<PlanDetail>;
export function refreshPlan(detail: PlanDetail, manifest: IngestManifest): Promise<PlanDetail>;   // Continue, without a re-walk

export function extractFile(a: ExtractFileArgs): Promise<Extracted | undefined>;   // ONE file, cached by content hash (§4.3)
export function buildGraph(input: { rootId: string; extracted: Extracted[]; facts: StoredFact[]; relations: StoredRelation[];
  packs: KnowledgePack[]; live?: LiveOverlay; nearDuplicates?: SimilarPair[] }, opts?: { maxNodes?: number; focus?: NodeRef[] }): KnowledgeGraph;
export function traceGraph(g: KnowledgeGraph, from: NodeRef, opts?: { edgeKinds?: string[]; maxDepth?: number; maxSteps?: number; registry?: PartitionRegistry }): LanedTrace;
export function toMermaid(t: Trace, label: (r: NodeRef) => string): string;
export function toCards(g: KnowledgeGraph): IndexDoc[];   // feeds the knowledge index
```

`ScopeRecord.title` is a string in memory. The platform's `knowledge_scopes.title` column is
nullable, and the API reads a missing title as the root id (§4.2).

Files are under `packages/memory/src/knowledge/`:

| Area | Files |
|---|---|
| Model and ports | `model.ts`, `reviewModel.ts` (`DirectorySource`, `ReviewPlan`, `ReviewProgress`, `ReviewReport`, `ReviewArgs`) |
| Graph | `build.ts`, `truncate.ts`, `importance.ts`, `resolve.ts`, `refs.ts`, `partitions.ts`, `trace.ts`, `findings.ts`, `cards.ts` |
| Review | `plan.ts`, `owedFiles.ts`, `review.ts`, `reviewCompare.ts`, `reviewStored.ts`, `extractFile.ts`, `judge.ts`, `sources.ts` |
| Adapters and packs | `stores/localSnapshotStore.ts`, `packs/docs.ts` |

Each is at most 300 lines. `ingest/types.ts` carries the optional `extract` on
`DocumentParser`; `markdownParser`, `htmlParser` and `plainTextParser` implement it (in
`ingest/textParsers.ts`, over `ingest/docsExtract.ts`), and the existing ingest tests run unchanged.

### 4.2 Stored relations: one table, single writer

There is no new entity table:

- Judgement nodes (claims and merged entities) are **`project_facts` rows**, in key
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
  title       varchar(255),                   -- nullable; the API reads a missing title as the root id
  last_digest varchar(64), last_reviewed_at timestamp,
  CONSTRAINT uq_knowledge_scope UNIQUE (tenant_id, project_id, root_id)
);

-- 1279_knowledge_scope_previous_digest.sql
ALTER TABLE knowledge_scopes ADD COLUMN IF NOT EXISTS previous_digest varchar(64);   -- the digest before last_digest; Compare's baseline
```

- **3NF.** A scope's membership is derived from the anchor path prefix and is not stored. A
  relation's endpoints are refs, never copied text.
- **Origin is checked server-side, not trusted.** The writer accepts:
  - `human` only from a person, who becomes the author (`created_by`);
  - `agent` only from a machine caller (the agent-host door);
  - `model` from either, with no author, because a review a person starts runs the judgement under their session.

  Any other combination is rejected with `400 origin_mismatch`. When a row carries no origin,
  it defaults to the writer's kind: a person writes `human`, a machine writes `agent`.
- **A machine never overwrites what a person wrote.** A machine fact whose key a person
  authored is skipped. The key is listed in `factsSkipped` in the write result, and the rest
  of the batch still lands. A `codemap:` key is the one exception: a machine may merge into
  it, and it keeps its origin and author. The Evermind learning transfer writes through the
  same rule, so transferring a learning whose fact key a person authored answers
  `409 fact_owned_by_person` (§4.8).
- **Single writer.** The application use case `writeKnowledge` is the only writer. The facts
  routes and run-end memory route through it.
- **Other write rules.**
  - A `model` relation that touches a source (`src:`) must name the `sourceHash` it was
    judged from, or the write is refused with `400 missing_source_hash`. Without the hash
    nothing could ever mark the edge stale.
  - `origin: 'extracted'` is refused with `400 extracted_not_stored`.
  - A call carries at most 500 rows (facts, relations and stale marks together), or the
    write is refused with `413 too_many_rows`.
  - A `model` fact's content passes through `clampClaim` (§5.2).
  - The knowledge version is bumped once per call.
- **`project_facts` gains two columns** in the same migration: `created_by varchar(36)` (the
  author, which the delete rule needs) and `origin` (`model` | `human` | `agent`).
  - Facts written before 1278, and agent-written facts with no author, stay deletable by any
    project member. That keeps `memory_forget` working.
  - Ticket-scoped run outcomes live in `agent_memory`, which has no anchors, so they do not
    join the graph. Project-scoped outcomes and codemaps do.
- **Extracted cache layout.** One R2 object per source path
  (`knowledge/{tenant}/{project}/{rootId}/src/{sha256(path)}.json`, holding `{path, hash}`) plus
  the extracted output by content hash (`knowledge/{tenant}/{project}/extracted/{hash}.json`).
  The graph lists the root by prefix, so concurrent reviews never read-modify-write a shared
  manifest. Two more objects per root:
  - `…/{rootId}/reviews/{digest}.json`, the root's sources when a review recorded `digest`,
    written once and never rewritten (Compare's baseline);
  - `…/{rootId}/code-analysis/{sha}.json`, the code pack's analyzer snapshot of one commit,
    stored per `(root, sha)`.
- **Local, with no project linked.** `localSnapshotStore` persists the same shapes beside the
  memory MCP snapshot (`shared-json-file.ts`), and uploads when the folder is linked to a
  project.

### 4.3 Review: the sequence

```
review request ─▶ planReview (walk + manifest diff; no reads of unchanged files) ─▶ confirm chip (files·packs·≈calls·≈cost)
   ─▶ per changed file (extractFileDetailed): read ─▶ parse (the composed ParserRegistry) ─▶ extract (pure) ─▶ cache extracted by content hash
   ─▶ resolveEntities: exact normalized keys merge; near-duplicates (knowledge index) become 'possible-same' findings, never auto-merged
   ─▶ judgement (only sections the pack marks, only changed hashes, ≤ budget; routed: local engines → cheap tier):
        claims · entities
   ─▶ KnowledgeStore.write · markStale(changed sources)
   ─▶ analyzers ─▶ compare near-duplicate claim pairs (contradicts/agrees; needs `judgement` and `similar`)
   ─▶ manifest (files · judged · compare · extractor) · knowledge_scopes.last_digest
   ─▶ host side: knowledge index upsert(toCards) ─▶ view opens on the graph
```

The host owns the last step. `reviewDirectory` does not write the knowledge index: the
on-prem host upserts `toCards(graph)` into its index after the review, and the server
builds its index per graph digest on first search (§4.8).

Rules:

- **Writes need confirmation.** Review writes memory, so the confirm chip is mandatory
  whatever the gate's confidence (the deterministic-prefetch write rule).
- **The budget is enforced.** Past the budget (`budget.modelCalls`, default 200, or the
  `budget.ms` deadline), the remaining sections stay extracted-only and the report says how
  many (`unjudged`). The person can continue, and continuing reuses the plan.
- **Stop aborts the review.** Facts already written stay, and are consistent per file.
- **Deterministic.** The same files at the same hashes give the same extracted graph and
  digest. Model output is never re-requested for an unchanged hash.
- **Respect ignores.** `.builderforce/ignore` and every `.gitignore` apply; a nested
  `.gitignore` applies to its own folder. So do binary detection (by extension, and again on
  read) and a size cap (2 MB per file, configurable with `PlanOptions.maxFileBytes`). A skipped
  file is reported with a reason: `ignored`, `binary`, `too-large` or `no-pack`. PDF and
  Office files are reviewed only when a host parser claims their media type; otherwise they
  are skipped as `binary`.
- **A read error never retires a file.** A file whose read throws is skipped, and
  `ReviewReport.readErrors` counts it. Its knowledge and manifest hash stay as they were, and
  the next review tries it again. Only a file the fresh plan no longer lists is removed
  (`removed`).
- **Extractor upgrades are tracked per file.** The `knowledge:<root>:extractor` manifest entry
  holds the extractor version (`EXTRACTOR_VERSION`) plus the files still owed a re-extraction,
  as `owed:<path>` rows whose value is the calls each still costs.
  - A file is owed when the stored version differs from `EXTRACTOR_VERSION` (every file, once),
    or when an earlier run left it unfinished: cut by the budget, a failed judge call, a read
    error, or an abort before it. Owed does not depend on the file's content.
  - Every run writes the entry, including a run that aborts. A permanently unreadable file is
    the only file re-read; the rest of the root is not re-processed.
  - Unchanged sections re-anchor for free after an upgrade. Only new sections, such as the
    text before the first heading, cost a call.
  - A host stores these rows as opaque `{ id, hash }` values (the manifest contract is
    `IngestManifest.get/set/delete` of `ChunkFingerprint[]`).
- **The manifest keys per root** are `knowledge:<root>` (`{ id: path, hash }`),
  `knowledge:<root>:judged` (`{ id: sectionRef, hash: textHash }`), `knowledge:<root>:compare`
  (the awaiting backlog, below) and `knowledge:<root>:extractor`.
- **Near-duplicate claims are compared after judgement.**
  - The phase runs only when a pack asks for contradictions (`judgement.contradictions`) and
    the run has both a `judgement` port and a `similar` port.
  - `similar(ids, texts?)` receives the pending claim refs, sorted, and optionally each ref's
    claim text (`subject predicate object`), so a host need not re-read facts to embed them.
    A port that takes only `ids` keeps working.
  - Claims whose pairs could not all be compared (budget, a failed call, an abort) wait in the
    `:compare` entry, so *Continue* picks them up. The awaiting backlog is capped at 2000
    claims, and the oldest are dropped first. It is trimmed only after a compare actually ran;
    a run without the ports leaves it as it found it. Each row stores its age
    (`<age>:<fileHash>`, 0 the oldest), so the order survives a manifest that returns rows
    sorted by id. Only packs whose `judgement.contradictions` is true queue claims.
- **The estimate tracks what a run spends** (`estimatedModelCalls`):
  - one call per judged section of each file whose content changed, at
    `AVG_SECTION_BYTES` (1500) bytes per section, for packs that ask for claims or entities;
  - for an unchanged owed file, the calls it is still owed, plus one while an extractor
    upgrade is pending;
  - when compare is on and a pack asks for contradictions, one compare call per 10 of those
    sections, including the claims already waiting in the backlog.

  `PlanOptions.compare` (default `true`) says whether the run will compare. **A host that will
  not pass `similar` must pass `compare: false`**, or the estimate counts compare calls the run
  never spends. `reviewDirectory` plans with `compare` set to whether it was given both
  `similar` and `judgement`. The shared host runner (`planKnowledgeReviewDetail`) does the
  same. The browser hosts pass no `similar`, so they plan no compare calls.
- **Re-review all and Continue.**
  - `PlanOptions.force` (`ReviewArgs.force`) plans every file as changed whatever its hash.
    `removed` still comes from the real manifest, which a fake empty manifest would lose along
    with the compare backlog. The estimate still counts only files whose content changed
    (sections judged before are re-anchored, not judged again), plus the calls files are owed.
    A forced run cut short is forced again; *Continue* re-derives what is left from content
    hashes.
  - *Continue* passes the confirmed `PlanDetail` back as `ReviewArgs.plan`. `refreshPlan`
    re-reads `changed` against the manifest and owed list as the last run left them, without
    re-walking the directory.
- **One file, outside a review.** `extractFile` / `extractFileDetailed` re-extract a single
  file the way a review does (compose the packs, parse, extract with the known entity keys,
  stamp `EXTRACTOR_VERSION`, read and write the extracted cache by content hash). A host
  watching edits calls it. `knownKeysOfEntities` builds the entity keys from fact keys.

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
- **Parsers:** markdown, HTML and plain text. PDF and office files are reviewed only when a
  host registers a parser that claims their media type; the built-in text parsers decline
  those types inside `composePacks`, so without a host parser they are skipped as `binary`.
- **Extracted:** `file`, `section` (the heading breadcrumb), `contains`, `links`, `mentions`
  (exact normalized match against known entity keys) and front-matter keys.
  - `links` cover inline links, reference-style links (`[text][id]` with an `[id]: target`
    definition) and `[[wiki]]` links, resolved to `src:` refs.
  - A `[[wiki]]` link resolves by name to the one file of that name anywhere in the root.
    `buildGraph` does the re-pointing over the files present now, so a cached extract never
    depends on which other files exist (the edge carries `byName`).
  - A link that points outside the root stays as a broken link (a `missing` node).
  - The text before the first heading, or all of a file that has none, is a section under the
    reserved ref `#~preamble`, so it is judged and anchored like any other. A preamble that is only front matter belongs to the
    file, not to a section.
- **Judgement:** for each section, `claims[]` (subject, predicate, object, quote span) and
  `entities[]` (name, type). For near-duplicate claim pairs, `contradicts` or `agrees`. The
  output is schema-validated, and invalid output is dropped and counted.
- **Findings:** broken link, orphan document (no inbound links), near-duplicate sections,
  contradiction (it names both sections), stale claim. The docs pack supplies the broken-link,
  orphan-document and contradiction rules; near-duplicate and stale come from the generic
  rules. Relations and model facts on a deleted or changed source show as stale.

**code** is registered by Builderforce from `packages/agent-tools/src/knowledge/codePack.ts`:
- **Parser and extractor:** a `repo-map` extractor gives `references`, weighted by shared
  identifiers. Symbols come from `WorkspaceSymbolIndex` or tree-sitter, and areas from the
  `/working` `areaOfPath`.
- **Analyzers:** the existing `codeAnalysis.ts` produces `duplicate` edges (jscpd), cycles
  (dependency-cruiser) and unused badges (knip), and is cached per sha. On web hosts the
  analyzer output is the last uploaded snapshot (`PUT …/code-analysis/:sha?root=`, stored per root and sha).
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
| `KnowledgeGraphView.tsx` | Root. Props: `{ source: KnowledgeGraphSource; labels?: Partial<KnowledgeGraphLabels>; onCompose?(text: string): void; initialFocus?: string[]; initialLens?: LensId; openReview?: boolean; renderPanel?; confirm?; lenses?: LensId[]; lensControl?: 'chips' \| 'tabs'; onOpenSource?(location) }`. Shows an explained empty state when there is no scope, with **Review a folder** as the call to action. |
| `useKnowledgeGraph.ts` | load, live updates, lens, focus, search and review progress. A finished review is the only event that re-subscribes Live (a review can make the open root watchable), and it also reloads the root and its baseline. |
| `lenses.ts` | `LENSES: Record<LensId, { packs; nodeStyle; edgeFilter; legend; insights }>`. A lens is a row. |
| `scene/GraphScene.tsx` | r3f; instanced nodes; one `LineSegments` buffer per edge kind; OrbitControls (touch); fly-to |
| `scene/layout3d.ts` | Deterministic. Partition → plane; areas → seeded spiral by importance; nodes → fixed-iteration relaxation with the seed from the root id. Equal input gives equal coordinates. |
| `scene/themeColors.ts` | `--kg-*` tokens via `getComputedStyle`, re-read on theme change; no literals |
| `tokens.css` | The ONE definition of every `--kg-*` token (the colours below). Exported as `@builderforce/knowledge-graph-view/tokens.css`. |
| `TracePanel.tsx` | SVG lanes and arrows from `Trace`; *Copy as Mermaid* |
| `PartitionMatrix.tsx` · `FindingsPanel.tsx` · `NodePanel.tsx` · `ReviewProgress.tsx` | Insights; findings with *Fix with agent*; the node's facts, claims and *Add fact*; live review progress. Side panels use SlideOutPanel semantics. |
| `ComparePanel.tsx` · `EvidenceList.tsx` | The Compare lens's before/after; where a finding was seen (line ranges, an excerpt) |
| `ReviewLauncher.tsx` · `useReviewRun.ts` | The review entry (targets, picker) and the confirm handshake state. `ReviewProgress.tsx` shows the confirm chip's cost (below). |
| `Toolbar.tsx` · `Sheet.tsx` | Lens control (chips or tabs), search and mode; the package's own side sheet when a host passes no `renderPanel` |
| `ListFallback.tsx` | No WebGL, or reduced motion: the same data grouped by partition, with every lens's findings |

Standards that apply in full:

- **Labels.** Typed `KnowledgeGraphLabels` with English defaults (the brain-ui pattern).
  Hosts pass `knowledgeGraph.*` from all five catalogs; Rovr uses `_locales` in five
  languages. The package hardcodes no strings.
- **Theme.** Tokens only; both themes checked.
  - Every `--kg-*` token is defined ONCE, in `packages/knowledge-graph-view/src/tokens.css`.
    A host imports it from its entry
    (`import '@builderforce/knowledge-graph-view/tokens.css'`), and the bundler folds it into
    the host's one stylesheet.
  - The package's rules have zero specificity (`:where`), so a host's plain
    `:root { --kg-x: … }` wins wherever it sits in the cascade. The neutrals alias the shared
    `--bf-*` bridge. Dark is the default; `html[data-theme='light']` selects the darker twin of
    each hue.
  - Each host maps only what it must. The web and Rovr map nothing (Rovr mirrors its colour
    scheme onto `html[data-theme]`). The VS Code webview re-points the node, edge and finding
    hues at the editor's own theme colours (`webview/src/knowledgeGraph/hostTokens.css`).
  - Contrast targets: **3:1 for graphics** (node, edge and plane hues) and **4.5:1 for text**
    (muted, stale, error and violation tones used as text), against the host's surface in
    both themes. `tokens.css` records the computed ratios for the web palette.
- **360px.** The view opens focused (top 60 nodes), lenses sit in a deliberate horizontal
  scroller, panels are sheets, and tap targets are at least 40px.
- **Performance.** Up to 2000 nodes and 8000 edges as instanced geometry. Layout runs on idle
  (`requestIdleCallback`). The 3D chunk is lazy, and the first paint is the list.

```ts
export interface KnowledgeGraphSource {
  scopes(): Promise<Array<{ rootId: string; title: string; packs: string[]; lastReviewedAt?: string }>>;
  load(rootId: string, opts?: { focus?: string[]; maxNodes?: number }): Promise<KnowledgeGraph | null>;
  targets?(): Promise<ReviewTarget[]>;                                  // where this host can review
  review?(req: ReviewRequest, ctl: ReviewControl): AsyncIterable<KnowledgeReviewEvent>;   // plan → confirm → run
  search?(rootId: string, q: string): Promise<Array<{ ref: string; score: number; tier: string }>>;
  subscribeLive?(rootId: string, cb: (g: KnowledgeGraph) => void): () => void;
  rememberFact?(fact: { content: string; ref: string; rootId: string }): Promise<void>;
  factActions?(ref: string): Promise<{ delete?(): Promise<void> } | undefined>;   // Delete only for the author or an admin
  baseline?(rootId: string): Promise<{ graph: KnowledgeGraph; comparable?: boolean } | null>;   // Compare's "before"
  snapshot?: KnowledgeSnapshot;                                          // a source that already holds its graph
  evidence?(finding: Finding, side: 'current' | 'baseline'): FindingEvidence[];
}
```

The confirm chip states the plan's numbers. `ReviewEstimate` is
`{ modelCalls: number; costUsd?: number; local?: boolean }`: the cost in USD when the host
can price the judgement pass, or `local: true` when the pass runs on the person's own local
model, in which case the chip says "Runs on your local model — no cost." and shows no
amount. When the host cannot say, the chip states the calls and "Cost is shown after
routing."

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

**Review cost on the confirm chip.** Every host shows the review's cost beside the model
calls, from one price model:

- `GET …/knowledge/judge/estimate` (§4.8) is the price of ONE judged section. The typed
  client exposes it as `judgeEstimate()`.
- `reviewCostOf(modelCalls, price)` (`@builderforce/agent-tools/knowledge`) multiplies calls
  by that price and is the one place that validates it. A `ReviewCallPrice` is
  `{ perCallUsd: number | null; local: boolean }`, and a `JudgeEstimate` satisfies it. The
  result is `local`, `usd` or `unknown`; a missing, non-finite or negative price is
  `unknown`, never NaN or 0.
- `createKnowledgeSource` (`knowledge-browser`) takes a `callPrice` port and turns the cost
  into the view's `ReviewEstimate` (`estimateReview`). The web and Rovr pass
  `() => client.judgeEstimate()`. With no `callPrice`, or when it fails, the chip shows the
  calls only.
- VS Code and on-prem have no view of their own on the chat row. They append the cost to the
  `/review` confirm text (`reviewCostSuffix`: ` · ≈ $0.12`). On-prem passes
  `judgeEstimate()` as its price. The editor resolves it in the order it judges in: an
  on-device engine first (`{ perCallUsd: 0, local: true }`), then, when the inference mode
  is not local-only, the linked project's `judgeEstimate()`. An unlinked workspace with no
  local engine cannot price the call and shows the calls only.
- A judgement that runs on a local model shows "runs on your local model — no cost" (the
  chat row) or "Runs on your local model — no cost." (the web and Rovr chip), and no amount.

**Live.** Live is the directory's `watch`, drawn as an overlay on the graph. A reload
re-queries the root with the query the view last loaded it by (`focus`, `maxNodes`), so the
overlay never narrows or widens the graph. A finished review is the only event that
re-subscribes Live, because the review may have opened a root the host could not watch
before. A host re-opens a root reviewed in an earlier session through its provider's
`reopen` (the workspace VFS, a drive). A picked folder (an upload, a File System Access
folder) has no `watch`, so it is never subscribed.

**Prefetch rows.** `/review`, `/graph` and the code rows are the shared rows of §4.9. A browser host reviews in its view, so its `/review` opens the view's launcher; VS Code and on-prem review in their own process.

### 4.8 API

One router (`api/src/presentation/routes/projectKnowledgeRoutes.ts`) is mounted at two front
doors. People and VS Code use `/api/projects/:projectId/…` with a tenant JWT. On-prem agents
use `/api/agent/projects/:projectId/…` with their agent-host key. The paths below are
relative to either prefix. A request from the agent-host door acts for a machine, not a
person (§4.2: it can write `agent` and `model` origins, never `human`).

| Route | Does |
|---|---|
| `GET …/knowledge/scopes` | `{scopes}`: the reviewed roots, each `{rootId, title, packs, lastDigest?, lastReviewedAt?, previousDigest?}` |
| `GET …/knowledge/facts?root=` | `{facts, viewer}`: the root's stored facts with `createdBy` and `origin`, and `viewer` = `{userId, canAdmin}`, the delete rule stated for the reader so a host offers Delete exactly where `DELETE …/facts/:key` would allow it |
| `GET …/knowledge-graph?root=&focus=&maxNodes=&at=` | `{graph}`: the use case `getKnowledgeGraph` calls ports `KnowledgeStorePort`, `ExtractedCachePort` (R2, by content hash), `RepoGraphPort` (code pack) and `AnalysisSnapshotPort`, then `buildGraph`. `focus` repeats. `maxNodes` is clamped to 1–2000 (default 400). `at` = a past review digest (Compare's baseline, a scope's `previousDigest`): built from that review's immutable snapshot `knowledge/{t}/{p}/{root}/reviews/{digest}.json` with the current facts and relations |
| `POST …/knowledge/write` | the `writeKnowledge` use case, the single writer: `{scope?, facts, relations, stale}`, batched and bounded (≤ 500 rows per call, body ≤ 4 MB). Answers `{ok, factsWritten, factsSkipped?, relationsWritten, staleMarked}` |
| `GET …/knowledge/extracted/:hash` | `{extracted}`: extracted output by content hash |
| `PUT …/knowledge/extracted/:hash` | extracted output by content hash (≤ 1 MB). Extracted output is immutable per hash, so web hosts can build without re-uploading the source. Every entry must be at `:hash`. Answers `{ok, hash}`. |
| `PUT …/code-analysis/:sha?root=` | the code pack's analyzer snapshot (≤ 2 MB, schema-validated, R2), stored per `(root, sha)`: a root's paths are its own. Without `root`, the project's linked repository is the root. Answers `{ok, sha, rootId}` |
| `POST …/knowledge/judge` | the judgement port for browser hosts: `{kind: 'extract' \| 'compare', items}` (1–8 items, each ref ≤ 512 chars and text ≤ 20,000, body ≤ 256 KB). It is a routed model call through the existing gateway and usage rows (use case `knowledge_judge`), so savings and spend are attributed as for any call. Answers a `JudgementResult` |
| `GET …/knowledge/judge/estimate` | ≈ cost of ONE judged section, for the confirm chip (§3.1). See below. |
| `GET …/knowledge/search?root=&q=&k=` | knowledge index search: `{hits, tiers, digest}`. `k` defaults to 10 and caps at 50 |

Two routes outside the knowledge router complete the surface:

| Route | Does |
|---|---|
| `DELETE /api/projects/:id/facts/:key` (and the agent-door twin) | retires one fact AND every relation that names it (§8.3). Allowed to the fact's author, to a project admin (tenant role manager or above, or a superadmin), and, for a fact with no recorded author, to any caller. Otherwise `403`. Answers `{ok, removed, relationsRemoved, key}` |
| `POST /api/projects/:id/evermind/learning/candidates/:candidateId/transfer` | promotes an approved Evermind learning to a project fact through the single writer. A machine never overwrites a fact a person authored, so it answers `409` with `code: 'fact_owned_by_person'` (the manager edits or retires that fact, or rejects the learning). A candidate that is not approved is a plain `409` with no code |

**Errors.** Every body is `{error}`, plus `code` where the caller can act on it.

| Status | When |
|---|---|
| 400 | `root is required` (graph, facts, search, and the analysis `PUT` when the project has no linked repository), `root and q are required` (search), `invalid digest` (`at`), `invalid hash`, `invalid sha`; a body that fails its schema answers `{error, issues}`. Writer codes: `origin_mismatch`, `extracted_not_stored`, `missing_source_hash`. Upload code: `source_hash_mismatch` |
| 401 | no valid credential for the door |
| 404 | `project not found` (the project is not the tenant's), `unknown knowledge root` (graph, facts, search; also a graph `at` a digest with no snapshot), `not found` (an `extracted` hash that was never uploaded) |
| 409 | `fact_owned_by_person` on the Evermind transfer (above) |
| 413 | `payload_too_large` (a body over its limit, checked by declared length and again after parsing), `too_many_rows` (more than 500 write rows) |

**The judge estimate.** The server is the only party that knows where a judgement routes, so
it resolves the route the real judge call takes (the gateway's own seed + candidate chain, no
model call) and prices the head of that chain with the price book. Response
`{perCallUsd, model, local}`:

- `perCallUsd` is a number (0 for a free model or a local engine) or `null` when the price is
  unknown.
- `model` is the routed head, or `null` when nothing is routable.
- `local` is true only for a model that runs on the tenant's own hardware (vendor
  `runsOnDevice`: a self-hosted Ollama or FreeToken), which means on-device only. A cloud model
  that merely refuses the Worker's egress (Kimi) is priced and `local: false`.

The typed client method is `judgeEstimate()` (`@builderforce/knowledge-client`). It is an
estimate (≈), never a bill.

- **Layering.** Routes take application ports. No route imports a table or R2.
- **Caching** goes through `getOrSetCached`. New data changes the key; no read waits on a TTL
  to see a write.
  - The graph's key is `kg:v3:${tenant}:${project}:${root}:${scopeDigest}:${knowledgeVersion}:${focusHash}:${maxNodes}`.
    `scopeDigest` is the review digest plus, for the linked repository, the commit sha; for an
    `at` read it is `@${at}`, since that snapshot is immutable.
  - `GET …/knowledge/scopes` is keyed `ks:v1:${tenant}:${project}:${knowledgeVersion}`.
    `GET …/knowledge/facts` is keyed `kf:v1:${tenant}:${project}:${root}:${scopeDigest}:${knowledgeVersion}`.
  - `knowledgeVersion` is the project's fact-store version token. `writeKnowledge`, every
    fact write and delete, and each perception upload (extracted output, analysis snapshot)
    bump it, so a cached graph keyed on the old token is never served again.
  - Search builds on the widest graph the server builds (`maxNodes` capped at 2000), through
    the same cache. Its index is built from the graph's cards on first use and stored in R2
    per graph digest (`knowledge-index/{tenant}/{project}/{root}/{digest}.bin`).
  - A cached value lives at most a day in KV (`GRAPH_KV_TTL_SECONDS`, 86,400 s); its key
    already changes with every write.
- **The judge estimate's cache** is the one exception to "no TTL": `getOrSetCached` keyed
  `kjc:v2:${tenant}:${routingInputsVersion}` with a **300 s TTL**. There is no stored version for a
  tenant's routing settings, so `routingInputsVersion` is derived from what the gateway routes by:
  the provider rows (`id`, auth type, precedence), the effective plan and premium override, and each
  provider's selected models. A key connected, rotated or removed, a precedence change, a plan change
  or a new model selection is a new key. The token cannot see key health, cooldowns or the price
  book, which move the head of the chain or its price without any settings change, so the TTL bounds
  how long a stale estimate can be shown. It is an estimate (≈), never a bill. The key is per
  tenant, not per project: routing is per tenant.
- **Tenancy.** The door authenticates (a tenant JWT resolved through `resolveMembership`, or
  the host key), and every handler checks the project is the tenant's before a port exists.
- **Privacy.** Stored knowledge is a judgement about a source, never the source.
  - Paths, fact text and quote spans are bounded: a `model` fact's content passes through
    `clampClaim` (claim text ≤ 602 characters, quote ≤ 3 lines and 300 characters).
  - Extracted node labels are reduced to one bounded line before they are stored.
  - Never whole files.

### 4.9 Prefetch rows

These rows are added to the deterministic-prefetch registry:

| id | kind | Does |
|---|---|---|
| `knowledge.review-dir` | answer (**write**, so always confirmed) | `/review <dir>`; "review / map / build a knowledge graph of <dir>". In VS Code and on-prem it runs `planReview`, shows the confirm chip with the cost (§4.7), then runs `reviewDirectory` on the same plan. In a browser host it answers with a chip that opens the view's review launcher, whose own confirm chip is the confirmation. |
| `knowledge.ask` | answer (read) | Questions about a reviewed root. Knowledge index + graph expansion. It settles with no model only above its threshold; otherwise the hits ride into the turn as PREFETCH context. |
| `knowledge.graph` | answer (read) | `/graph`; "show me the graph / the layers / the dependency graph". Opens the view focused on the files named in the text. Duplicates, clones and cycles are the `dup.check` and `deps.cycles` rows, which answer with their own Open in graph chip. |
| `dup.check` · `deps.cycles` · `deadcode.check` · `arch.boundaries` (`/boundaries`) | as specified there | The executors call the code pack's analyzers. The summary is rendered from `buildGraph(...).findings` and carries an **Open in graph** chip. `arch.boundaries` counts only layer violations that are real imports and narrows to the files the person is working in; an analyzer that failed answers nothing, never "clean". |

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
| WS2 | api | Migration 1278 (expand); `writeKnowledge` as the single writer; the knowledge routes (§4.8); `knowledgeVersion`; caching; the facts routes and run-end memory routed through the writer; run-end anchors. | Route tests: <br>• tenancy; <br>• a cache hit, then a miss after a write; <br>• the batch and size bounds; <br>• `origin: 'extracted'` is rejected; <br>• a run-end fact naming a path stores an anchor with its hash. |
| WS3 | Builderforce | `@builderforce/knowledge-graph-view` + the web host (VFS, Cloud Drive, upload); a canvas surface row; `knowledgeGraph.*` in five catalogs. | Component tests on fixture graphs (code, docs and mixed): <br>• every lens; <br>• search; <br>• trace; <br>• Fix with agent goes to `onCompose`; <br>• review progress; <br>• list fallback parity; <br>• the empty state. <br>Both themes and 360px checked. |
| WS4 | Builderforce | The code pack (`agent-tools/knowledge/codePack.ts`): the repo-map extractor, analyzers and partitions with dependency-cruiser rule generation; the prefetch analyzer executors and `knowledge.graph`. | The code fixture graph shows violations, cycles and clone groups that match `codeAnalysis` output. `/dup` answers with `skippedLlm` and an Open in graph chip. |
| WS5 | Builderforce | VS Code: the explorer menu, `/review`, `knowledge.review-dir` and `knowledge.ask`, the confirm chip, the extension-host review, a tab in the Visualization panel, live updates. On-prem host. | Panel test: <br>• review a fixture folder, and the graph renders; <br>• editing one doc marks its claims stale; <br>• `knowledge.ask` answers from the graph. <br>A Haiku agent packages and installs the VSIX. |
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
