/**
 * The kernel's twenty-five primitives, as entities (PRD 20 §2).
 *
 * Owned by no domain and forkable by none, so they are declared ONCE here rather
 * than filed under whichever seat reads them most — filing `ledger_entry` under
 * Finance is the fork §2 forbids, performed by a directory instead of a
 * migration.
 *
 * `activity_log` is absent deliberately: it predates the consolidation (0287),
 * it is already served by `/api/objects/:id/activity` and by every seat's
 * timeline, and a generic writer over an audit store is the one thing an audit
 * store must not have.
 *
 * WHAT IS READ-ONLY HERE, AND WHY. Six primitives carry invariants a generic
 * PATCH cannot keep:
 *   · `ledger_entries` — a balance is the sum of its entries. A row edited in
 *     place is money invented; corrections are compensating entries.
 *   · `credentials` — the ciphertext columns are redacted, so a generic write
 *     could only ever produce a credential row that decrypts to nothing.
 *   · `share_links` — the token IS the grant. Revocation is a use case with one
 *     path (§2), not a column somebody sets.
 *   · `metric_facts` — written by the projection sweep from measurements. Hand
 *     numbers in a fact table are the thing a fact table exists to prevent.
 *   · `runs` / `deliveries` — the executor and the sender own their state
 *     machines; a row nudged from `queued` to `sent` by hand is a lie about work
 *     that never happened.
 */
import {
  annotations,
  artifacts,
  catalogItems,
  connections,
  credentials,
  deliveries,
  formRecipients,
  invitations,
  ledgerEntries,
  memberships,
  messages,
  metricFacts,
  objects,
  partyRoles,
  questionSets,
  relations,
  responses,
  revisions,
  runs,
  settings,
  shareLinks,
  signatureParties,
  signatureRequests,
  snapshots,
  syncStates,
  templatesFoldLedger,
  threads,
  workItems,
} from '../../../infrastructure/database/schema/kernel';
import { defineDomainEntities, entity } from '../entityDefinition';
import { CATALOG_BROWSABLE_ROWS } from '../../templates/templateKinds';

export const KERNEL_ENTITIES = defineDomainEntities('kernel', [
  entity(objects, { kind: 'object', readOnly: true }),
  entity(ledgerEntries, { kind: 'ledger_entry', readOnly: true }),
  entity(credentials, { kind: 'credential', readOnly: true }),
  entity(shareLinks, { kind: 'share_link', readOnly: true }),
  entity(metricFacts, { kind: 'metric_fact', readOnly: true }),
  entity(runs, { kind: 'run', readOnly: true }),
  entity(deliveries, { kind: 'delivery', readOnly: true }),
  connections,
  syncStates,
  memberships,
  annotations,
  invitations,
  settings,
  relations,
  partyRoles,
  workItems,
  artifacts,
  revisions,
  snapshots,
  /**
   * READ-ONLY, and filtered. Templates, listings and packs are written by their
   * use cases — a template by `templates/catalogTemplateStore.ts`, which bumps the
   * catalogue's cache tokens and owns publication — so a generic PATCH that could
   * set `visibility = 'public'` would publish a template past every check and
   * leave the marketplace cache serving the old answer. And a 'private' canvas
   * template is its AUTHOR's (migration 1263), which only the template use case
   * can tell, so those rows are never returned here.
   */
  entity(catalogItems, { readOnly: true, visibleRows: CATALOG_BROWSABLE_ROWS }),
  /**
   * @deprecated — dropped by 1267. Migration 1263's fold ledger: migration-only
   * bookkeeping with no tenant column, registered READ-ONLY so it is neither listed
   * nor edited through the generic layer (tenant-less readability is opt-in). It is
   * here only because every consolidated table must sit in an `entities.ts`; delete
   * this line with the table (held-migrations/1267_drizzle.patch.md).
   */
  entity(templatesFoldLedger, { readOnly: true }),
  threads,
  messages,
  questionSets,
  responses,
  /**
   * The signature engine (0469). Both are READ-ONLY through the generic path and
   * the reason is the whole point of the primitive: a party's status is the
   * RECORD of what a named human did at a moment, reached through a credential
   * they alone held. A generic PATCH that could set `status = 'signed'` would
   * make the entity browser a machine for manufacturing agreements nobody gave —
   * strictly worse than having no signature engine at all, because the forged one
   * is indistinguishable from a real record.
   *
   * The signer route is the one writer, and it stamps the evidence in the same
   * statement as the status.
   */
  entity(signatureRequests, { kind: 'signature_request', readOnly: true }),
  entity(signatureParties, { kind: 'signature_party', readOnly: true }),
  /** A form's named-recipient credential. Read-only for the same reason
   *  `invitations` is: the token hash is the grant, and issuing one is a use case
   *  with one path, not a column somebody sets. */
  entity(formRecipients, { kind: 'form_recipient', readOnly: true }),
]);
