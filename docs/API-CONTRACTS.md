# API wire contracts

## Timestamps

All JSON API timestamps use ISO 8601 in UTC, including the trailing `Z` (for example,
`2026-07-25T07:11:00.123Z`). This applies to both camelCase and legacy snake_case fields.

Database routes should project typed Drizzle timestamp columns and allow JSON
serialization to produce the wire value. Do not cast timestamps to Postgres text: its
timezone-less form is ambiguous and is not consistently parseable by browsers. Code that
performs timestamp arithmetic must convert explicitly with `Date#getTime()` (or parse a
documented external ISO string) rather than depending on a driver-specific representation.

Read-through cached responses follow the same JSON shape on a loader miss and on L1/KV
hits; `Date` instances are normalized to ISO strings before the fresh value is returned.

## Knowledge graph API

The knowledge graph API (PRD 38, `docs/specs/38-prd-knowledge-graph.md` §4.8) is one router
(`api/src/presentation/routes/projectKnowledgeRoutes.ts`) served at two front doors:

| Door | Prefix | Credential | Acts for |
|---|---|---|---|
| Person | `/api/projects/:projectId` | tenant JWT (people and VS Code) | a person: may write `human` and `model` origins |
| Agent host | `/api/agent/projects/:projectId` | agent-host key | a machine: may write `agent` and `model` origins, never `human` |

Every route below is relative to either prefix and serves the same shapes. Each handler
checks that the project belongs to the caller's tenant before it does anything else, so a
project in another tenant is `404 project not found`, never `403`.

### Routes

| Method and path | Request | Response |
|---|---|---|
| `GET …/knowledge/scopes` | none | `{ scopes: [{ rootId, title, packs, lastDigest?, lastReviewedAt?, previousDigest? }] }`. A scope with no stored title reports its `rootId` as `title`. |
| `GET …/knowledge/facts?root=` | `root` required | `{ facts, viewer }`. Each fact is `{ key, content, source, importance, origin, fileAnchors, updatedAt?, createdBy }`. `viewer` is `{ userId, canAdmin }` and states who the reader is for the delete rule below. |
| `GET …/knowledge-graph?root=&focus=&maxNodes=&at=` | `root` required. `focus` may repeat (node refs). `maxNodes` is clamped to 1–2000 (default 400). `at` is a past review digest (hex, 8–64 characters) and builds the graph as that review saw it, with today's facts and relations. | `{ graph }`, a `KnowledgeGraph`: `{ scope: { rootId, packs, digest }, nodes, edges, findings, stats: { sources, nodes, edges, stale, truncated } }` |
| `POST …/knowledge/write` | `{ scope?, facts[], relations[], stale[] }`, at most 500 rows in total and 4 MB. A fact is `{ key, content, source?, importance?, origin?, fileAnchors[] }`. A relation is `{ from, to, kind, weight, origin, confidence?, sourceHash?, staleAt? }`. A stale mark is `{ sourceRef, currentHash }`. | `{ ok: true, factsWritten, factsSkipped?, relationsWritten, staleMarked }`. `factsSkipped` lists machine facts whose key a person authored; they are never overwritten, and the rest of the batch still lands. |
| `GET …/knowledge/extracted/:hash` | none | `{ extracted }`, the `Extracted[]` stored under that content hash |
| `PUT …/knowledge/extracted/:hash` | an `Extracted[]` array, at most 1 MB. Every entry's `sourceHash` must equal `:hash`. | `{ ok: true, hash }` |
| `PUT …/code-analysis/:sha?root=` | a code-analysis snapshot (`{ version: 1, id, capturedAt, source, tools, nodes, edges, issues }`), at most 2 MB. `root` names the root the snapshot belongs to; without it the project's linked repository is the root. | `{ ok: true, sha, rootId }`. Snapshots are stored per `(root, sha)`. |
| `POST …/knowledge/judge` | `{ kind: 'extract' \| 'compare', items: [{ ref, text, sourceHash }] }`, 1–8 items, each `text` at most 20,000 characters, body at most 256 KB | a `JudgementResult`: `{ extract?: [{ ref, claims, entities }], compare?: [{ a, b, relation, confidence }], invalid }`. A routed, metered model call under the caller's tenant. |
| `GET …/knowledge/judge/estimate` | none | `{ perCallUsd, model, local }`; see below |
| `GET …/knowledge/search?root=&q=&k=` | `root` and `q` required. `k` defaults to 10 and caps at 50. | `{ hits: [{ id, score, tier }], tiers, digest }` |

`DELETE …/facts/:key` (the project facts router) retires one fact and every relation that
names it, and answers `{ ok, removed, relationsRemoved, key }`. A project admin (tenant role
manager or above, or a superadmin) may delete any fact. A fact's author may delete it. Any
caller may delete a fact that has no recorded author. Anyone else gets `403`.

### The judge cost estimate

`GET …/knowledge/judge/estimate` prices ONE judged section for a review's confirm chip. The
server resolves the route a real judge call would take, without making a model call, and
prices the head of that chain.

| Field | Type | Meaning |
|---|---|---|
| `perCallUsd` | number or `null` | ≈ USD of one judged section. `0` for a free model or a local engine. `null` when the price is unknown. |
| `model` | string or `null` | The model the call routes to first. `null` when nothing is routable. |
| `local` | boolean | `true` only when that model runs on the tenant's own hardware (an on-device engine such as a self-hosted Ollama or FreeToken). A cloud model that refuses the Worker's egress is priced and `local: false`. |

A client multiplies `perCallUsd` by the review plan's `estimatedModelCalls`. The result is an
estimate (≈), never a bill.

### Errors

Error bodies are `{ error }`, plus `code` where a caller can branch on it. A body that fails
schema validation answers `400 { error, issues: [{ path, message }] }`.

| Status | `code` | When |
|---|---|---|
| 400 | | `root is required`; `root and q are required` (search); `invalid digest` (`at`); `invalid hash`; `invalid sha`; the analysis `PUT` with no `root` and no linked repository |
| 400 | `origin_mismatch` | A row claims an origin the caller cannot write: `human` from an agent host, or `agent` from a person |
| 400 | `extracted_not_stored` | A row carries `origin: 'extracted'`. Extracted output is recomputed from sources and never stored. |
| 400 | `missing_source_hash` | A `model` relation on a source (`src:`) names no `sourceHash` |
| 400 | `source_hash_mismatch` | An extracted entry is at a different hash than the `:hash` it was uploaded under |
| 401 | | No valid credential for the door |
| 404 | | `project not found` (not the caller's tenant); `unknown knowledge root` (graph, facts, search, including a graph `at` a digest with no snapshot); `not found` (an extracted hash never uploaded) |
| 409 | `fact_owned_by_person` | `POST /api/projects/:projectId/evermind/learning/candidates/:candidateId/transfer`: the learning's fact key was authored by a person, and a machine write never overwrites it. The manager edits or retires that fact, or rejects the learning. |
| 413 | `payload_too_large` | A body over its limit (write 4 MB, extracted 1 MB, analysis 2 MB, judge 256 KB) |
| 413 | `too_many_rows` | A write carries more than 500 rows (facts, relations and stale marks together) |

### Caching

Reads are cached server-side with `getOrSetCached`, keyed so that new data changes the key.
No response sets a client cache header, and no read waits on a TTL to see a write.

| Read | Key | Invalidated by |
|---|---|---|
| graph | `kg:v3:{tenant}:{project}:{root}:{scopeDigest}:{knowledgeVersion}:{focusHash}:{maxNodes}` | a new review digest, a new commit of the linked repository, any knowledge write |
| scopes | `ks:v1:{tenant}:{project}:{knowledgeVersion}` | any knowledge write |
| facts | `kf:v1:{tenant}:{project}:{root}:{scopeDigest}:{knowledgeVersion}` | a new review digest, any knowledge write |
| judge estimate | `kjc:v2:{tenant}:{routingInputsVersion}`, **300 s TTL** | a change to the tenant's providers, plan or model selection; otherwise the TTL |

`knowledgeVersion` is the project's fact-store version token. A knowledge write, a fact
write or delete, an extracted-output upload and an analysis-snapshot upload each bump it. A
graph read with `at` is keyed on `@{at}` instead of the root's current digest, because that
review snapshot is immutable. The judge estimate cannot see key health, cooldowns or price
book changes, which is why it also expires.
