/**
 * Integrations entities — owned by **the platform** (PRD 20 §3.2).
 *
 * A vendor is a `connection` row against a manifest entry, so adding Slack,
 * Notion or Xero adds no DDL here. Provider-neutral mailbox automation rules
 * and replies remain domain nouns, while the kernel's `connection`, `credential`
 * and `sync_state` continue to own connector infrastructure.
 *
 * The seat's surface is therefore a view over kernel primitives filtered to this
 * domain, not a table of its own — exactly what a consolidated model is supposed
 * to look like from above.
 */
import {
  extensionPackages,
  extensionVersions,
  mailboxAutomationReplies,
  mailboxAutomationRules,
  tenantExtensionInstalls,
} from '../../../infrastructure/database/schema/integrations';
import { defineDomainEntities, entity } from '../entityDefinition';

export const INTEGRATIONS_ENTITIES = defineDomainEntities('integrations', [
  entity(mailboxAutomationRules, { readOnly: true }),
  entity(mailboxAutomationReplies, { readOnly: true }),

  // ── Developer portal (PRD 24) ───────────────────────────────────────────
  // Every one of these is readOnly to the GENERIC layer. Their invariants are
  // not "a valid row" — they are "this version passed review", "this grant is
  // what an admin approved". A generic PATCH that could set
  // `review_state: 'approved'` or widen `granted_scopes` would route around the
  // entire review pipeline through a route that exists to save writing CRUD,
  // which is exactly the case `entityDefinition` reserves `readOnly` for. Writes
  // go through `application/developer/*`.
  //
  // There is no `publisher` entity, and there is no longer a table for one: a
  // publisher is a WORKSPACE with `tenants.publisher_state <> 'none'` (migration
  // 0472). Registering a facet of `tenants` as a domain entity here would give
  // the integrations domain an owner's claim over the identity context's root.
  entity(extensionPackages, { kind: 'extension', registers: true, readOnly: true }),
  entity(extensionVersions, { readOnly: true }),
  entity(tenantExtensionInstalls, { readOnly: true }),
]);
