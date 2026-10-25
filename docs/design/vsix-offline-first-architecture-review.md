# Web, Rovr, and VSIX local-first architecture and batch sync review

Reviewed: 2026-10-18. Scope: the current working tree in `Builderforce.ai`, including uncommitted VSIX, provider, and audit work. Static architecture review; no live API traffic measurement, packaged VSIX validation, or implementation changes. `bf-verify-fdc` is a separate checkout and was not treated as the product source.

## Recommendation

Inference and memory implementation scope: [Shared offline memory scope](#shared-offline-memory-scope-folded-2026-10-25) below. Reuse the existing `builderforce-inference` engines and `builderforce-memory` knowledge/cognition/retrieval components. Across all modalities, automatic generation prefers a compatible downloaded WebLLM model on usable WebGPU; local memory recall/cache can satisfy eligible requests first. Preserve explicit pins and workload requirements, coordinate GPU resources, and prohibit gateway fallback offline.

Make **Web, Rovr, and VSIX follow the same durable local-first application pattern**, with optional account sync independent of execution. This is a requirement for all three modalities, including Web domain editing. Retain the shared Brain loop, model transports, governance decisions, and outbox primitives. Add shared domain/application contracts, host-specific transactional local stores, and one versioned server sync protocol. Merely increasing queue delays or selecting a local model cannot provide the requested behavior.

Interpret “offline” as **no BuilderForce API connection**, as requested. Direct provider access, Git remotes, external MCP, and model downloads need separate capability policies; they are not automatically internet-free. A direct connected account can satisfy “no BuilderForce API” while still requiring internet. A fully disconnected run requires downloaded model assets or an installed local inference runtime. If none is available, expose setup requirements and keep the request local; never silently fall back to BuilderForce.

In every modality, default to local execution with account sync disabled. Signing in establishes an identity; an explicit Connect/Enable sync action starts account synchronization. Reconnection can resume previously enabled sync automatically. Internet connectivity alone must not enable sync. Connected mode should continue executing locally and synchronize in batches; permission to use gateway inference or cloud execution is a separate choice.

### Common behavior across all modalities

Every supported domain operation follows the same path: presentation submits a command → shared application use case enforces domain rules → local transaction commits records and journal events → UI reads the local projection → optional sync imports/pulls account changes. Account connectivity must not select a different persistence implementation. All three use the same event identity, ownership, conflict, deduplication, import, and recovery semantics.

Host-specific capabilities remain explicit: VSIX has filesystem/Git tools, Rovr has tab/browser tools, and Web has browser workers and its available workspace tools. An unsupported capability returns a consistent capability result; it must not silently substitute a server operation. Shared architecture does not imply that every host can execute every tool.

| Concern | Shared requirement | Host-specific adapter |
|---|---|---|
| Persistence | Durable records plus atomic journal; same repository contracts | VSIX transactional host store; Web/Rovr IndexedDB |
| Execution | Shared application lifecycle and Brain engine; local history before network | Extension host, browser worker/page, side-panel lifecycle |
| Network policy | API-denied default; explicit sync and inference permissions | Host fetch/socket/frame/worker transport integration |
| Sync | One protocol/coordinator, destination binding, receipts, deltas, conflicts | VSIX process ownership; Web tab/worker lease; Rovr service-worker ownership |
| Offline startup | Installed assets and local data survive restart | Packaged extensions; Web service-worker/app-shell cache and versioned assets |
| Recovery | Interrupted execution is durable; unsafe actions never auto-replay | Host-specific suspension, shutdown, storage quota, and restart handling |

Web needs a cached executable application shell, routes, workers, localization, and already-installed model assets, in addition to IndexedDB domain storage. Initial website delivery/installation requires connectivity; subsequent offline startup must not depend on session validation, API-backed route loaders, redirects, or platform data fetches. Distinguish static application delivery from BuilderForce API access when measuring the zero-API contract. Browser storage eviction/quota and unavailable durable storage must be visible; an in-memory fallback cannot claim durable save.

## Current architecture and reusable pieces

| Surface | Execution | Persistence and sync today | Consequence |
|---|---|---|---|
| VSIX panel | Webview presents the conversation; extension host runs Brain and local workspace tools | Signed-in panel uses API persistence; host run persistence calls `postBrainMessages`; signed-out panel has an in-memory adapter; selected writes/steps use durable workspace Memento outboxes | A local model does not make the application offline or its whole history durable |
| VSIX native participant/session adapter | Native handler shares routing/tools with host components; optional session registration adapts the native handler | Attempts server chat creation; falls back to an unlinked run when no chat is returned | Native and panel flows both need the same local application store |
| Rovr / Chrome | Brain runs in the side panel; browser tools act on tabs | IndexedDB records for chats/messages/tasks/action ledger; service worker owns chat/task network outbox | Closest reusable local-first pattern, but not a complete cross-domain sync system |
| Web | Embedded Brain with browser/local-first inference and gateway transport | `brainConfig.persistence = brain` API adapter; IndexedDB step queues supplement it | Local inference and durable steps do not establish offline project/ticket/audit CRUD |
| API | Authoritative shared project/task/governance/runtime/audit services | Individual CRUD/ingest endpoints, message event keys, run outcome natural keys, and cache-backed idempotent responses | Useful foundations; inspected routes do not provide a general offline domain push/pull protocol |

Primary evidence:

- [VSIX host ports](../../clients/vscode/src/brainRunHostPorts.ts), [host lifecycle](../../clients/vscode/src/brainRunHost.ts), [native participant](../../clients/vscode/src/chatParticipant.ts), [webview driver](../../clients/vscode/webview/src/hostRunDriver.ts).
- [Panel composition](../../clients/vscode/webview/src/WorkspaceApp.tsx), [in-memory persistence](../../clients/vscode/webview/src/localPersistence.ts), [API persistence](../../clients/vscode/webview/src/persistence.ts), [VSIX API client](../../clients/vscode/src/bfApi.ts).
- [Rovr records](../../clients/chrome/src/store/records.ts), [local persistence](../../clients/chrome/src/persistence/localFirstPersistence.ts), [chat sync](../../clients/chrome/src/sync/chatSync.ts), [service worker](../../clients/chrome/src/background/serviceWorker.ts).
- [Web Brain runtime](../../frontend/src/lib/brain/runtime.ts), [Web step durability](../../frontend/src/lib/brain/stepDurability.ts), [shared Brain configuration](../../brain-embedded/src/config.tsx), [shared model stream](../../brain-embedded/src/hostModelStream.ts).

## Gaps and required changes

P0 blocks the requested offline contract or trustworthy synchronization. P1 is required for a complete, operable release.

| ID | Priority | Observed gap / architectural risk | Required change |
|---|---|---|---|
| G01 | P0 | No VSIX setting establishing an API-denied default. `localModels.enabled` defaults false; `localFirst` defaults true but supports gateway fallback. | Add independent platform connectivity, inference permissions, and sync policy. Offline forbids gateway fallback regardless of saved keys/model choices. |
| G02 | P0 | Requests originate from host API/auth/gateway clients, platform tools, webview fetch adapters, embedded frontend clients, streams, and meeting sockets. Gating only `bfApi` misses paths. | Enforce a shared platform transport policy before issuing requests, opening streams/sockets, or loading platform frames. Wire policy into host and webview; cover custom base URLs and redirects. |
| G03 | P0 | Host persistence is network-backed. Signed-out panel store explicitly disappears on panel close and never syncs. Native chat can execute unlinked. | Persist chats, turns, runs, steps, approvals, and lineage in the extension host first. Return local records to both panel and native surfaces; queue synchronization separately. Audit the existing signed-out panel-to-host persistence handoff. |
| G04 | P0 | Server numeric IDs and positive/negative ID conventions are woven through run/UI contracts. Signed-out webview adapter even allocates positive in-memory chat IDs. | Introduce stable client entity UUIDs, independent internal run keys, and durable client-to-server mappings. Do not change a live run key when its record receives a server ID. Remap all relationships explicitly. |
| G05 | P0 | VSIX projects/tasks/objectives/session lists are API reads with short-lived memory caches. Task status/archive/delete and other CRUD remain remote operations. | Add durable local project/ticket repositories and local views with pending changes over the last synchronized snapshot. Support local project creation and later account/project binding. |
| G06 | P0 | Most project/ticket/audit tools are dynamically fetched server MCP tools; local file tools cannot replace them. | Share domain schemas and validation; implement local adapters for the supported domain tools. Classify remaining tools as connected-only. Never enqueue arbitrary MCP calls as offline history. |
| G07 | P0 | “Local audit” first creates a server chat and server audit session, obtains a server briefing, reports findings remotely, and checks server completion. | Package versioned audit definitions/briefing construction and local result validation. Persist local audit sessions, findings, evidence, and remediation tickets; import results later without rerunning the audit. |
| G08 | P0 | Audit close intent invokes a cloud audit on the next activation. The pending intent contains project/audit/request IDs but no account/tenant binding. | Make close behavior explicit. Persist a local checkpoint/interrupted result, or a local next-start job. Never silently launch cloud work in offline mode; bind any later cloud job to identity and explicit dispatch permission. |
| G09 | P0 | Governance is fetched at run start, with a 60-second fresh and 10-minute stale in-memory cache; unreadable tenant policy can refuse a run. | Persist tenant/project-scoped policy snapshots and their version, validity, and offline permissions. Enforce approved snapshots locally. Missing/expired required policy blocks affected managed operations; personal unbound work uses explicit local policy. Signing out must not remove policy from previously managed records. |
| G10 | P0 | Tenant scopes protect many queued writes, but unknown-identity entries are unscoped and can adopt a future tenant. Rovr local chats/tasks and server mappings lack explicit account/tenant ownership fields. | Bind records and events to platform instance/account/tenant/project at creation where known. Put never-connected work in an unbound partition requiring explicit destination assignment. Do not infer ownership from whichever user signs in next. |
| G11 | P0 | Rovr chooses `taskProjectId()` when sending a queued task; a later settings change can change its destination. VSIX fact publication also uses the currently selected project. | Snapshot destination identity/project/repository into durable intents. Changing a UI selection cannot redirect pending work. Scope local-to-server mappings by destination. |
| G12 | P0 | Shared outbox connectivity means reachability, not an administrative ban: retry probes and explicit `flush` bypass the normal offline check; `drainWith` calls its request callback. Backlogs also replay on load/scope change. | Add an absolute send-permission gate covering every path and stopping retries when sync is disabled. Recheck at dispatch, cancel in-flight platform traffic on Disconnect, and preserve queued work. An online signal alone is insufficient. |
| G13 | P0 | Durable queues default to 1,000 entries and drop the oldest on overflow; permanent 4xx failures are dropped. Errors can also be swallowed by store callbacks. | Separate discardable telemetry from durable user work. No automatic eviction of unsynced history/tickets/audits. Use storage budgets, visible errors, recoverable dead letters, and explicit export/delete controls. |
| G14 | P0 | Memento stores whole queue snapshots; outbox `enqueue` returns before async persistence completes. Rovr appends records and then signals a separate worker queue, leaving a crash gap; local persistence strips prior step event keys. | Atomically commit each local domain mutation and its sync event. Preserve stable event identities through every queue boundary. Use a transactional journal/store with acknowledged durable writes before claiming data is saved. |
| G15 | P0 | Network batching is narrow: messages per chat, activity, outcomes, and error reports. Rovr still performs chat create, task create, and links as separate requests. | Add dependency-aware domain batch ingest with client references and per-item acknowledgements. One logical sync batch should replace many CRUD round trips. |
| G16 | P0 | General HTTP replay responses expire after 24 hours, use cache storage, and are written after successful execution. Concurrent misses and a commit/response-cache crash gap can execute twice. Fingerprinting checks method/path, not payload. | Enforce permanent or lifecycle-appropriate database uniqueness on tenant/device/event and client entity IDs, with payload hashes. Apply mutation and receipt transactionally. Existing message event keys are useful but do not cover all entities or side effects. |
| G17 | P0 | Ordinary message append routes derive comments, notifications, directed agent replies, and learning from incoming messages. Audit/ticket routes can trigger further automation. | Separate historical import from commands. Import must not replay actions, start agents, dispatch audits, send old mentions, or create duplicate remediation tasks. Use deduplicated server effect records for any intentionally permitted post-import effect. |
| G18 | P0 | Existing queues provide per-key order, not cross-entity dependencies, reconciliation, or optimistic concurrency across Web/Rovr/VSIX. | Add entity versions, `baseVersion`, conflict results, delete tombstones, dependency resolution, delta pull cursors, cursor expiry/resnapshot, and snapshot/pending-write merge rules. |
| G19 | P1 | Pending Git changes are a local current-working-tree view; session notes summarize some successful local tools. Neither is a complete immutable change history. | Capture run-linked change sets with repo identity, branch/base commit, paths, before/after hashes, and optional patches/artifacts. Preserve author attribution and avoid claiming unrelated existing edits. Upload evidence; never automatically apply patches on another device. |
| G20 | P1 | Project memory/context, model pins/catalogs/analytics, limbic context, and insights still use platform reads. Fact publishing is best-effort and its latest digest is process-local. | Persist versioned snapshots; use local memory recall and local fact operations offline. Sync changed facts/outcomes in batches, with provenance and conflict handling. Move learning out of ordinary historical turn ingestion and dedupe it by completed run/policy. |
| G21 | P1 | Attachment uploads, server summaries, remote creation/session/page data, project panels, OAuth/MCP management, approvals, meetings, and cloud execution have connected dependencies. | Define capability behavior for every destination. Keep local blobs and upload manifests; offer local summaries only where supported. Read cached platform data with freshness labels; show unavailable remote actions or explicit connected jobs. |
| G22 | P1 | Host-owned runs survive closing a panel, but in-memory run state does not provide recovery after extension-host termination. Rovr execution belongs to its disposable side panel. | Journal run lifecycle and checkpoints. Recover interrupted runs as interrupted, never falsely completed. Resume only safe steps; do not replay a shell command or external action merely because no result was recorded. |
| G23 | P1 | Existing sync feedback is uneven; dropping/refusing a batch can leave local records and sync status disagreeing. | Show mode, destination, last success, queued bytes/items, conflicts, errors, and storage pressure. Distinguish executed locally, persisted locally, uploaded, and accepted by server. Local audit completion must not await account upload. |
| G24 | P1 | Outboxes are per stream/lane; reconnect can flush many independently. Idle reads/presence/streams remain separate from writes. | One sync coordinator per local store with a lease, bounded global concurrency, byte/item caps, debounce, jitter, Retry-After, and manual sync. Pull deltas once per sync session; piggyback configuration changes. Disable presence/attention polling by default. |
| G25 | P1 | Local activity includes occurrence time and duration and later participates in billing; historical execution/evidence needs distinct trust semantics. | Preserve `occurredAt` and server `receivedAt`, actor/device/source, policy/audit/model versions, and sequence. Treat imported client evidence as client-reported. Validate elapsed-time claims, duplicates, clock skew, and billing windows server-side. |
| G26 | P1 | Browser local-first stores are not equivalent to durable desktop storage, and multiple windows/tabs can compete for queue ownership. | Host-specific storage adapters with shared contracts, migrations, corruption recovery, ownership leases, privacy partitions, retention/export, and tested restart behavior. Keep secrets in credential storage; redact uploaded logs and artifacts. |
| G27 | P1 | Offline and sync behavior lack one cross-surface acceptance contract. Static review cannot establish actual production request volume. | Add network-denial and request-budget tests plus runtime request accounting. Test packaged assets, signed-in/signed-out entry points, and long-offline recovery across all three surfaces. |

Additional source anchors:

- [Routing and fallback](../../clients/vscode/src/modelRouting.ts), [VSIX settings](../../clients/vscode/package.json), [platform tool relay](../../clients/vscode/src/platformTools.ts), [shared tool assembly](../../clients/vscode/src/brainToolCatalog.ts).
- [Outbox host adapter](../../clients/vscode/src/outboxStorage.ts), [outbox behavior](../../packages/write-outbox/src/outbox.ts), [queue policy](../../packages/write-outbox/src/policy.ts), [sealing and scope rules](../../packages/write-outbox/src/sealedBatch.ts).
- [Audit execution](../../clients/vscode/src/auditExecution.ts), [audit API](../../clients/vscode/src/systemAuditApi.ts), [server audit service](../../api/src/application/tools/AuditRunner.ts), [remediation dedupe](../../api/src/application/tools/auditRemediation.ts).
- [Policy resolution](../../clients/vscode/src/policyGates.ts), [session cache](../../clients/vscode/src/sessionsSnapshotStore.ts), [workspace fact publishing](../../clients/vscode/src/workspaceFactsSync.ts), [Git changes](../../clients/vscode/src/gitChanges.ts).
- [Server message routes and side effects](../../api/src/presentation/routes/brainRoutes.ts), [replay middleware](../../api/src/presentation/middleware/idempotentReplay.ts), [replay policy](../../api/src/application/shared/idempotentReplay.ts), [cache adapter](../../api/src/infrastructure/cache/idempotencyReplayStore.ts).

## Shared offline memory scope (folded 2026-10-25)

Folded from the supplementary review `offline-inference-and-memory-scope.md` (2026-10-18, static
review of `builderforce-inference`, `builderforce-memory` and this repo), which was then removed. Its
inference half (WebLLM-first ranking, GPU limits, model readiness, page-engine worker, distribution)
shipped with PRD 34 and the local-models work recorded in [DONE.md](../../DONE.md). The memory half
below is still open. **These gaps live in the `builderforce-memory` repository** (`packages/memory`,
`packages/memory-mcp`), plus the product bindings that call it; they are tracked in
[ROADMAP.md](../../ROADMAP.md) › OTHER › Evermind / SSM.

**Decision.** `builderforce-inference` owns inference engines; `builderforce-memory` owns local
knowledge, retrieval, cognition and memory-learning primitives. No modality implements its own engine,
fact reconciliation or retrieval. Memory and inference are integrated through narrow ports. A local
memory hit may satisfy an eligible request without loading an LLM. Today the product integration is
more remote-dependent than the package: VSIX `src/cognition.ts` routes recall/remember through
`bfApi`, and `brain-embedded/src/evermindMemory.ts` binds per-turn recall to the server. Those
bindings are replaced by shared local-memory services in every modality, with the server adapter
kept behind sync and explicit connected features.

| ID | Finding (2026-10-18) | Required scope |
|---|---|---|
| M01 | `MemoryStore` owns IndexedDB directly; no production Node database adapter (Node guidance injects `fake-indexeddb`; MCP is durable only with `persistFile`). | Extract narrow storage/transaction ports without breaking the API; durable browser and VSIX Node adapters. An in-memory IDB shim is never durable storage. |
| M02 | IndexedDB write helpers resolve on request success, not transaction commit; fact writes share no transaction with a sync journal. | Resolve a durable save only after commit; commit fact mutation, provenance, tombstone/event and journal atomically through a unit-of-work port. |
| M03 | `MemoryEntry` has no account/tenant/project/repository/chat identity or server version; default database names are global to the origin. | Explicit scope values and partitions enforced by repositories, including personal and never-connected memory; scope preserved in snapshots and cache keys. Tags are not authorization. |
| M04 | No sync receipts, durable operation identity, base versions, conflict exchange or deletion tombstones. | Fact operations join the common sync protocol (G15/G18); evidence and base revision preserved; concurrent evidence conflicts stay explicit, not last-write-wins. |
| M05 | Cognition mutex/version/cache and `_writeSeq` are per instance; they cannot serialise tabs, windows, MCP processes or replicas. | Repository compare-and-set/transactions, durable revisions, locking where needed, cross-context invalidation. |
| M06 | TTL/caps hard-delete facts (MCP default cap 10,000); the mirrored snapshot drops TTL/time/sequence and restores by fresh remember calls. | Separate evictable caches from durable knowledge and unsynced operations; preserve source time/provenance through import; never evict pending knowledge to meet a cap. |
| M07 | SemanticCache L1 is process memory; remote L2 can be hit on every use; dense vectors/index are not persisted across restart. | Persist scoped answer cache/index with knowledge, embedding, model and tokenizer versions; remote L2 off when offline; rebuild derived indexes when a version changes. |
| M08 | Sessions fetch checkpoints/tokenizer URLs; `InferenceRouter` can pick a remote transformer bridge. | Offline asset resolver and explicit network capabilities for every memory path; no remote teacher, remote embeddings or automatic download when disconnected. |
| M09 | Local learning/checkpoint deltas exist, but no account-wide concurrent merge semantics. | Version base checkpoint, architecture, tokenizer, training config and contribution ids; sync experiences and immutable checkpoint manifests; never average weights or apply a delta to an incompatible base. |
| M10 | The memory package carries its own SSM/transformer router and graph facilities beside Brain's agent loop and local inference planner. | One execution owner: adapt memory hooks to the shared inference policy; no competing agent loop or fallback policy. |
| M11 | A recalled answer is not proof a current external action happened; Brain already restricts SSM generation on tool-capable runs. | Keep that guard locally; scope cache validity by knowledge/input/tool semantics; never satisfy a requested mutation with a cached action result. |

**Acceptance (memory).**

5. Each modality: a downloaded compatible WebLLM model is preferred when a usable GPU exists; no GPU,
   no assets, unfit tools or device loss produce the correct local alternative or a clear setup state;
   no API call is attempted; explicit pins obey policy.
6. Offline memory: remember/recall/forget and local model restoration survive restart; lexical recall
   works without a GPU; CPU semantic recall works with installed assets; GPU memory competes safely
   with generation; no network teacher or L2 leak.
7. Injected crashes, transaction aborts and concurrent writes across windows and MCP processes lose
   no acknowledged knowledge, recall nothing across scopes, resurrect no deletes, duplicate no
   learning, apply no incompatible checkpoint and evict no unsynced fact. Product restart and
   network-denial tests supplement the package unit tests.

## API chatter inventory

These are source-defined cadences, not measured production totals. They depend on authentication, focus, running work, configuration, and error state.

| Path | Current behavior | Offline-default / connected-batch target |
|---|---|---|
| Authentication / tenant exchange | Key probe, token exchange, refresh, workspace re-scope | Nothing offline. Authenticate once per enabled sync session; reuse valid tokens and coalesce refreshes. |
| Connection + assigned tasks | Startup calls; recurring 15-minute timer; focus can refresh assignments | Nothing offline. Include assignments in delta sync; connection state only when a connected feature needs it. |
| Attention | 10 seconds active, 60 seconds idle, 5 minutes background, plus focus/write refresh | Local run indicators from store; connected remote attention only when explicitly relevant. |
| Activity | Local 60-second heartbeat capture; batches of 25 or five minutes | Local capture may continue under product policy; upload only at permitted batch sync. |
| Brain turns / steps | Direct turn persistence plus per-chat step batching | All run writes local; background history batches independent of turn completion. |
| Tools / gates / context / model metadata | Per-run context; approximately 60-second tool/policy freshness; assorted model reads | Offline snapshots and local tools; refresh changed manifests during sync. |
| Sessions / trees | Session snapshot revalidates after 30 seconds when read; refreshes coalesce over two seconds | Read local projection; update it from delta sync. |
| Insights / meetings | Streams, reconnection, WebSockets and leave requests | Explicit connected features only. |
| Facts / outcomes / errors | Fact-by-fact publishing; outcome queue; opt-in error queue | Shared scheduling; changed records batched with domain-specific retention. |

Evidence: [activation timers](../../clients/vscode/src/extension.ts), [attention](../../clients/vscode/src/attention.ts), [activity](../../clients/vscode/src/activity.ts), [gateway](../../clients/vscode/src/gateway.ts), [insights](../../clients/vscode/src/insights.ts), [meetings](../../clients/vscode/src/meetings.ts), [errors](../../clients/vscode/src/errorReporter.ts).

## Proposed target contracts

### Mandatory consolidation constraints: DRY, DDD, SOLID, and n-layer

These are acceptance requirements for the implementation, not optional cleanup. Consolidate responsibilities across the three modalities before adding another independent implementation. Share business semantics and application orchestration; retain distinct adapters where VS Code, browser storage, filesystem tools, and service-worker lifecycles differ.

Use explicit bounded contexts:

| Context | Owns | Boundary |
|---|---|---|
| Work management | Projects, tickets, hierarchy, status transitions, links, version/conflict rules | An execution references a ticket; it does not own the ticket aggregate |
| Execution | Run lifecycle, lineage, conversation events, tool activity, checkpoints, execution provenance | Inference and tool execution are ports; recording history cannot execute a command |
| Assurance | Audit definitions/versions, findings, evidence, report completion, remediation identity | Requests ticket creation through a work-management use case; does not manipulate its storage directly |
| Change evidence | Run-linked change sets, repository/base references, patch/blob manifests | Evidence import cannot apply code changes or pretend to push Git commits |
| Identity and governance | Destination bindings, offline policy snapshots, permissions, local authorization decisions | Domain policy consumes explicit identity/policy values, never reads tokens or UI selection |
| Synchronization | Delivery receipts, mappings, dependencies, cursors, reconciliation coordination | Calls owning contexts' import use cases; does not become a second owner of every domain's rules |

Treat these as logical boundaries first, not a mandate for one package, process, or service per row. Map onto existing modules and extract packages only where there is a demonstrated shared responsibility. Persistence/domain events remain versioned contracts owned by their context; do not expose database rows as public contracts or force unrelated aggregates into one generic entity shape.

The dependency rules are:

1. **Presentation:** React components, tree providers, native chat registration, and status UI render projections and submit application commands. They do not fetch platform data, choose sync destinations, implement retry, construct storage adapters, or decide business transitions.
2. **Application:** Focused use cases such as StartLocalRun, ChangeTicketStatus, CompleteLocalAudit, ImportRunHistory, and SynchronizeWorkspace coordinate domain behavior and narrow ports. Share applicable use cases across modalities; keep host-only lifecycle orchestration in its adapter/composition layer.
3. **Domain:** Pure aggregates, value objects, transition rules, audit/remediation identity, conflict rules, and domain events. No VS Code, Chrome, React, fetch, credential storage, SQL, IndexedDB, or filesystem imports. Domain events describe facts; they are distinct from transport envelopes and executable commands.
4. **Infrastructure:** Transactional local repositories, API repositories, credential providers, inference transports, blob stores, platform connectivity guard, and host lifecycle adapters implement ports defined inward. HTTP routes translate/authenticate requests and invoke application services; they do not own reconciliation policy.
5. **Composition roots:** Wire adapters once in VSIX activation, Rovr service-worker/panel startup, Web bootstrap, and API bootstrap. Inject dependencies; remove hidden mutable singletons that decide identity or initiate network work at import time.

Application services depend on consumer-specific interfaces: a ticket repository is not a global platform client, and a history importer is not a general remote command executor. Repository implementations must preserve the same domain semantics. Expose explicit transaction/unit-of-work support for local record plus journal commits rather than relying on call order between independent adapters. Shared sync orchestration must support host ownership leases and scheduling as injected capabilities.

Consolidation map:

- Reuse `brain-embedded` / `packages/agent-loop` for the existing shared execution engine and model protocol. Consolidate panel/native application wiring and remove their network-versus-memory persistence split. Keep UI and host bridge roles narrow.
- Keep `packages/local-inference` and shared model stream responsible for inference mechanics. Define inference permission/fallback policy once and supply it to all callers, including scanners and child runs. An explicit connection policy must supersede a cached route.
- Evolve `packages/write-outbox` as a delivery primitive with a hard permission gate and appropriate durability guarantees. Put domain import, entity mappings, and conflict rules above it, not inside a generic queue. Use a host-neutral sync coordinator for the actual shared protocol.
- Extract reusable record/journal application contracts from Rovr's local-first pattern into the shared layer. Implement VSIX and IndexedDB adapters against those contracts; do not make VSIX import Chrome application code or copy its record store.
- Extract audit definitions, pure finding validation/fingerprints, and report completion rules from server-only orchestration where needed. Keep server authorization, persistence, and remediation dispatch behind ports. Both offline and server workflows consume the same canonical rules.
- Replace scattered host/webview API access with injected transport adapters governed by the same platform policy. Share protocol and request semantics; preserve server authentication/authorization as the authoritative boundary.

Explicitly reject these antipatterns: a global `if (offline)` scattered through features; separate ticket/audit implementations per modality; a universal repository/service with unrelated methods; a sync engine that duplicates domain transitions; a generic MCP/HTTP command replay queue; UI-owned durable records; module-load network side effects; identity taken from current UI state during replay; dual writes without an atomic journal; last-write-wins for every conflict; silent eviction of unsynced user work; cache TTL used as correctness-level deduplication; and requiring the network to confirm a successful local operation.

Add focused architecture checks for prohibited dependency directions and direct platform network calls outside approved adapters. Validate shared repository contracts against both local and server adapters where their behavior overlaps. Test domain invariants and transaction/crash boundaries; do not add tests that merely mirror trivial implementation details. Migrate incrementally behind existing interfaces and remove the superseded path in each completed slice, avoiding permanent parallel implementations.

Dependency direction: presentation → application use cases → domain contracts; infrastructure supplies local storage, inference, and sync transports. Both VSIX chat surfaces use one application service. Web and Rovr consume the same domain/sync contracts with their own storage/lifecycle adapters.

```text
Web UI / Rovr panel / VSIX panel-native-board
                 |
        local application services
                 |
     transactional local domain store
       records + journal + sync receipts
          |                    |
   local Brain/tools     sync coordinator (opt-in)
          |                    |
 allowed inference       batch push + delta pull
                               |
                    existing account domain services
                               |
                  Web and Rovr account projections
```

Store at least projects, tickets and links, chats/messages, executions and lineage, tool events, local approvals, audit definitions/runs/findings, change sets, memory operations, attachment manifests, server mappings, policy snapshots, sync cursors, receipts, and conflicts. A transactional embedded database is a good VSIX candidate; validate extension-host/platform/remote-workspace packaging before choosing a driver. IndexedDB adapters fit browser hosts. Memento remains appropriate for small UI preferences.

An illustrative versioned batch endpoint (`POST /api/sync/v1/push`, proposed, not existing) accepts:

```text
batchId, protocolVersion, deviceId, events[]
event = eventId, clientEntityId, entityType, operation, schemaVersion,
        localSequence, occurredAt, baseVersion?, dependsOn[], payload
```

Tenant/user permissions come from authenticated server context and are checked per entity/project. Client-supplied identifiers never grant access. Stable origin/platform/account bindings remain local and are verified before sending. Large evidence blobs use content-addressed, resumable uploads referenced by manifests; avoid embedding them in JSON history batches.

Return per-event `accepted | duplicate | conflict | rejected | dependency_pending`, resulting server ID/version, and a durable receipt. The client acknowledges only committed items. Persist mappings and receipts before dropping journal entries; a crash after server commit must replay safely. Resolve client references within a batch; park dependent items rather than creating broken links. Distinguish retryable service failures from actionable permanent refusals and retain rejected user data.

A companion delta pull returns changed entities, tombstones, versioned configuration/policy manifests, and an opaque cursor. Bootstrap uses bounded snapshots; expired cursors require a resnapshot merged with pending local mutations. Pull before reconciling edits to existing account records, push local operations, then catch up server-generated results. Keep concurrency checks authoritative on the server because another client may write at any time.

Conflict policy should be domain-specific: immutable messages/events append with dedupe; independent fields may merge under defined rules; competing ticket status/assignment/description edits surface a conflict; deletes use tombstones; audit findings preserve source evidence and shared remediation fingerprints. Never overwrite newer account state by replaying a stale full object. Reuse existing audit remediation identity logic so local tickets and server-created remediations do not duplicate one another.

Suggested connected sync cadence: a configurable coarse interval plus run-completion debounce, byte/item thresholds, reconnect, and Sync now. Coalesce these triggers into one session. At 15-minute cadence an eight-hour connected session has roughly 32 scheduled opportunities, compared with roughly 480 idle attention polls at a one-minute cadence; neither figure includes paging, authentication, work, or errors. Optimize measured requests, rows, and bytes, not just timer counts. Do not generate empty sync traffic when neither backlog nor an explicitly enabled remote refresh requires it.

## Delivery sequence

1. **Define and enforce offline policy.** Add the API-denied default, central platform transport guard, model fallback restrictions, settings/localized status, and a complete endpoint/capability inventory. This slice alone does not establish durable offline work; do not present it as the finished feature.
2. **Build the shared local application layer and host stores.** Stable IDs, transactional journal, migrations, account/repository partitioning, durable history, and adapters for Web, Rovr, and both VSIX chat surfaces. Move board/ticket operations and run persistence behind shared local use cases. Deliver Web offline application-shell startup alongside its storage adapter.
3. **Move audit and change capture into local use cases.** Versioned definitions, local findings/report tools, remediation links, policy snapshots, run interruption recovery, and evidence manifests. Correct close-audit semantics.
4. **Implement server batch import and delta sync.** Schema migrations, unique receipts, entity versions, tombstones, ID mapping, authorization, dependencies, conflicts, historical side-effect isolation, and bounded artifact upload.
5. **Wire account visibility and complete modality parity.** Web, Rovr, and VSIX render imported historical executions/audits/change sets without showing them as live cloud runs. All three use local domain storage, the shared application use cases, and the same sync identities/versions. Rovr adopts atomic journal/protocol ownership and crash recovery; replace live destination lookup. Remove superseded API-first and memory-only paths rather than maintaining modality-specific alternatives.
6. **Remove residual chatter and ship with evidence.** Eliminate redundant pollers/refreshes in default mode; add sync operations UI, export/recovery, data retention, and request budgets. Reuse existing domain and outbox tests while adding failure-injection coverage.

Do not duplicate server business rules inside presentation code. Extract host-neutral audit/task/change/sync contracts and pure rules into shared packages; keep database, filesystem, VS Code, Chrome, HTTP, and credential code behind adapters. Per repository rules, new visible strings require all supported locale catalogs and registry-to-catalog coverage.

## Acceptance gates

- Run the same repository, application-use-case, sync, ownership, conflict, and historical-import contract suites against Web, Rovr, and VSIX adapters. Each modality must pass local create/edit/read/restart/sync scenarios for its supported capabilities; Web is not exempt from durable offline domain editing.
- After Web installation/asset caching, disable network and reopen the application: the real working shell, local records, supported tools, and installed inference assets load without API-dependent bootstrapping. Test browser storage loss/full/unavailable states and multiple-tab ownership. Apply equivalent restart/suspension scenarios to Rovr and VSIX.
- Fresh packaged VSIX with no account starts a supported local-model run, creates/edits tickets, runs a supported audit, records changes, restarts, and retains complete history. Offline mode makes zero attempted BuilderForce requests, including on startup, focus, errors, retries, token expiry, explicit queue flush, shutdown, and reconnect.
- A signed-in VSIX in offline mode has the same zero-request property. A missing model, closed WebGPU panel, failed direct credential, cloud pin, child run, scanner, or model failover cannot trigger gateway use. No-model setup explains the missing prerequisite locally.
- Offline policy also covers embedded project/canvas/Evermind pages, uploads, streams/sockets, diagnostics, auth probes, and configured custom gateways. Direct provider/Git/MCP access follows its separately declared policy.
- Kill the host after local commit, between record and queue work, during upload, after server commit but before acknowledgement, and during local receipt persistence. User work survives; external commands and mutations are not executed twice.
- Accumulate more than 1,000 events and remain disconnected longer than 24 hours. No unsynced domain record is evicted; later retry produces one server entity/effect per event. Storage-full and corruption failures are visible and exportable.
- Start work under A, switch to B, change project, sign out/restart, and enable sync. Records/mappings remain bound to A. Never-connected records require a chosen account/project destination. Test distinct accounts in the same tenant and distinct API installations.
- Web edits a ticket while VSIX edits it offline; sync preserves both changes or reports a resolvable conflict. Cover parent/child tickets, chat links, deletes, archived records, removed membership, policy expiry, and dependency failures.
- Import a completed run/audit: it appears across Web/Rovr/VSIX with original timing/provenance, one set of findings/remediations, and no new agent execution, shell command, cloud audit, stale mention notification, or duplicate learning.
- Parallel windows/tabs/workers cannot lose pending mutations or double-process receipts. Test remote extension hosts, multi-root repositories, browser suspension, cursor expiry, resnapshot, client/schema version skew, oversized evidence, and resumable uploads.
- Measure an authenticated idle editor, active local run, long-offline catch-up, and connected mixed-surface work. Report attempted requests by category, bytes, retries, and server writes; enforce agreed budgets. Do not infer these metrics from source comments.

## Review limits and implementation readiness

This review identifies the cross-cutting gaps in the inspected execution, storage, tooling, audit, and transport paths. It is not a claim that every feature in the repository is offline-capable or that every network call has been dynamically exercised. A complete transport inventory and packaged network-denial tests are delivery gates.

The working tree contains active unrelated edits, including changes made during this review. Revalidate the audit/provider integration against the implementation baseline before development; transient file/export mismatches observed during inspection had resolved by the final source check. No product code was changed or tests run for this architecture-only deliverable.

## Implementation status against the working tree

The last sentence of the section above is the original review limit. It is no longer true of the working tree. This section records what that tree actually contains as of the follow-up on 2026-10-18, and it supersedes only that sentence. Earlier sections are unchanged: a capability described there as missing is still missing unless this section says a live path now calls it.

Status words used below:

- **Composed** — a live path calls it (activation, a host port, or a queue the host already drains).
- **Library** — the module and its tests exist; no composition root imports it.
- **Contract** — types, schema, ports, or a migration exist; there is no repository, route, or importer.
- **Not started** — no implementation was found. A name in a comment is not an implementation.

Comments in `api/migrations/1247_sync_batch_protocol.sql` and `api/src/infrastructure/database/schema/sync.ts` name a swept-table registration and import use cases (`importSyncedTicket`, `importSyncedProject`, `importMirrorRecord`). Those files are not in the tree. Treat the comments as intent.

Files outside the paths named here are not evidence that a gap is closed.

### G01–G27

> **Stale table (note added 2026-10-25).** This table predates commit `ed26ab8a8` (2026-10-20), which
> wired run recovery (G22), run change sets (G19), `configurePolicyGatesPersistence` (G09), local
> audits (G07/G08), `createSyncCoordinator` (G24/G15), local domain tools (G06) and the capability
> matrix (G21), and the server sync routes. Read the rows below as the 2026-10-18 baseline, not the
> current state. The gaps still open are **G03** (SQLite system of record built, not wired —
> ROADMAP › OTHER › Agent runtime "G03 SQLite system of record"), **G05/G23** (local project/ticket/chat
> views and the sync-status presenter — ROADMAP › OTHER › Workload-aware routing "VSIX sync status is
> not shown"), **G04 for chats across devices** (ROADMAP › Make › Cloud and IDE agent runs "A VS Code
> chat's history does not follow the person") and **G27** (packaged network-denied acceptance suite —
> ROADMAP › OTHER › Agent runtime).

| Gap | Status | Evidence in the working tree | Still required |
| --- | --- | --- | --- |
| G01 API-denied default | Partial, VSIX only | `packages/local-first/src/policy.ts` (`LOCAL_FIRST_POLICY`, every capability false). VSIX settings `builderforce.platform.*` default false in `clients/vscode/package.json`, with nls strings, read by `clients/vscode/src/platformPolicy.ts`. | Web `bootWebPlatformPolicy` is not called. Rovr `createRovrPlatformPolicy` is imported only by its test. No settings UI beyond the VSIX contribution. |
| G02 single enforcement point | Partial, host `fetch` only | `bindPlatformPolicy` replaces `globalThis.fetch` for configured BuilderForce origins, classifies the capability, and sets `redirect: "error"`. `modelRouting.ts` checks `gateway-inference` before opening a cloud stream. `outboxStorage.ts` passes `outboxSendPermission`. | The webview is another JavaScript realm; its `fetch` is not the host's. WebSockets, `vscode` request APIs, and child-process network are not classified. Web and Rovr policy modules are not composed, so their fetches are not gated. |
| G03 local system of record | Partial, chat messages on the host run | `localBrainApplication` (`clients/vscode/src/localFirstStore.ts`) is passed into `brainRunHostPorts` `persistence.sendMessages`, the chat participant, the webview host bridge, and step durability in `extension.ts`. | The store is one JSON snapshot (`globalStorage/local-first-v1.json`), not a transactional embedded database. Run context, tool catalogs, and platform writes still call `bfApi` / `gateway`. Signed-out work is not the record for projects, tickets, audits, or runs. |
| G04 stable client identity | Contract | Client UUIDs and `EntityMapping` live in `packages/local-first`. `sync_entity_mappings` is in migration 1247. | No live run, step, or approval contract was changed to keep one client id across restart and sync. `localDeviceId` is written with an un-awaited `globalState.update`, so a crash can mint a second device id. |
| G05 local projects and tickets | Library, Web only | `frontend/src/lib/localFirst/workManagement.ts` (`createLocalWorkManagement`). | Nothing in the web app imports it. VSIX has no local project or ticket repository, tree, or board. |
| G06 local domain tools | Not started | — | Platform tool calls still target the API. No local adapter, queue, or sync handoff. |
| G07 local audit definitions and runs | Library | `clients/vscode/src/auditDefinitions.ts`, `localAuditStore.ts` (`startLocalAuditRun`, findings, remediation, `recoverInterruptedAuditRuns`). | `auditExecution.ts` does not call them. Definitions are not loaded from the local store. |
| G08 close means local complete | Not corrected | Recovery helper only, and it is not called. | Close-audit behaviour was not changed. A completed local audit still has no durable "closed locally" state on the live path, and no rule stops it launching a cloud audit. |
| G09 policy snapshot, including signed out | Library, hook unwired | `policySnapshots.ts` and a fallback in `policyGates.ts` (`snapshotPermitsOfflineRun`). | `configurePolicyGatesPersistence` is never called from `extension.ts`, so the resolver still runs memory-only. Sign-out still drops the in-memory cache. |
| G10 destination binding | Contract | `EntityDestination` / `UNBOUND_DESTINATION` in `packages/local-first/src/records.ts`. `destinationBindingError` in `api/src/domain/sync/syncProtocol.ts`. | Not enforced at project, ticket, chat, audit, or run creation. Unbound records can still be written by any caller that does not use the coordinator. |
| G11 binding is a snapshot | Contract | `destinationKey` is pure and snapshotted on the record. The coordinator refuses an unbound batch. | `taskProjectId()` and the other live parent lookups were not replaced. No rebind operation exists. |
| G12 outbox permission revoked | Partial, VSIX queues | `packages/write-outbox` `sendPermission` aborts automatic, manual, final, probe, and `drainWith` sends. VSIX `outboxStorage.ts` wires `outboxSendPermission`. | Only queues built through that helper are gated. A direct `fetch` that is not a platform-origin request, or a socket, is unaffected. |
| G13 durable vs best-effort | Partial | Outbox types distinguish durable retention, dead letters, and best-effort drop. | Not every user-work queue was reclassified. Dead-letter export and repair are not a user-visible action. |
| G14 mutation and outbox commit together | Partial | `enqueueDurable` exists. The VSIX snapshot store commits a record and its journal event in one rename. | The outbox file and the local-first snapshot are different stores. A domain write and its sync enqueue are not one commit. |
| G15 batch sync protocol | Contract | Client `SyncPushBatch` / `SyncPullResult` / `SyncTransport` in `packages/local-first/src/sync.ts`. Server tables in migration 1247, Drizzle `schema/sync.ts`, domain rules in `domain/sync/syncProtocol.ts`, ports in `application/sync/syncPorts.ts`. | No `SyncRepository`, no service, no `POST /api/sync/v1/push` or pull route, no client transport implementation. `createSyncCoordinator` is called only from `localFirst.test.ts`. |
| G16 idempotency and ordering | Schema only | Unique `(tenant_id, device_id, event_id)` and `(tenant_id, entity_type, client_entity_id)`. `depends_on` column. Coordinator rejects a short receipt list. | No transaction applies a mutation and writes its receipt together. `dependency_pending` is specified and not stored, which is correct, but nothing parks or resumes it on the server. Retention is not registered, so the "permanent uniqueness" rule has no retention story either. |
| G17 bounded import use cases | Port only | `SyncEntityImporter` and `SyncImportContext` in `syncPorts.ts`. | No importer. A future route must not grow a generic entity writer. |
| G18 cursor, tombstone, resnapshot | Client library + server codec | Coordinator conflict list and `resnapshotRequired`. `encodeSyncCursor` / `decodeSyncCursor` reject a future `v` or a non-finite `seq`. | No pull query, no server tombstone read, no client path that consumes a server cursor. |
| G19 run change sets | Library | `clients/vscode/src/runChangeSets.ts`. | Not imported by the run host. A run still does not record a content-hashed baseline and finalization. |
| G20 memory provenance | Not started | `memory-fact` exists only on the `LocalEntityType` union. | No local fact store, no provenance record, no separation from chat sync. |
| G21 capability matrix | Not started | `attachment-manifest` exists only on the union. | Meetings, attachments, and cloud-only tools have no offline behaviour table in code. |
| G22 interrupted runs | Library | `clients/vscode/src/runRecovery.ts` (`recordRunStarted`, `recoverInterruptedRuns`, `safeToResume`). | Not called from activation or the run host. A restarted host still has no interrupted-run record. |
| G23 sync status | Not started | `platformRequestAccount` counts blocked host fetches. Nothing reads it. | No local / syncing / synced / conflict / dead-letter state on chat, ticket, audit, or run. |
| G24 one coordinator, one lease | Library | `createSyncCoordinator` plus an IndexedDB lease and a VSIX file lock (`local-first-v1.lock`). | No host constructs the coordinator. Two entry points can still sync, because nothing syncs. |
| G25 client and server time | Domain rule + columns | `occurred_at` / `received_at` on `sync_events`. `occurredAtError` rejects an invalid or future client time (15 minutes). | No route calls it. Historical past timestamps are intentionally allowed and untested on a server. |
| G26 per-device durability | Partial adapters | IndexedDB adapter and lease (`packages/local-first/src/indexedDb.ts`). VSIX snapshot uses temp file + rename and a lock file. | Not equivalent stores. The VSIX lock is stolen after 30 seconds, so a long transaction can race. Corrupt snapshot throws with no recovery copy. Secrets and redaction are not specified in the store. Web multi-tab is tested only against the IndexedDB adapter. |
| G27 packaged acceptance gate | Not met | Unit tests: `packages/local-first/src/localFirst.test.ts`, `indexedDb.test.ts`, `clients/chrome/src/platform/policy.test.ts`, `brain-embedded/src/localFirstPersistence.test.ts`. | No test disables the network and drives Web, Rovr, and a packaged VSIX through the same scenario. No test proves a blocked platform call, a durable local write, and a later batch replay. |

### What the working tree actually added

Shared contract, `packages/local-first`:

- Policy: eight capabilities, all denied, `authenticate` implied by synchronize, connected features, or gateway inference.
- Records: fifteen entity types, unbound vs bound destination, journal event, receipt, mapping.
- In-memory transactional store, used as the inner store of the VSIX snapshot.
- Sync coordinator: lease, policy assert, dead-letter skip, one receipt per event id.
- IndexedDB adapter. Not used by VSIX or by the web app.

VSIX, composed:

- Settings and nls for `builderforce.platform.*`.
- Host `fetch` patch and model-route gate.
- Outbox send permission on queues built by `outboxStorage.ts`.
- Local brain persistence for host-run `sendMessages`, the participant, the webview bridge, and step durability.

VSIX, present and not called from `extension.ts` or the run host:

- `localAuditStore.ts`, `auditDefinitions.ts`, `policySnapshots.ts` (the configure call is missing), `runChangeSets.ts`, `runRecovery.ts`.

Web and Rovr, present and not composed:

- `frontend/src/lib/localFirst/{platformPolicy,store,workManagement}.ts`. `bootWebPlatformPolicy` has no caller.
- `clients/chrome/src/platform/policy.ts`. The service worker does not import it.

Server, contract only:

- Migration `1247_sync_batch_protocol.sql`: `sync_events`, `sync_entity_mappings`, `sync_records`, `sync_changes`.
- Drizzle schema re-exported from `api/src/infrastructure/database/schema.ts`.
- Domain helpers and the `SyncStores` port. No repository, service, route, importer, or retention registration. `sweptTables.ts` does not name either log table.

Write outbox:

- `sendPermission`, dead letters, `enqueueDurable`, durable retention vs best-effort drop. Wired into VSIX outboxes that use `outboxStorage.ts`.

### Remaining build, in dependency order

Do not start later items by calling the unwired libraries and calling the gap closed.

1. **Compose the policy on every surface.** Call `bootWebPlatformPolicy` from the web boot path. Construct `createRovrPlatformPolicy` in the Rovr service worker and panel, and gate that extension's platform `fetch` the same way VSIX gates the host. Add the missing settings UI copy only where a surface has no native settings contribution.
2. **Replace the VSIX JSON snapshot before more entity types land.** One SQLite (or equivalent) file in global storage, with a real transaction around record + journal event, a busy timeout instead of a 30-second lock steal, and a corrupt-file recovery path. Await device-id persistence before the first write that stamps it.
3. **Wire the libraries that already match a gap, still on the local store only.** `configurePolicyGatesPersistence` from activation (G09). `recordRunStarted` / `recoverInterruptedRuns` from the run host and activation (G22). Change-set baseline and finalization around the same run (G19). Local audit start/save/close/recover from `auditExecution.ts` (G07, G08), including an explicit refusal to launch a cloud audit on local close.
4. **Local projects, tickets, and tools (G05, G06).** A VSIX repository beside the web `workManagement` library, then tool adapters that write that repository instead of `bfApi` when the platform is denied.
5. **Server write path (G15–G18, G25).** One repository implementing `SyncStores.transact`. Push validates protocol version, destination binding, schema version, and `occurredAt` before any insert. One transaction per event: importer outcome, mapping, projection, change row, receipt. Pull reads `sync_changes` / `sync_records` through the cursor codec. Importers are `importSyncedTicket`, `importSyncedProject`, and a mirror importer for history-only types — nothing else. Register `sync_events` (90 days) and `sync_changes` (30 days) in `sweptTables.ts`, and state that event-id uniqueness does not survive retention: a replay after purge is a new event, not a silent duplicate.
6. **One coordinator per device store (G24), then status (G23).** Hosts call `createSyncCoordinator` only after synchronize is granted. Status is derived from the store (pending, in flight, conflict, dead letter), not from a second cache.
7. **Acceptance suite (G27) before any claim that offline-first shipped.**

### Acceptance test plan

Existing tests cover the library, not the gate in the Acceptance gates section above. The rows below are the checks that section requires, mapped onto what the tree can already run.

| Check | Existing test | Missing test |
| --- | --- | --- |
| Fresh install, network off, no platform call, local project/ticket/chat/audit/run survive restart | Policy unit test asserts the default is denied. Persistence test covers chat messages in the embedded adapter. | Packaged VSIX and Rovr service worker with network disabled. Restart across the real store, not the memory store. |
| No sign-in prompt and no token refresh while every `platform.*` setting is false | VSIX settings default false. No behavioural test. | Activation test that fails if `fetch` to a BuilderForce origin, or a token refresh, is attempted. |
| Grant sync only: one batch, no inference, download, or MCP | Coordinator test rejects sync when the policy denies it. | A transport test where synchronize is the only grant, asserting the other capabilities stay denied and are not called. |
| Revoke permission during a flush: no retry, durable rows remain | Outbox contract says `sendPermission` aborts. | A VSIX test that flips `builderforce.platform.synchronize` mid-flush and asserts the outbox row and the local record both remain. |
| Restart mid-run: interrupted, no replay of an unrecorded shell command | `runRecovery.ts` documents `safeToResume`. | Activation test that a running execution becomes `interrupted`, and a step without `safeToResume` is not re-executed. |
| Same event twice, dependency not yet accepted, stale version, unknown schema | Unique indexes in SQL. Coordinator rejects a short receipt list. Cursor codec rejects a bad cursor. | Repository tests: duplicate event id returns one receipt and does not double-apply; unmet `depends_on` returns `dependency_pending` and writes nothing; stale `base_version` returns `conflict`; `schema_version > 1` returns `rejected`. |
| Denied platform call is visible and blocks completion | `platformRequestAccount` exists and is unread. | UI or log assertion, plus a completion rule that a denied sync is not "done". |
| Web, Rovr, packaged VSIX, same scenario | None. | One scenario, three hosts, network denied, then one granted replay. |

### Risks and open questions

- **The host `fetch` patch is not the enforcement point the acceptance gates assume.** Webview `fetch`, sockets, and non-HTTP platform clients bypass it. Until those are classified or removed, "API denied" is true only for host `fetch` to a configured origin.
- **Two stores, one user action.** Chat text can commit in the snapshot while its sync row commits in another file. Crash between them is a lost sync, which the acceptance text treats as data loss.
- **Lock steal.** `local-first-v1.lock` is removed after 30 seconds. A transaction slower than that can have two writers. The rename makes the last writer win and drop the other's commit.
- **Device id race.** `void ctx.globalState.update(deviceKey, deviceId)` can lose the id. The next activation mints another, and server idempotency is per device id, so the same client event can be accepted twice under two device ids.
- **Retention vs idempotency.** Unique event ids do not survive a purge of `sync_events`. The retention registration must say that, or a purged event is replayed as new work.
- **Import isolation is a comment.** Shipping a generic `payload jsonb` writer because the tables already exist would violate G17. The route has to call a named importer or reject the entity type.
- **FNV-1a payload hash.** `hashSyncPayload` is a non-cryptographic identity check shared with the client. It detects accidental replay differences, not a hostile payload swap. Do not treat it as an integrity proof.
- **Web connected grants.** `WEB_CONNECTED_GRANTS` exists beside the denied default. If boot applies it before the person opts in, G01 is false on the web even after `bootWebPlatformPolicy` is called. Boot must start from `LOCAL_FIRST_POLICY`.
- **Unrelated dirty files.** Changes outside the paths in this section (packaged `brain-embedded` dist, inference routing, and any other dirty path) are not part of this design and must not be read as closing a gap.

Open questions, still blocking a server route:

- ~~Who may bind a destination the first time — any signed-in member, or an admin?~~ **Decided 2026-10-19:** any tenant member with write access to the project (tenant role `developer` or above) may bind it on first push; reading (pull) needs any membership. The tenant is always taken from auth, and a `projectId` must be the tenant's project before the destination key is built. One named policy, `mayBindSyncDestination` in `api/src/application/sync/syncDestination.ts`, so it can be tightened to admins in one place.
- After retention, is a replayed event id a conflict the client must drop, or a new accept? The client coordinator cannot tell those apart today.
- Is the VSIX snapshot an acceptable interim for chat text only, with an explicit ban on storing tickets, audits, and runs in it? This section assumes yes until a transactional store exists. If that assumption is rejected, G03 is not partial; it is not started.
