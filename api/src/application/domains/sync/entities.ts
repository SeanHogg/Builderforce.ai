/**
 * Synchronization entities — the server half of the versioned batch sync protocol
 * (migration 1247), registered in the **integrations** seat.
 *
 * These four tables carry DELIVERY facts, not domain rules: which event was
 * accepted, which client UUID maps to which server id at which version, and what
 * a pulling device has not seen yet. Applying an event is delegated to the owning
 * context's import use case (`application/task/importSyncedTicket`,
 * `application/project/importSyncedProject`, or the mirror-record importer for
 * history-only entities) — nothing here replaces a domain aggregate.
 *
 * They sit in `integrations` rather than in a seat of their own because sync is the
 * SERVER HALF OF THE EXTENSION, not a business function: `integrations` already
 * owns the extension (`extension_versions`, `tenant_extension_installs`,
 * `extension_review_stages`) and the OTLP exporter, and adding an eighteenth seat
 * to `DOMAINS` for four transport tables would fork the object registry to buy a
 * label. `defineDomainEntities` derives its scope from `DOMAINS`, so a `sync`
 * scope would have to be registered there first — a change to the registry's
 * public surface that these four tables do not justify.
 *
 * EVERY ONE OF THEM IS READ-ONLY through the generic writer, and that is not a
 * uniformity decision — each carries a distinct reason, stated at its
 * registration. `sync_events` in particular is the replay anchor: a generic PATCH
 * that could clear `status` or rewrite `payload_hash` would let a caller
 * un-claim an event that has already been applied, which is precisely the
 * duplicate the idempotency key exists to prevent.
 */
import {
  syncChanges,
  syncEntityMappings,
  syncEvents,
  syncRecords,
} from '../../../infrastructure/database/schema/sync';
import { defineDomainEntities, entity } from '../entityDefinition';

/** Registered under `integrations`; exported separately so the catalog reads as
 *  one line per seat rather than four more imports of the same module. */
export const SYNC_ENTITIES = defineDomainEntities('integrations', [
  // The delivery receipt journal. Read-only because the row IS the idempotency
  // claim: (tenant, device, event_id) is a unique index a retried POST from a
  // reconnecting device resolves to. A generic write could flip `status` off
  // `applied` and let the same event be ingested a second time.
  entity(syncEvents, { readOnly: true }),

  // The client-UUID → server-id mapping plus the optimistic-concurrency counter.
  // Read-only because `server_version` is bumped by the compare-and-set the
  // idempotent apply performs — a generic PATCH could set it forward without
  // applying anything, and every later write against that entity would then be
  // accepted against a version that was never reached.
  entity(syncEntityMappings, { readOnly: true }),

  // The pull projection: one row per synced entity with its current payload,
  // client-reported provenance and tombstone. Read-only for the plain reason it
  // is a derived projection — the owning context's table is the truth, and a
  // generic write here would let a tenant edit a mirror of a row it may not
  // write at all.
  entity(syncRecords, { readOnly: true }),

  // The append-only delta log whose `seq` is the opaque pull cursor's payload.
  // Read-only because it is APPEND-ONLY by construction: a client that has read
  // past a sequence must never see it change or disappear, and that is a
  // stronger promise than `readOnly` on an ordinary table.
  entity(syncChanges, { readOnly: true }),
]);