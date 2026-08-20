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
  extensionCategories,
  extensionPackages,
  extensionReviewStages,
  extensionVersions,
  mailboxAutomationReplies,
  mailboxAutomationRules,
  mailboxPushReceipts,
  mailboxWatches,
  tenantExtensionInstalls,
} from '../../../infrastructure/database/schema/integrations';
import { defineDomainEntities, entity } from '../entityDefinition';

export const INTEGRATIONS_ENTITIES = defineDomainEntities('integrations', [
  entity(mailboxAutomationRules, { readOnly: true }),
  entity(mailboxAutomationReplies, { readOnly: true }),
  /** The provider push subscription behind a connected mailbox (migration 1095),
   *  and the claim check that keeps one email to one workflow run. Read-only to
   *  the generic layer because neither is a record of anything: `cursor`,
   *  `expires_at` and `subscription_id` are LIVE protocol state that only means
   *  something while it agrees with Gmail or Graph, and a receipt edited by hand
   *  either re-fires a workflow for mail already handled or silently swallows the
   *  next one. `mailboxWatch.ts` is the single writer of both. */
  entity(mailboxWatches, { readOnly: true }),
  entity(mailboxPushReceipts, { readOnly: true }),

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

  // The directory taxonomy (1094). Read-only here for a different reason than the
  // three above: it is not that a generic write would route around a gate, it is
  // that a category is PLATFORM configuration and every listing on the deployment
  // files itself under one. A generic PATCH from any tenant's entity route would
  // let one workspace rename the category every other workspace's package sits in.
  entity(extensionCategories, { readOnly: true }),

  // The per-stage review record. Read-only for the same reason `extension_versions`
  // is: its invariant is not "a valid row", it is "this is what the pipeline
  // actually observed". A generic write that could set `verdict: 'pass'` would be
  // a review nobody ran, recorded as one that did.
  entity(extensionReviewStages, { readOnly: true }),
]);
