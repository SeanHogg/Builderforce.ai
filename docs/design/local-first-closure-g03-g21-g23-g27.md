# Local-first closure: G03, G21 + G23, G27 (end state, rev 2)

Status: design rev 2, 2026-11-08. Rev 1 was sent back by an Opus review with REWORK (19 findings).
Each finding is folded in below and cited as [R#].

This design closes three ROADMAP › Local-first entries. Sources:

- [vsix-offline-first-architecture-review.md](./vsix-offline-first-architecture-review.md)
- [PRD 41 §B4](../specs/41-prd-offline-understanding-and-run-delta.md)

Not covered here:

- the per-hash upload migration (the replica stack moving into agent-tools; it owns `replica.json`,
  `dirty.json`, `analysis-pending.json` and `runs/`);
- the heal;
- sync residuals and recovered runs (shipped separately);
- Kimi `k3`.

---

## 1. G03: the SQLite store becomes the knowledge system of record (PRD 41 B4)

### Today

- `localRecordTransaction.ts` opens `node:sqlite` correctly. Its only API, `commitOfflineSet`, has no
  caller.
- `agent-runtime` has its own loader, `requireNodeSqlite`, used three ways:
  - `qmd-manager.ts:800` opens read-only with `busy_timeout = 1`;
  - `manager-sync-ops.ts:253` uses `allowExtension`;
  - one more caller.
- VS Code keeps every root as three whole files under `.builderforce/knowledge/<stem>.*`: the
  snapshot (rewritten on flush), the manifest and `extracted.jsonl`.
- On-prem has no local snapshot store. It reviews into `linked.client.store`, and only its manifest
  is local (`onPremKnowledge.ts:162-168`) [R1].

### End state

**One loader and one opener** [R7], in agent-tools Node subpath
`@builderforce/agent-tools/node-local-sqlite`:

- `loadNodeSqlite()` keeps the experimental-warning filter.
- `openLocalSqlite(path, { readOnly?, allowExtension?, busyTimeoutMs })`:
  - It runs `quick_check` and refuses a corrupt file with `local_record_store_corrupt`.
  - It asks for WAL. If the pragma does not return `wal` (a network share, `\\wsl$`), it falls back to
    `journal_mode = DELETE` and reports which mode it got [R4].
  - Read-only opens skip both the WAL request and the check.
- Every `requireNodeSqlite` caller moves to it, and `requireNodeSqlite` is deleted.
- `localRecordTransaction.ts` and `commitOfflineSet` are deleted. The journaled store owns the
  records it was meant to hold.
- `agent-runtime` `engines.node` rises to `>=22.13.0`.
- A VS Code integration assertion, pinned to 1.101.0, proves `node:sqlite` loads in that Electron
  build. Missing it fails loudly.

**One atomic Node writer** [R2]: `writeFileAtomic(path, bytes)` in
`@builderforce/agent-tools/node-local-sqlite`. It writes a temp file, fsyncs it, renames it over the
target and fsyncs the directory. It is passed explicitly as `writeDurably`'s writer, and callers
check `written`.

**The fact store** is `@builderforce/agent-tools/node-knowledge-store`. Layout: one store per
workspace folder at `<folder>/.builderforce/cache/knowledge/` [R19]:

- `index.sqlite`, with these tables:
  - `meta(k PRIMARY KEY, v)`: `format`, `generation`.
  - `scope(root_id PRIMARY KEY, json)`.
  - `fact(root_id, key, json, PK(root_id, key))`.
  - `relation(root_id, from_ref, to_ref, kind, json, PK(root_id, from_ref, to_ref, kind))`.
  - `recheck(root_id, hash, PK(root_id, hash))` [R3].
  - `manifest(source_id PRIMARY KEY, json)`, holding the review's `IngestManifest` per source id
    [R5].
  - `extracted_ref(hash PRIMARY KEY, object, written_at)`.
- `objects/<aa>/<sha256>.json`: `Extracted[]` per content hash, write-once through
  `writeFileAtomic`. A reference row is inserted only after its object write succeeds. Objects are
  shared across roots (content-addressed).

**The builderforce-memory contract** [R3]. `LocalSnapshotStoreOptions.rows?: RowPersistence`:

```ts
interface RowChange {
  upserts: { scopes: ScopeRecord[]; facts: StoredFact[]; relations: StoredRelation[];
             extracted: Array<[hash: string, entries: Extracted[]]>; recheck: Array<[rootId: string, hash: string]> };
  deletes: { scopes: string[]; facts: Array<[rootId: string, key: string]>;
             relations: Array<[rootId: string, from: string, to: string, kind: string]>;
             extracted: string[]; recheck: Array<[rootId: string, hash: string]> };
}
interface RowPersistence {
  load(): Promise<KnowledgeSnapshot | undefined>;   // undefined → empty (first open)
  apply(change: RowChange): Promise<{ generation: number; reloaded?: KnowledgeSnapshot }>;
}
```

How the store uses it:

- With `rows`, `extractedLog` and `SnapshotPersistence` are not used. Browser and MCP hosts keep
  those.
- Dirty tracking lives in a new module, `stores/rowDelta.ts`. `LocalSnapshotStore` is already 395
  lines and must not grow.
- **Swap-then-merge-back:** the dirty set is swapped out before `apply`. If `apply` fails, it is
  merged back under any newer marks, so nothing is lost or reordered. `apply` stays outside the
  mutation queue, as persistence does today.
- `canonicalDump(store)` exports the existing private `serialize()` [R8]. It is the projection read
  by `packPush.ts` and `portablePack.ts`.
- No `snapshot.json` is kept on disk. This deviation is recorded in PRD 41 B4 in the same pass [R8].
- Memory ships contract and regression tests:
  - the export snapshot and the type contract;
  - `regression:` a delta after N mutations equals the full dump;
  - a mutation made during `apply` is persisted on the next apply;
  - `apply` fails, then a retry persists everything;
  - `recheck` survives a reload.
- Publish only after those pass. Then bump every consumer and refresh every lockfile, including
  `packages/*` [R18].

**Concurrency: two windows on one folder** [R4]:

- `apply` runs inside `BEGIN IMMEDIATE` and reads `meta.generation`:
  - If it equals the generation this store last saw, apply the delta and bump the generation.
  - Otherwise, apply the delta, bump the generation, and return `reloaded`: a full read of the rows.
    The memory store replaces its in-memory maps with that read, so a window picks up the other
    window's writes.
  - Row-level upserts touch only keys this window dirtied, so a stale window cannot bring back a row
    another window deleted, unless it edited that row itself (last writer wins per row).
- The sweep deletes an object file only if:
  - no `extracted_ref` references it;
  - its mtime is older than a 1-hour grace period;
  - the deletion is checked inside `BEGIN IMMEDIATE`.

  PRD 41 C1 run pins and delta retention will add to this predicate when C1 lands. That is noted in
  PRD 41 and is not part of this closure.

**Manifest in the same transaction as facts** [R5]:

- `nodeIngestManifest(store)` is an `IngestManifest` factory over the same connection.
- Its writes are buffered and committed in the same `apply` transaction as the fact delta of the
  next flush. A manifest can never run ahead of the facts it describes, as PRD 41:443 requires.

**Migration** [R6]: `migrateLegacyKnowledge(files, store)`, run per legacy root id through
`migratingRootFiles` (`fileManifest.ts:107`):

1. Write the objects first.
2. In one transaction, import the snapshot rows, the manifest and the recheck set, and set
   `meta.format`. Chunk the import (≤ 2,000 rows per statement batch, measured and logged) so the
   synchronous `node:sqlite` never blocks the host for long.
3. Rename the legacy `<stem>.json`, the manifest and `extracted.jsonl` to `*.migrated`. A later open
   that finds `format` set and legacy files present still renames them (crash between commit and
   rename).
4. A legacy snapshot that does not parse is kept as `.corrupt`. `format` is set and the store
   starts empty.

The other files in `.builderforce/knowledge/` (replica, dirty, analysis-pending, runs) are owned by
the replica-stack migration and are untouched here.

**Workspace hygiene** (PRD 41 B4):

- Write `.builderforce/cache/.gitignore` containing `*`.
- Contribute `configurationDefaults` for `files.watcherExclude` and `search.exclude` on
  `**/.builderforce/cache/**`.
- Our own watcher ignores the path.

**Hosts:**

- **VS Code:** `knowledgeService.ts` builds the Node store. The knowledge index reads through it.
- **On-prem:** only the manifest moves, to `nodeIngestManifest` over its own
  `.builderforce/cache/knowledge/index.sqlite`. On-prem keeps reviewing into the platform store, and
  gaining a local snapshot store is not in scope [R1].
- **Browser hosts:** unchanged.

### Done-checks (G03)

- No write remains to the three legacy knowledge files in the VSIX or on-prem.
- One SQLite loader and one opener exist.
- Memory is published with its contract and regression tests, and every consumer and lockfile is
  bumped.
- Unit tests:
  - migration import and rename;
  - a crash after commit still renames;
  - a corrupt `index.sqlite` is refused;
  - the WAL fallback;
  - a second store on the same file sees the first store's writes after a generation mismatch;
  - the sweep keeps referenced and young objects;
  - the manifest and facts commit together.
- Opus reviews.

---

## 2. G21 + G23: a local copy for the rail, a local work list, and sync status

### Today

- The rail (`ChatTicketsPanel.tsx`, 402 lines) reads tickets and runs live from the webview.
- `chatStateReads.ts` caps at 25 tickets, drops ids and `linkType`, and returns `[]` on failure
  [R10].
- `syncStatusPresenter.ts` has no caller.
- No local-to-server link importer exists: the api importers cover ticket, chat, message, project
  and usage only [R11].
- There is no local record list UI [R13].

### End state

**One ingestion path for server-observed records** [R9]:

- `ingestServerRecords(store, records)` lives in `packages/local-first`, extracted from
  `applyServerCursor`'s record-apply step so that both callers share it.
- It writes records with `provenance { source: 'imported', evidence: 'server-observed' }` and the
  server-id mapping, in ONE store transaction (`put` + `putMapping`, with `mappingByServerId` for
  stable client ids).
- `deriveRecordSyncStatus` learns that imported + mapped + no pending events = `synced`.
- The rail reads feed it, and the G18 pull feeds it when it is wired.
- The word "mirror" is not used: it already means something else on the server.

**Rail reads that can feed it** [R10]:

- The host calls brain-embedded `readChatTicketLinks` / `readChatRunHistory` with raw DTOs (ids,
  `linkType`, no cap beyond the API's own paging).
- A failed read is a distinct error, and nothing is ingested on failure. The last copy stays.
- Runs ingest as entity type `execution`.

**Local link entity and server importer** [R11]:

- Local entity type `chat-ticket-link` (many-to-many with an attribute):
  - Its deterministic id is derived from the two client ids.
  - The payload carries `linkType`.
  - Unlink is a tombstone.
- It syncs. The api gains the importer `importSyncedChatTicketLink`, which writes through
  `upsertChatTicketLink` / unlink with the existing mapping lookups, and an accepted-types entry.
- This crosses local-first, the api and the VSIX, so Opus reviews it.

**Host rail service.** `clients/vscode/src/chatRail/`:

- `readRail(chatId: string | number)` answers from the store only:
  - tickets, links, runs;
  - each ticket's `presentSurfaceSyncStatus`;
  - `freshness: { lastIngestedAt?: string; source: 'device' | 'server-observed' }`.
- `refreshRail` runs the gated reads and ingests the results.
- A store subscription re-posts when a commit touches the chat, its links or its tickets.
- Bridge message: `local.chatRail`.

**The adapter split** [R12]:

- In the webview, `listTickets` / `listRuns` come from `local.chatRail`, and only their bearer-fetch
  path is deleted.
- `linkTicket` / `unlinkTicket` write the local `chat-ticket-link` record, which syncs through the
  importer.
- Merge, invite and run stay platform-gated as today.
- The adapter's chat id widens to `string | number`, so a local chat works.
- The badge, freshness line and summary are new small components beside the panel. The panel gains
  only the optional props. Web passes none and renders as today.

**Local work list (G05 UI)** [R13]:

- A native VS Code tree view, `builderforce.localWork`. Projects contain tickets.
- It reads `createLocalWorkRepository` over the host store, and shows each row's presented sync
  status as an icon and description.
- Actions: create ticket, set status, archive, open the bound chat.
- It works with the platform denied. All strings go through `vscode.l10n.t` and every bundle.

**Sync summary (G23).** `clients/vscode/src/sync/syncSummary.ts` is derived from the store:

- mode and destination;
- queued items and bytes;
- conflict count;
- dead-letter count;
- last successful push (from receipts);
- last successful pull. The store has no such timestamp today, so `meta.lastPullAt` is written by
  the pull path [R19].

It is shown in a status-bar item and in the rail header. Local completion never waits on upload.

### Done-checks (G21 + G23)

- The presenter has production callers.
- With the network denied, a chat read once shows its tickets, link types, runs, statuses and
  freshness.
- A local link reaches the server through the importer after a granted push.
- The local work tree works offline.
- Ingesting the same reads twice is idempotent.
- A failed read ingests nothing.
- Imported records present as `synced`.

---

## 3. G27: one scenario, three packaged drivers, the network denied at the OS

### Today

- `packages/local-first/src/networkDenialScenario.ts` is already "one function for web, rovr,
  vsix", but it runs in-process [R14].
- `test-integration/runTests.ts` runs from source with `--disable-extensions`.
- The VS Code self-check runs once at activation, fetches `example.com`, and is not a command [R15].
- `fakeGateway.ts` fakes the LLM stream, not sync [R15].
- Web production is `next-on-pages` deployed with `wrangler deploy` [R16].
- Web has no production local record store: `bootLocalWorkManagement` is called only from tests
  [R16].
- There is no Rovr package job in CI [R17].

### End state

**The scenario becomes a driver port** [R14]:

- `networkDenialScenario.ts` takes a `NetworkDenialDriver` with `boot`, `act` (create a local ticket
  and bind a chat), `restart`, `read`, `account` and `observed`.
- It asserts:
  - attempted = 0;
  - observed platform connections = 0;
  - the records survive a restart and present as `pending`;
  - after a grant against the fake sync server: one push and `synced`.
- The existing in-process use becomes one driver: the unit layer the three vitest files use. There
  is no second scenario file.

**Shared fake sync server.** `packages/local-first/src/acceptance/fakeSyncServer.ts` (Node `http`):

- It serves minimal `POST /api/sync/v1/push` and `pull`, recording every request.
- The same process also acts as the recording listener that platform hostnames resolve to.

**Network-account command** [R15]: `builderforce.diagnostics.networkAccount`.

- It is contributed and localized, and returns `platformRequestAccount()`.
- It shows the counts to a person who runs it.
- It is a real diagnostic, not a test hook.

**VS Code: the packaged VSIX** [R14][R15]. `test-integration/runTests.ts` gains a `--vsix <path>`
mode (same resolver, same cache):

1. Install the VSIX into a fresh `--extensions-dir`.
2. Launch without `--disable-extensions`, with a driver test extension whose `extensionDependencies`
   names the real extension.
3. The driver runs the scenario through real commands (local ticket create, chat bind,
   `diagnostics.networkAccount`).

In CI (Linux):

```
sudo unshare --net --mount -- sh -c 'ip link set lo up; mount --bind <hosts-file> /etc/hosts; exec sudo --preserve-env -u "$USER" xvfb-run -a node out-integration/runTests.cjs --vsix <path>'
```

- The temp hosts file resolves every platform hostname to 127.0.0.1, where the fake server records
  connections.
- VS Code itself is downloaded before the network is cut.

**Rovr: the packaged zip** [R17]:

- A CI job, `package-rovr`, runs `pnpm package` and uploads the zip.
- Playwright `launchPersistentContext` with `--load-extension=<unzipped>` and
  `--host-resolver-rules="MAP <platform hosts> 127.0.0.1:<recorder>"`, so the MV3 service worker's
  requests are observed too, not only the page's.
- The side panel opens as a tab at `chrome-extension://<id>/sidepanel.html`.
- Restart relaunches the same profile.

**Web: the production build** [R16]:

- Web local work is wired first (G05 web). `bootLocalWorkManagement` is booted through the same
  `next/dynamic` pattern as `PlatformPolicyBoot`.
- When the platform refuses, the existing ticket-create surface writes the local record and shows
  its presented status.
- The driver serves the `frontend-output` artifact with `wrangler dev --local`. Playwright uses
  `--host-resolver-rules` to the recorder, plus route recording for the page.

**CI.** Job `offline-acceptance`:

- It needs the VSIX artifact, `package-rovr` and the frontend build.
- It runs the three drivers.
- It is in the `needs:` of `publish-extension` and of `deploy-frontend` [R18].

### Done-checks (G27)

- Each driver passes, and each fails on a deliberately injected platform request (a negative test).
- The scenario file is single.
- The CI gate is required by publish and deploy.

---

## Rev 2 approval corrections (Opus, APPROVE WITH CHANGES). These override the sections above.

**C0 (G03, as implemented in memory 2026.10.56): two corrections to the `RowChange` types.**
- `upserts.facts` is `[rootId, StoredFact][]` and `upserts.relations` is `[rootId, StoredRelation][]`,
  because `StoredFact` and `StoredRelation` carry no root.
- `recheck` is one global `string[]` of hashes. The SQLite `recheck` table therefore has no
  `root_id` column.

**C1 (G03): no object files.**
- Extract bodies live in an `extracted(hash PRIMARY KEY, json)` table in `index.sqlite`.
- `objects/`, `extracted_ref`, the object sweep and the atomic Node writer are all dropped from this
  closure. Object files are what made a writer necessary; with them gone, it is not needed.
- Reload returns rows. Extract bodies load lazily per hash.
- This deviation from PRD 41 B4 (no `objects/` directory, no `snapshot.json`) is recorded in PRD 41.

**C2 (G03 reload).**
- `reloaded` is applied inside the mutation queue. It rebuilds the `relByPath` index, then re-applies
  the current dirty set on top.
- A window that never writes polls `PRAGMA data_version` before reads, and on window focus, so it
  still picks up another window's writes.

**C3 (G03 manifest).**
- `get` reads through the buffer.
- A `set` with no dirty facts triggers a manifest-only apply.
- The review runner puts a file's facts before `manifest.set` for that file.
- On-prem `nodeIngestManifest` commits directly, because on-prem has no fact store.

**C4 (G03 migration).**
- Yield with `setImmediate` between import chunks.
- Another window that gets `SQLITE_BUSY` during migration retries after `format` is set, rather than
  failing.

**C5 (G03 WAL).** Use `journal_mode = DELETE` for UNC and `\\wsl$` paths as well as when the WAL
pragma fails. `requireNodeSqlite` has two callers.

**C6 (G21 ingestion).** `ingestServerRecords(store, rows: { entityType, serverId, payload, updatedAt,
destination }[])` lives in `packages/local-first`. It is not extracted from the pure
`applyServerCursor`. It:
- resolves the client id with `mappingByServerId`, minting one when there is none;
- normalizes through `materialize`, exported from `applyServerCursor.ts` (not copied);
- commits `put` and `putMapping` in one store transaction;
- skips any record that has a pending local event;
- for a complete rail list, tombstones each local `chat-ticket-link` of that chat that the server no
  longer lists.

**C7 (G21 status).**
- The synced rule keys on provenance: `evidence === 'server-observed'` with no events and no
  receipts gives `synced`.
- A regression test proves a local record with no events still gives `local`.

**C8 (G21 importer).**
- A link event `dependsOn` both the chat's events and the ticket's events.
- `importSyncedChatTicketLink` resolves both server ids through mappings. It returns
  `dependency_pending` until both exist, then calls `upsertChatTicketLink`
  (`api/src/application/brain/chatTicketLinkWrite.ts:54`).
- If accepted sync types are constrained in SQL, the change ships expand/contract across two pushes.

**C9 (G23).** The last pull time is stored beside the cursor in the local-first store's state
(`setCursor`), not in the knowledge `meta`.

**C10 (G27 VS Code namespace command):**
```
sudo unshare --net --mount -- sh -c "ip link set lo up; sysctl -w net.ipv4.ip_unprivileged_port_start=0; mount --bind $HOSTS /etc/hosts; exec sudo -u $(id -un) env PATH=$PATH HOME=$HOME xvfb-run -a $(command -v node) out-integration/runTests.cjs --vsix $VSIX"
```
- The TCP recorder listens on :443 and :80 inside the namespace.
- The grant step points at the fake sync server through the API base setting
  (`http://127.0.0.1:<port>`), not through the hosts file.

**C11 (G27 Web).**
- A new localized route, `/[locale]/work/local`, renders with zero platform reads and boots
  `bootLocalWorkManagement` lazily on that route only.
- The driver serves `frontend-output` with `wrangler dev --local` and `frontend/wrangler.toml`.

## Sequencing

| Step | Work | Depends on | Implementer | Review |
|---|---|---|---|---|
| 1 | memory `rows` + `rowDelta` + `canonicalDump` + regressions; publish | — | Sonnet | Opus |
| 2 | G03 Node store (with an `extracted` table), opener, migration, concurrency, hygiene, VSIX + on-prem manifest, consumer bump | 1 | Sonnet | Opus |
| 3a | G21 local-first: `ingestServerRecords`, the provenance synced rule, the `chat-ticket-link` entity, the api importer, the last-pull timestamp | — | Sonnet | Opus |
| 3b | G21 + G23 VS Code: rail service, adapter split, local work tree, sync summary | 3a | Sonnet | Sonnet |
| 4 | G27 driver port, fake sync server, network command, VSIX `--vsix` mode, Rovr job + driver, Web local route + driver, CI gate | 3b | Sonnet | Sonnet |
