# Typed entity ids: LocalId (UUID) and SyncId (bigint)

Status: DESIGN v2, revised after an Opus review on 2026-11-10. Owner: the session planner.

Where this came from: editor run #70776 and chat #61651 guessed the same id in dozens of places, and the guesses disagreed:
- `Number(ref)` skipped local tickets;
- reading `.id` when the result carried `taskId` produced 17 duplicate delta tickets;
- the transport silently drops a numeric `serverId` (`httpSyncTransport.ts:163`).

## 1. The rule

| Concept | Type | Minted by | Shape |
|---|---|---|---|
| **LocalId** | `string` branded `LocalId` | the device that creates the entity | a UUID of any version. The check is case-insensitive, and minting is lower-case. |
| **SyncId** | `number` branded `SyncId` | the server, when it imports the entity | a positive safe integer, stored as Postgres `bigint` |

- Each entity created on a device has exactly one LocalId, and it never changes.
- After a sync receipt, the entity has a mapping row per destination, holding `syncId: SyncId | null` and `serverVersion`.
- A mapping row exists for **every** imported entity:
  - its `syncId` is null when the server row has no integer key (mirror records, usage, tier tickets);
  - nothing may invent a SyncId or guess one from an id's shape.
- Before the receipt there is no mapping row and no SyncId.
- An entity that was created on the server gets its LocalId when a device first ingests it (`ingestServerRecords`).
- One SyncId can map to several LocalIds. This happens with chat-ticket links re-linked under a new UUID, chats adopted by hint, and messages adopted by eventKey.
  - `localIdOf` returns the **earliest** mapping, in insertion order.
  - The server never reads a mapping by its server id.
- Brain chat **steps** and **messages** share entity type `message` but come from different tables, so a step's SyncId and a message's SyncId can be the same number. A step's mapping carries `syncId: null`, because its id is not a message id.
- Tier tickets (portfolio, objective, initiative, roadmap, spec):
  - they are real local `ticket` records with minted LocalIds;
  - their mapping holds `syncId: null` plus `externalRef: "kind:ref"`;
  - `mappingByExternalRef` replaces the `"kind:ref"`-in-`serverId` lookup (`railRows.ts:65`, `railLinks.ts:33`, `ingestServerRecords.ts:128`);
  - they are never created locally (`localDomainTools.ts:243`).

## 2. The one primitive: `packages/local-first/src/entityId.ts`

This file **absorbs** `clientEntityIdentity.ts` (G04): its `UUID_RE`, `INTEGER_ID_RE` and `mintClientEntityId` move here. The unused `rememberServerId` / `clientIdFor` are deleted, and so is `clientEntityIdentity.ts`. `entityId.ts` has no dependencies and is exported from `index.ts`.

```ts
export type LocalId = string & { readonly __brand: 'LocalId' };
export type SyncId  = number & { readonly __brand: 'SyncId' };
export function mintLocalId(): LocalId;                 // crypto.randomUUID(), lower-case
export function isLocalId(v: unknown): v is LocalId;    // THE UUID check (case-insensitive)
export function parseSyncId(v: unknown): SyncId | null; // positive safe int, or /^[1-9]\d*$/ text
export type EntityRef = { local: LocalId } | { sync: SyncId } | { tier: { kind: string; ref: string } };
export function parseEntityRef(v: unknown): EntityRef | null; // "kind:ref" → tier
export function syncIdText(id: SyncId): string;        // the one place a SyncId becomes wire/payload text
```

- **`isJournalEventId`** stays as an alias of `isLocalId`. It is case-insensitive, so it does not change what `storeTransaction.ts:105` accepts.
- **Payload fields that hold a mixed id shape stay strings**, because they are hashed on the wire. They are read through `parseEntityRef`:
  - `TicketValue.projectId` and `parentTicketId` hold a client id or decimal text;
  - `ChatTicketLinkValue.chatServerId` and `ticketServerId` are written via `syncIdText`.
- **Branded types do not survive a round-trip.** A value read back from JSON, `postMessage` or IndexedDB has lost its brand, so it goes through `isLocalId` / `parseSyncId` again.

## 3. The one resolver: `packages/local-first/src/entityIdResolver.ts`

```ts
export interface EntityIdResolver {
  syncIdOf(type: SyncEntityType, local: LocalId, destination?: EntityDestination): Promise<SyncId | null>;
  localIdOf(type: SyncEntityType, sync: SyncId, destination?: EntityDestination): Promise<LocalId | null>;
  resolve(type: SyncEntityType, ref: EntityRef, destination?: EntityDestination): Promise<{ localId: LocalId | null; syncId: SyncId | null }>;
}
export function entityIdResolver(store: LocalFirstStore): EntityIdResolver;
```

- `destination` is optional. When it is omitted, the resolver looks in any destination of the active account, because tool-argument callers (`resolveLocalReference`, `ticketClientId`) have no destination to pass.
- `mappingByServerId` honours the destination (it ignores it today, at `storeTransaction.ts:185`).
- These callers move onto the resolver, and each one's own lookup is deleted:
  - **vscode:**
    - `localTicketIdBridge`;
    - `localDomainTools` (`resolveLocalReference`, `localTicketId`, `serverIdOf`, `SERVER_ID_NUMERIC`, lines 255/274/440);
    - `localTicketScope.ticketClientId`;
    - `chatTicketGuard`;
    - `ticketChatOwnership`;
    - `chatRail/buildRail.ts:48,69`, `resolveChat.ts:24,33`, `railLinks.ts:33`;
    - `chatChangedFiles.ts:39`.
  - **local-first:** `chatTicketLink.ts:99` (`linkServerIds`), `journalRules.importPayload`, `ledgerSpend.ts:93`, `localFirstPersistence.ts:117`.
  - **brain-embedded:** `localChat/chatIdentity.boundServerId`, `types.ts:97`.
- Chat **view keys** (brain-embedded's numeric `localId`, chrome's negative `LocalChat.id`) are not LocalIds. They get a `ViewKey` type alias, and no field is renamed: `LocalChat.id` is an IndexedDB keyPath.

## 4. Storage

### Device (Phase A)

- `ServerMapping` becomes `{ destination, entityType, clientEntityId, syncId: SyncId | null, serverVersion, externalRef?: string, serverId?: string }`.
- **No upgrade step and no deletes.** One tolerant normaliser, `normalizeServerMapping(raw)` in `records.ts`, applies `syncId = parseSyncId(raw.syncId) ?? parseSyncId(raw.serverId) ?? null`, and moves a `"kind:ref"` `serverId` to `externalRef`. It runs:
  - in the VS Code journal store, both on load and when a delta is applied (`durableLocalFirstStore`);
  - in the chrome/web snapshot store, on load (`indexedDb.ts`).
- Writes put both `syncId` and `serverId` (text) for one release, so an older extension window that shares the journal still reads the row.
- `sync.ts:346` writes the mapping **whenever `receipt.serverVersion` is present**, even with no id. This fixes mirror and usage records re-queuing as imports.
- `httpSyncTransport.ts:163` reads `syncId ?? serverId`, as a number or decimal text, so the silent drop is fixed.
- `SyncReceipt` (which the api re-exports) gains `syncId?: number` and keeps `serverId?: string`.

### Server (Phase B, this release: expand only)

- Migration `1339_sync_entity_mappings_sync_id.sql`:
  - adds `sync_id bigint NULL` to **`sync_entity_mappings` only**. The `sync_changes`, `sync_events` and `sync_records` log tables keep `server_id` text and are parsed at the edge;
  - backfills `WHERE server_id ~ '^[1-9][0-9]*$'`;
  - adds a **plain** (not unique) index on `(tenant_id, entity_type, sync_id)`.
- Writers dual-write `server_id` and `sync_id`. Readers use `COALESCE(sync_id, parseSyncId(server_id))`, because rows the old Worker writes between the migration and the deploy have a null `sync_id`.
- Every importer's `serverNumericId` becomes `parseSyncId` (`handleSyncPush.ts:99`, `importers/index.ts:102 mappedChat`).
- Mirror and usage imports keep their mapping rows and leave `sync_id` NULL. `server_id` stays as it is today, so older devices keep working.
- Receipts emit `syncId` (a number, when the id is an integer) alongside `serverId` text.
- **Contract push (drop `server_id` on mappings).**
  - Gate: the `/api/sync` push telemetry shows no client below the version that reads `syncId`, measured by the extension version on the request (`x-builderforce-client-version`).
  - It is a Gap Register entry, and that gate is its blocker.
- Pull sends `syncId` on rows (`syncPersist.ts rowToRecord`/`changeRecord`). This is a fix: pull never sent the id before. Ingest goes through `localIdOf`, and its earliest-mapping rule settles a rail-ingested twin.
- Entity tables keep int4 `serial` ids, since every int4 is a valid SyncId.

## 5. Tool results: one id shape

- **Results.** Each tool that creates or returns a syncable entity adds `localId?` / `syncId?` to the result:
  - `builtin_tasks_create` adds `syncId`;
  - `builtin_tickets_from_delta` adds `syncId`;
  - local `ticket-create` / `project-create` add `localId` and `syncId` and keep `id` / `serverId`;
  - `builtin_chats_list_tickets` rows add `syncId` for task tiers.
- **Consumers.** One reader, `entityIdsOf(result)` in `brain-embedded/src/toolResultRecord.ts`, built on `parseEntityRef`. It reads `syncId`, then `taskId`, then a numeric `id`, and `localId` or a UUID `id`. It replaces:
  - `ticketToolVocabulary.serverTicketId`;
  - the readers in `runBackstops.recordCodeChangeTicket`, `planHandoff.fileTickets`, `chatWorkLinking` and `localTicketCloseOut`.
- **Arguments.** `builtinMcpService` gets a new `idArg(v, name)` (`parseSyncId`, with a clear error on a non-id) for id arguments only. `num()` stays for `limit`, `offset` and `position`.

## 6. Sequence: a ticket created in the editor, then dispatched

1. `ticket-create` mints a LocalId and returns `{ id, localId }`.
2. A sync pass imports the ticket. The receipt carries `{ syncId: tasks.id, serverId: "<text>" }`, and the device writes `ServerMapping{ syncId }`.
3. The model calls `builtin_kanban_coordinate { taskId: <LocalId> }`. The bridge calls `resolver.syncIdOf`, and gets either the number or `null`. On `null` the call fails with "not synced yet" rather than guessing.
4. At close-out, `ticketStatusMove` picks between `ticket-move` and `builtin_tasks_update` from the `EntityRef`, not from the shape of a string.

## 7. Not in scope (logged)

- The api's sweep of UUID regexes outside sync (about 15 copies) gets its own DRY entry.
- (The v1 claim about the web writer's `eventId` was wrong. `storeTransaction.ts:104` turns a non-UUID into an idempotency key, so there is no bug there.)

## 8. Done checks

- **Guard script:** `scripts/check-entity-id-parsing.mjs` fails on a UUID regex or a `/^\d+$/`-style id parse outside `entityId.ts`. An allowlist covers the api routes that are not about sync.
- **Normaliser** tested on a fixture with decimal, numeric, `"kind:ref"` and UUID rows. Nothing is deleted, and both fields are written.
- **Mapping write:** written from a receipt that has `serverVersion` but no id (mirror/usage regression).
- **Numeric `syncId`** from the transport is accepted (regression).
- **`mappingByServerId`** honours the destination (regression).
- **Server:**
  - the 1339 backfill is tested;
  - the index is non-unique;
  - receipts carry `syncId`;
  - readers coalesce.
- **`entityIdsOf`** is the only reader of tool-result ids.
- **Tests that change what they check:**
  - these assert non-numeric server ids, so their assertions change rather than just their field names (listed in the PR): `importers.test.ts:625,638-643`, `g16ApplyContract.test.ts:58,111`, `handleSyncPull.test.ts:36`;
  - all other sync, importer, bridge and chatIdentity tests run unchanged.
