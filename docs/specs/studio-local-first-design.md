# Studio local-first: end-state design

Status: design only. No source changed. Scope: web Studio canvas boards (`/studio/<id>` and the guest/start flow) move onto the shared local-first store with sync, so Studio works offline and through a backend database outage.

## 0. Review corrections (verified against the tree)

| Claim in the brief | Finding |
|---|---|
| `handleSyncPush` entity types | It accepts only what `OWNED_BY` in `api/src/application/sync/importers/index.ts` names (`project`, `ticket`, `chat`, `message`, `usage`, `chat-ticket-link`, `run-outcome`) plus the history-only mirror list (`MIRROR_ENTITY_TYPES`: execution, step, approval, audit-*, change-set, memory-fact, attachment-manifest, policy-snapshot, remediation, run-delta). Anything else is `entity_type_rejected`. **Creation sessions, board objects and timeline events are not accepted today.** `LocalEntityType` is declared twice: `packages/local-first/src/records.ts` and `api/src/domain/sync/syncProtocol.ts` (`DOMAIN_IMPORTED_ENTITY_TYPES`). |
| "Same engine the extension uses for chats" | True for the package. **No web code drives it.** `frontend/src` has no consumer of `createSyncCoordinator` / `createHttpSyncTransport` / `syncRound`. Web work management (`lib/localFirst/workManagement.ts`) journals events and never pushes them. Studio sync therefore needs a web sync driver (new, generic, shared with work management). |
| Pull | `/api/sync/v1/pull` serves the `sync_records` / `sync_changes` projection, which only the push path writes. A board created or edited server-side (Brain, agents, a collaborator's `PUT /:id/graph`, `/api/v1`) is **not in the projection**. Pull cannot be the board replica source until a projector exists (see 2). |
| Server board model | Whole-graph, revisioned: `creationGraphWriter.ts` (clear edges, clear objects, reinsert, bump `canvas_revision`, event with idempotency key, snapshot). Tables in `api/src/infrastructure/database/schema/canvas.ts`: `creation_sessions` (root, uuid pk, `canvas_revision`), `creation_session_objects`, `creation_session_connections`, `creation_session_timeline`, `creation_session_events`, `creation_session_snapshots`, `creation_session_claims` (client id to server id). The canvas root table is `creation_sessions` per `api/scripts/check-domain-root-table.mjs`. |
| Media | `lib/canvasMediaStore.ts` (not under `domains/canvas/infrastructure/`) `storeCanvasMedia` uploads via `BRAIN_UPLOAD_PATH`, falls back to a data URL. Confirmed. |

## 1. Entity model

Record types added to `LocalEntityType` (both declarations) and to `DOMAIN_IMPORTED_ENTITY_TYPES`. All `schemaVersion: 1`, `MAX_SUPPORTED_SCHEMA_VERSION` unchanged.

| Entity type | One record is | Payload | Id |
|---|---|---|---|
| `canvas-board` | the session row | `{ title, folder?, mode, initialPrompt?, viewport?, branchParentId? }` (the `LocalCreationSnapshot` header; viewport here is the device's own, never merged) | client UUID v4 minted at creation, never re-keyed |
| `canvas-object` | one `CanvasObject` (node) | the existing persisted node from `persistedGraphFromBoard` (`kind`, `canvasData`, `content`) + `boardId` | the node's existing client UUID (`node.id`) |
| `canvas-edge` | one connection | `{ boardId, source, target, kind, data }` | the edge's existing id |
| `canvas-timeline` | one transcript message | the `timeline[]` entry (`clientMessageId`, role, body, metadata, createdAt); append-only, immutable | `stableEntityId('canvas-timeline:<boardId>:<clientMessageId>')` |
| `canvas-media` | one blob's manifest | `{ boardId, objectId, mimeType, bytes, sha256, name, status: 'local' \| 'uploading' \| 'uploaded' \| 'failed', storageKey? }`. **Bytes are not in the record** (section 5). | client UUID (`CanvasVideoSource.id` today) |

Why per-object records and not one board blob: a single `canvas-board` record holding the whole graph makes every edit a full-board journal event (megabytes, 5 MB-class payloads), and two devices editing different cards would always conflict. Per-object records give object-level merge, small events, and let `journalCompaction.ts` collapse superseded updates per entity.

Ids and binding. The client UUID is the stable key in the store for the life of the record (the `workManagement.ts` rule). The server row id is held in the mapping table (`sync_entity_mappings`, `normalizeServerMapping`); the route accepts either id through `entityIdResolver.ts`, and after the first accepted board receipt the URL is replaced with the server id (what `claimLocalDraft` does with `router.replace` today). Object, edge and timeline ids are already client UUIDs and are used as the server row ids (`creation_session_objects.id` is `uuid`; timeline has `clientMessageId`).

Partition and destination.
- Signed-out / guest: `UNBOUND_DESTINATION` partition. `creationBinding.ts` allows exactly this for a signed-out caller, and refuses a forged tenant. `canvas-board` is added to `CREATION_ENTITY_TYPES`; children (`canvas-object`, `canvas-edge`, `canvas-timeline`, `canvas-media`) snapshot their destination from the parent board (`destinationSnapshot.ts`, G11), as tickets do from projects. Unbound records never sync (no tenant).
- Signed-in: the board is created in `{ tenantId }` (account destination from `creationBinding.ts` with `accountKnown: true`). Studio has no project owner; `projectId` stays unset (a project is optional context per the `creation_sessions` docstring, linked through `creation_session_project_links`, which is out of scope for sync v1).
- Cross-tab: the existing IndexedDB lease and `tabCoordinator.ts` apply; one sync leader per destination.

## 2. Read path

Open order, in one module (`boardOpen.ts`): (1) read the board from the store by id (client or server id); render immediately; (2) if the board is bound and online, run the reconcile; (3) never block render on the network, never show "load failed" when a replica exists.

How a server board gets a replica. **Decision: seed by REST, keep fresh by the channels that exist, not by `/pull`.**
- First open of a server board with no local replica: `creationSessionsApi.get` + `timeline.list` (the calls `useCanvasSession.ts` L104-148 makes today) are mapped once into records (`boardReplica.ts`: `seedFromServer(detail, transcript)`), stored with `serverRevision = canvasRevision`, via `ingestServerRecords.ts` (write without journal events; these are server truth, not local edits).
- Subsequent opens: render the replica; the same GET runs in the background; if `canvasRevision` is greater than `serverRevision` and there are no pending journal events for the board, replace; if there are pending events, rebase (section 3 merge) then replace.
- While open: the realtime room and the polled tail (`useCanvasSessionSync.ts`, `useSharedCanvasRoom.ts`) keep delivering peer edits; their output is written into the store (not only React state) through the same `ingestServerRecords` seam, so the replica is always the thing the UI renders.
- Why not `/pull` now: it would return nothing for any board not created through push (every existing board, every Brain/agent edit). Serving boards from pull requires a projector writing `sync_records`/`sync_changes` from `creationGraphWriter.ts` plus a backfill; that is a larger server change with its own risk. It is deferred to an engineering follow-up recorded in the roadmap, not a decision for the operator. The reconcile is behind one port (`BoardReconcileSource`) so swapping REST for pull later changes one module.

Offline/outage open: the replica opens; the GET fails; the status line shows "Offline, changes are saved on this device" and the sync indicator (existing `syncStatus.ts` / `syncSummary.ts`) shows the held count. A server board never opened on this device cannot open offline; this is stated in the UI (the library lists replicated boards only when offline).

`/studio/project/<id>` (`StudioProject.tsx`, `useBuildProject`): **out of scope for this program.** Reason: a build project is not a canvas board; it is project-owned execution state (files, runs, deploys) whose truth is server-side and whose offline story is a different entity set (`project`/`execution` types and the webcontainers runtime). Putting it in would couple this migration to the app-builder state model. In scope instead: the Studio library, the start flow, and every `CanvasBoard` surface (`/studio/<id>`, lens routes). The only project-adjacent piece in scope is that opening a project's linked board uses the board replica.

## 3. Write path

Every edit is one `commitWithEnqueue` transaction (`packages/local-first/src/commitWithEnqueue.ts` / `atomicWrite.ts`): the record put (compare-and-set on `version`) and its journal event commit together or not at all.

- Autosave granularity: the existing 300 ms debounce stays, but it now computes `boardSignature` per object and commits only the changed/added/removed objects and edges in ONE transaction (`boardCommit.ts: commitBoardDiff(prev, next)`). Deletes are tombstones with their own events (`tombstone.ts`), never row removal. Viewport-only changes write the `canvas-board` header locally and are **not journaled** (device-personal; the server already keeps `personalViewport` through the presence/commands path).
- Event ids: `<entityType>:<id>:v<version>` (the `workManagement.ts` convention), which is the server's receipt key, so retries are idempotent.
- Dependencies: every child event `dependsOn` the board's create event until it is accepted (`dependencyGraph.ts`, `wireDependencies`); the server holds children as `dependency_pending` and applies them after the board exists (already the protocol behaviour for tickets under projects). Media: an object event referencing a `canvas-media` waits on the upload (section 5).
- Push: `createSyncCoordinator` + `createHttpSyncTransport` against `/api/sync/v1/push`, driven by a new generic web driver (`lib/localFirst/webSyncDriver.ts`): triggers on commit (debounced), on `online`, on tab focus, and on a timer with backoff. It uses `coordinatorLease`/`syncLease` so exactly one tab pushes. The driver is shared: work management starts using it too (it currently never pushes), so there is ONE driver, not a canvas one.
- Failure handling: network error or 503 means the event stays pending (`crashSafeQueue.ts`), the transport's `HttpSyncTransportError` + `Retry-After` (`parseRetryAfter`, capped by `MAX_RETRY_AFTER_MS`) set the next attempt; `holdLimits.ts` dead-letters only an event that has been pending past server retention; `requeueJournalDeadLetter.ts` is the manual path. A 503 never surfaces as a failed save; it is a held count.
- Conflict policy (the existing server rule, `api/src/domain/sync/conflictPolicy.ts`: `require_user`, tombstone wins, no timestamp tie-break, `updatedAt` is never a tie-break). Applied per object:
  - Two devices/tabs editing different objects: both apply (the reason for per-object records).
  - Same object concurrently: the server answers `conflict` for the second writer (its `baseVersion` is behind); the client keeps both payloads in a `SyncConflict` record, keeps the local value rendered, and shows ONE notice with a SlideOutPanel to choose "keep mine" or "keep theirs" (no modal; not a destructive approval). Until resolved the loser's value is retrievable, never dropped.
  - Edit vs delete: delete wins (policy rule 1), with the edit preserved in the conflict record and an "restore" action.
  - Timeline: append-only, keyed by `clientMessageId`; no conflicts possible.
  - Two tabs of one browser: the IndexedDB lease serialises transactions (`indexedDbLease.ts`); the second tab reads the first's commit through `tabCoordinator.ts` change notifications and re-renders from the store, so there are no divergent in-memory graphs.
  - The existing `mergeCollaboratorBoards` / `AdoptRemoteBoard.ts` (local-last merge) is reused as the rebase function when a revision-ahead server board arrives while local events are pending; it is not re-implemented.

Studio stops calling `PUT /:id/graph` (`persistBoard`). One write path from Studio: the journal. `PUT /:id/graph` and `/commands` stay for agents, the public `/api/v1` and other clients.

## 4. Server side

Yes: `handleSyncPush` needs canvas entity handlers. It rejects unknown types today.

New and changed files:
- `packages/local-first/src/records.ts`: add the five types (+ `creationBinding.ts` `CREATION_ENTITY_TYPES` gets `canvas-board`). `publicExports.test.ts` snapshot updated.
- `api/src/domain/sync/syncProtocol.ts`: mirror the union and `DOMAIN_IMPORTED_ENTITY_TYPES`.
- `api/src/application/sync/importers/index.ts`: `OWNED_BY` rows `canvas-board`, `canvas-object`, `canvas-edge`, `canvas-timeline`, `canvas-media`, and the `SyncImporterName` union; `importers/namedSyncImporters.ts`: bind them to `tx`.
- New, owned by the canvas context (not by sync): `api/src/application/creation/sync/importSyncedCanvasBoard.ts`, `importSyncedCanvasObject.ts` (objects and edges), `importSyncedCanvasTimeline.ts`, `importSyncedCanvasMedia.ts`. Each is one named importer with one job, the pattern of `importSyncedProject.ts`. Domain writes go through the canvas context's writers, not raw SQL in the sync folder.
- `api/src/application/creation/creationGraphWriter.ts`: extract (not copy) an `objectUpsertStatements` / `objectDeleteStatements` builder from the existing sequence so the whole-graph path and the per-object path share the revision/event/idempotency logic. Per-object applies: upsert the row, bump `canvas_revision`, append a `creation_session_events` row keyed by the sync event id (its `uq_creation_events_idempotency` is the serialiser). The expensive snapshot (`creation_session_snapshots`) is written once per chunk via the `afterCommit` hook the importers already receive, not per event. Collaborators see the revision bump through the existing room/poll, unchanged.
- Authorization: importers call the existing `sessionAccess.ts` / `sessionRoles.ts` (viewer cannot write; plan limits through the same checks `/claim` uses, `canvasCollaboratorCapacity.ts`). A rejected event returns `rejected` with a code; the client dead-letters it visibly.
- Root-table guard: no new root table. The canvas root remains `creation_sessions` in `schema/canvas.ts`; the guard `api/scripts/check-domain-root-table.mjs` is unaffected. The `.claude/hooks/schema-domain-guard.mjs` hook will not fire.
- Migration: **none required for slices 1-3.** Mappings live in `sync_entity_mappings`; object/edge/timeline/board rows already exist. If a tombstone column is needed for the pull-projector follow-up, that is expand/contract across two pushes (add nullable `deleted_at` in push 1, no contract needed). Not in this program.
- Claim reconciliation: `POST /claim` (`creationSessionRoutes.ts` L910) and `creation_session_claims` stay for legacy clients; the Studio no longer calls it after slice 3 (section 7).

## 5. Media

- Bytes live in a dedicated IndexedDB database `builderforce-canvas-blobs` (object store `blob`, key = media id, value = `Blob` + sha256), separate from the journal DB so large values never ride journal snapshots or `local_first_snapshot_corrupt` handling. OPFS is used where `navigator.storage.getDirectory` exists (large video); the module hides that behind one `BlobStore` interface (`put/get/delete/usage`). The manifest (`canvas-media`) is the synced record.
- Add flow (`storeCanvasMedia` changes to): write the blob to `BlobStore`, commit a `canvas-media{status:'local'}` record and the object referencing it by `media:<id>` URL (resolved to an object URL at render), in one transaction. No data URL is ever written into a board again.
- Upload queue (`mediaUploadQueue.ts`): drains `status in ('local','failed')` when online and signed in with a tenant, through the existing `uploadCanvasFile` (`BRAIN_UPLOAD_PATH`, private visibility). On success one transaction sets `status:'uploaded'`, `storageKey`, and rewrites the object's `url`/`storageKey` (a normal journaled edit, so peers get it). The object's sync event `dependsOn` the media's uploaded event, so the server never holds an object pointing at a blob it cannot serve.
- Guests: media stays local, status `local`, until the claim rebind; the queue starts for the account partition.
- Caps: 25 MB per file for images/audio, 200 MB per video (the upload endpoint's actual limit is to be read and matched; do not exceed it), 500 MB total per device partition, checked against `navigator.storage.estimate()`; over a cap the add is refused with a visible message (`quota-exceeded` state, same vocabulary as `WebLocalFirstStorageState`), never a silent inline. Failed uploads retry with backoff and surface a count; after 5 attempts the item is `failed` with a manual retry.
- Blob eviction: delete the local blob only after `uploaded` AND the object's url has been synced AND a configurable grace (7 days) has passed; keep thumbnails.

## 6. Migration of existing `builderforce:create:*` boards

`legacyBoardImport.ts` (one-time, idempotent), run at store boot before the first board open:
1. Read the legacy index and every `builderforce:create:local-*` key using the parser extracted from `localCanvasStore.ts` (`parseLocalCreationSnapshot`).
2. For each board, one transaction: put `canvas-board`, objects, edges, timeline records into the `UNBOUND` partition with deterministic ids (`stableEntityId('canvas-legacy:<localId>:<nodeId>')` for anything lacking an id; board id = the existing `local-<uuid>` suffix), plus journal events only when the user is already signed in (else they stay unbound, unjournaled). Data-URL media inside nodes is converted to `BlobStore` blobs + `canvas-media` manifests (this also frees localStorage).
3. Idempotency: a marker record `canvas-legacy-import:<localId>` in the same transaction; re-running skips imported boards. Only after the transaction commits is the legacy key removed (never before). Failures are reported through `reportCaughtError`, never skipped silently, and leave the legacy key in place.
4. Boards already claimed (legacy `creation_session_claims` replay) are skipped by checking the mapping.
5. `localCanvasStore.ts` is deleted at the end of slice 3. Its roles are extracted, then the file is removed:
   - pure shaping/parsing/merge (`parseLocalCreationSnapshot`, `localCreationSnapshot`, `createLocalCreationBoard`, `createLocalCreationSession`, `mergeLocalCreationSessions`, `isLocalCreationSession`, `LOCAL_CREATION_PREFIX`): moved unchanged to `domains/canvas/domain/boardSnapshot.ts`;
   - the localStorage reader: kept only inside `legacyBoardImport.ts`, deleted after one release train (version-gated, then removed under the same rule as a migration contract);
   - storage verbs (`write/read/list/remove/update`): replaced by `boardReplica.ts`.

Parity oracle (run UNCHANGED; only import paths change for the moved pure functions):
`frontend/src/domains/canvas/infrastructure/localCanvasStore.test.ts` (pure cases move with `boardSnapshot.ts`; the index/self-heal/quota cases are storage-specific and port as `legacyBoardImport` tests, which is the one declared deviation because the old API is synchronous localStorage and the new one is async IndexedDB), `frontend/src/lib/canvas/startCreationSession.test.ts`, `frontend/src/lib/guestPromptCapture.test.ts`, `frontend/src/lib/creationCheckpoints.test.ts`, `frontend/src/components/creation-canvas/sessionBoardWriters.test.tsx`, `CreationCanvas.test.tsx`, `CreationCanvas.realFlow.test.tsx`, `frontend/src/components/MarketingHeader.test.tsx`, `frontend/src/domains/canvas/application/PersistCanvas.test.ts`, `AdoptRemoteBoard.test.ts`, `ShareCanvasSession.test.ts`, `frontend/src/lib/canvasMediaStore.fetch.test.ts`, `canvasMediaStore.upload.test.ts` (upload test is edited only where it asserted the data-URL fallback; that assertion is replaced by the `BlobStore` assertion, which is intentional behaviour change, not a parity loss), and API `api/src/application/creation/claimBatchFailure.test.ts`, `sessionMembers.test.ts`, `api/src/application/sync/handleSyncPush.test.ts`, `importers.test.ts`, `g16ApplyContract.test.ts`.

## 7. Sign-in claim and destination rebind

`claimLocalDraft` (`lib/pendingWork.ts` L73) becomes `bindLocalBoard(boardId)`; `claimPendingDrafts` iterates unbound boards.
- Rebind uses `rebindDestination` (`destinationRebind.ts`) with an EXPLICIT `proposed` = the signed-in account's destination; it refuses with `pending_outbound` when unsent events exist. For an unbound board that is the normal case, so the sequence is: (1) `bindWorkForSync` / `bindDestination.ts` re-snapshots the board and every child from `UNBOUND` to the account partition in ONE transaction, then (2) enqueues the full-board create as a journal batch (board first, children `dependsOn` it), then (3) the sync driver pushes. The "pending_outbound" guard applies to boards that already have a bound destination.
- The plan-limit error (`isPlanLimitError`, `UpgradeModal`) comes back as a `rejected` receipt with the plan code; the board stays unbound-pending and the existing upgrade UI is shown from the receipt (same UX, new source).
- **Declared deviation (slice 3):** the bind transaction re-snapshots the board to the account destination BEFORE the server answers, so a plan refusal leaves the board bound-and-unsynced rather than "unbound-pending". It stays on the device, is not listed as a pending draft, and the upgrade UI is shown on the board's own route from the rejected receipt (`isBoardPlanLimited`); an upgrade lets the held event through.
- Idempotency: a retry after a crash re-reads the board's destination snapshot, so a second bind is a no-op; server replay is covered by event-id receipts. The `LastBoardBridge`/`rememberLastCanvas` pointer is updated from the first accepted board receipt (mapping available), not from the HTTP claim response.
- The guest-only rule stays: the SAMPLE workspace is not bound (the `clearGuestSession()` comment in `claimPendingDrafts`).
- The "`startCreationSession` falls back to a local board when server create fails" rule becomes simply: a board is ALWAYS created locally first (account or unbound) and synced; there is no fallback branch and no `local-` id prefix distinction.

## 8. Deleted, new, modules

Deleted at end of slice 3: `frontend/src/domains/canvas/infrastructure/localCanvasStore.ts` (+ its legacy reader after one release), the `persistence: 'local' | 'server'` branch in `useCanvasSession.ts`/`useCanvasSessionSync.ts` (one path: replica), the data-URL fallback in `lib/canvasMediaStore.ts`, the fallback-to-local branch in `lib/canvas/startCreationSession.ts`, `claimLocalDraft`'s direct `creationSessionsApi.claim` call from Studio (route kept server-side for other clients). Nothing else is removed; `creationSessionsApi.get/timeline` stay (they are the reconcile source).

New modules, one responsibility each:

Frontend (`frontend/src/domains/canvas/infrastructure/localFirst/` unless noted):
- `boardRecords.ts`: record types, payload shapes, schema version, id rules (no I/O).
- `boardReplica.ts`: read/query a board's records from the store; `seedFromServer`; `ingestFromServer`.
- `boardCommit.ts`: `commitBoardDiff` (diff -> one transaction with journal events), tombstones, dependency wiring.
- `boardOpen.ts`: local-first open + background reconcile + rebase using `AdoptRemoteBoard`.
- `boardConflicts.ts`: reads `SyncConflict` records; keep-mine / keep-theirs commands.
- `blobStore.ts`: IndexedDB/OPFS blob I/O, usage and caps. `mediaUploadQueue.ts`: drain and rewrite.
- `legacyBoardImport.ts`: the one-time localStorage import.
- `domains/canvas/domain/boardSnapshot.ts`: the pure snapshot shaping moved out of `localCanvasStore.ts`.
- `lib/localFirst/webSyncDriver.ts`: coordinator + transport + triggers + lease; generic (work management also uses it).
- `lib/localFirst/webAuthHeaders.ts` (only if the existing request helper cannot supply headers to `createHttpSyncTransport`).
- UI: a small `StudioSyncStatus` presentation component reading `syncSummary`, with i18n keys in the Studio namespace (no hard-coded strings; localize-guard hook applies), theme tokens, responsive at phone width.

API:
- `api/src/application/creation/sync/importSyncedCanvasBoard.ts`, `importSyncedCanvasObject.ts`, `importSyncedCanvasTimeline.ts`, `importSyncedCanvasMedia.ts`; plus the `creationGraphWriter.ts` extraction.

No file takes over `CanvasInner` or `useCanvasSession` responsibilities: those hooks shrink (they call `boardOpen` and `boardCommit`), they do not grow.

## 9. Done-checks

Automated (Vitest, `fake-indexeddb`, injected `fetch`; mirror `frontend/src/lib/localFirst/deniedNetworkAcceptance.test.ts` and `packages/local-first/src/networkDenialScenario.ts`):
1. Network denied, guest: create board from the start flow, add 3 cards and an edge, add an image, reload (new store instance on the same IndexedDB): everything present, image renders from `BlobStore`, zero `fetch` calls, no data URL in any record.
2. Network denied, signed in: same, then restore network: driver pushes; receipts accepted; mapping recorded; URL id swapped; `canvas_revision` on the server fake equals the event count; media uploaded then object url rewritten; pending count 0.
3. 503 on push (with and without `Retry-After`): events stay pending, UI shows held count, no error toast; next success drains in order; dead-letter does not trigger inside retention.
4. Two tabs (same IndexedDB, leases): edits in tab A visible in tab B without reload; only one tab pushes (assert one in-flight transport call); two edits to the same object produce one conflict record and a kept-both preview; different objects merge.
5. Two devices (two stores, one server fake): different objects merge; same object -> `conflict` receipt -> keep-mine/keep-theirs commands; delete-vs-edit -> deleted wins and edit restorable.
6. Server-originated change while open (peer edit via room/poll) lands in the store and the open board, with pending local events rebased by `AdoptRemoteBoard`.
7. Legacy import: N localStorage boards with data-URL media; run twice; exactly N boards, no duplicates, legacy keys removed only after commit, injected failure leaves the key.
8. Bind: unbound board with pending children -> sign in -> one transaction rebind -> board then children push in dependency order; a second bind is a no-op; plan-limit rejection shows the upgrade UI and keeps the board.
9. Server (`api`): `handleSyncPush` accepts each new type, rejects a viewer's write, replays idempotently, holds children `dependency_pending` until the board exists, rolls the whole chunk back on a throw (existing `handleSyncPush.batchTransaction.test.ts` pattern); `creationGraphWriter` whole-graph tests unchanged after the extraction.
10. Guards: `check-domain-root-table.mjs`, `check-source-package-graph.mjs`, localize guard, `check:use-client-boundaries`, token guard, plus the section 6 parity list.

Acceptance (real browser, DevTools offline, then a forced 503 on `/api/sync/v1/push`): the five scenarios in the brief reproduce with no console errors and with the status indicator reflecting held/synced.

Targeted verification only (no full vitest sweeps; one verifier per change set).

## 10. Slices (disjoint files, in order)

Review class: slice 1 and slice 3 touch more than one package or a shared contract, so their review is Opus at medium effort; slice 2 is Sonnet. One combined review after all three, then ship (project rule).

1. **Server and contract.** Files: `packages/local-first/src/records.ts`, `creationBinding.ts` (+ tests, export snapshot); `api/src/domain/sync/syncProtocol.ts`; `api/src/application/sync/importers/index.ts`, `namedSyncImporters.ts`; new `api/src/application/creation/sync/*`; `creationGraphWriter.ts` extraction; API tests (section 9 item 9). Output: `/api/sync/v1/push` accepts canvas entities end to end against the memory sync fixtures. No frontend change; ships dark (nothing sends these types yet), so it is independently deployable.
2. **Web engine and store.** Files: `frontend/src/lib/localFirst/webSyncDriver.ts` (+ work management adopts it), the whole `domains/canvas/infrastructure/localFirst/` folder (records, replica, commit, open, conflicts, blob store, upload queue, legacy import), `domains/canvas/domain/boardSnapshot.ts`. Output: fully tested library with no UI wiring and no deletion; items 1-8 of section 9 pass at the library level. Depends on slice 1 only for the integration test (uses its fixtures).
3. **Studio wiring and retirement.** Files: `CreationSessionClient.tsx`, `lib/pendingWork.ts`, `lib/canvas/startCreationSession.ts`, `useCanvasSession.ts`, `useCanvasSessionSync.ts`, `lib/canvasMediaStore.ts`, `useStudioApps.ts`, `LastBoardBridge.tsx`, `PendingDraftsNotice.tsx`, `SessionList.tsx`, `StudioSyncStatus` + i18n keys, then delete `localCanvasStore.ts` and run the parity list unchanged. Output: Studio on the replica, acceptance run.

## Decisions (2026-11-24, session model; operator may override)

Design reviewed and approved for implementation. The four product questions below take their recommended answers: (1) offline = boards opened on this device + the 20 most recent pre-seeded on sign-in; (2) caps 25 MB file / 200 MB video / 500 MB per device partition, 7-day blob grace; (3) same-object conflict = keep local rendered + keep-mine/keep-theirs SlideOutPanel; (4) no retention limit for unbound guest boards (unchanged behaviour). The pull projector (section 2) is a Gap Register entry, not part of slices 1–3.

## Open questions for the operator (business/product only)

1. **Offline scope for server boards never opened on this device.** Recommended: only boards opened at least once (plus the N most recent, default 20, pre-seeded on sign-in) are available offline. The alternative is replicating every board in the tenant, which costs storage and bandwidth on large workspaces.
2. **Storage caps.** The proposed per-device caps (500 MB total, per-file 25 MB / 200 MB video) and the 7-day blob grace. Confirm or change; they decide how much a guest can build before being told to sign in.
3. **Same-object conflict UX.** Recommended: keep the local value, offer "keep mine / keep theirs" in a side panel. The alternative is auto-forking the losing version as a sticky copy on the board (no decision required from the user, but it adds objects to their board).
4. **Guest boards on a shared computer.** Unbound boards persist in this browser profile until claimed or deleted; confirm there is no retention limit (current behaviour has none) or set one (for example 90 days of inactivity, with a notice).
