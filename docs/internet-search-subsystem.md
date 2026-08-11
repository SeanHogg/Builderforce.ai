# Internet search subsystem

## Architecture audit

Builderforce already provides the infrastructure this subsystem needs:

- Cloudflare Workers is the API and orchestration runtime.
- Neon Postgres is the typed system of record and supports transactional frontier claims.
- The Worker already has tenant JWT authentication, a per-tenant rate limiter, structured error reporting, cron dispatch, and guarded outbound HTTP.
- The LLM gateway exposes one built-in MCP catalog to the Brain, VS Code, cloud agents, and remote MCP clients.
- Vendor-backed `web.search` and guarded `web.fetch` exist. They remain a coverage fallback while the owned index is populated.
- Embedding vendors already sit behind the gateway. A future Vectorize adapter can therefore be added without coupling crawling or lexical retrieval to a specific model.

No new independently operated database, auth system, or LLM gateway is introduced.

## Decisions

1. **Bounded context:** `web_search_*` tables and `application/webSearch` own crawling and retrieval. Presentation only validates HTTP input; infrastructure owns persistence and network access.
2. **Persistent frontier:** Postgres is the development frontier. Claims use row locks and leases so a failed Worker can resume. The port can later be implemented with Cloudflare Queues without changing the crawler.
3. **Real lexical index:** documents are tokenized at write time into an inverted index. Query time selects candidates by term and computes field-weighted BM25 with transparent score components. It never scans document bodies.
4. **Hybrid seam:** semantic retrieval is an optional `SemanticIndex` port. Lexical-only operation is valid; Vectorize plus the existing embedding gateway is the production adapter planned for phase 3.
5. **Safety first:** every URL is canonicalized, checked against allow/block policy and the shared SSRF/DNS guard, robots rules are cached and enforced, redirects are revalidated, bodies and crawl depth are bounded, and active content is never executed.
6. **Tenant isolation:** crawl configuration, frontier rows, documents, index terms, and API queries are tenant scoped. A shared global corpus can be introduced later as a separate policy decision.
7. **Incremental rollout:** the built-in search tool queries the owned index first and preserves the existing vendor search as a fallback until the corpus has coverage.

## Delivery phases

- **Phase 1–2 (this increment):** schema, persistent frontier, URL/robots policy, bounded HTTP fetch, HTML extraction, content hashing/change detection, inverted index, BM25 ranking/snippets, authenticated search/crawl/open APIs, native LLM tools, and focused tests.
- **Phase 3:** embedding worker, model-versioned chunks, Vectorize adapter, reciprocal-rank candidate fusion, offline relevance fixtures.
- **Phase 4:** richer multi-search orchestration, citation provenance validation, source-quality classifiers, query rewriting.
- **Phase 5:** Queue consumers, per-domain Durable Object coordination, sharded lexical service, authority/link graph, dashboards and SLOs.

## Operational dependencies

Run migration `0456_web_search.sql`. No Cloudflare resource must be provisioned for lexical search. Phase 3 will require a Vectorize index whose dimensions match the selected embedding model and metadata indexes created before ingestion. Queue bindings are deferred until crawl volume warrants dedicated consumers.

