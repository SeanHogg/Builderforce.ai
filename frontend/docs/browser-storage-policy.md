# Browser storage policy

| Resource | Store | Strategy | Retention and safety |
|---|---|---|---|
| Offline shell and manifest | Cache Storage, `bf-shell-*` | Precached during service-worker install | One build; older Builderforce shell caches are deleted on activation |
| Versioned JS, CSS, fonts, and images | Cache Storage, `bf-static-*` | Cache first with background refresh | One build; failed responses are never stored |
| API responses | None in the service worker | Network only | Domain-owned in-memory read-through entries are bounded to 256 and explicitly invalidated |
| Local Canvas drafts | Existing browser persistence | Application managed | Never touched by service-worker eviction |
| Model artifacts | Model-owned IndexedDB/cache adapters | Application managed | Must be versioned and quota-checked before promotion; not managed by the shell worker |

Service-worker activation deletes only cache names beginning with `bf-`. It does not delete
IndexedDB, Cache Storage owned by model runtimes, or user-authored drafts. Updates retain the
existing visible `SKIP_WAITING` flow.
