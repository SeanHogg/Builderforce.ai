/**
 * THE identity resolver for Insights (PRD 33 §5.1.4 "contacts only via
 * `resolveKnownContacts`"). Nothing else in Insights turns a visitor into a person.
 *
 * A recording carries an identity only when the SITE switched `identify` on and the
 * site itself called `BFReplay.identify(...)` (D9 / §7: no fingerprinting): the
 * recording's `identified_id`, else its `user` tag. That identity is matched
 * against the workspace's Sales contacts — the contacts owned by the workspace's
 * active members — by the contact's id (an external id the site passes through) or
 * its email. A visitor with no matching contact is COUNTED, never listed: Insights
 * does not mint people out of visits.
 */

import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { replayRecordings, salesContacts, tenantMembers } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { isUuid, type ReplayScope } from '../../domain/replay/replayScope';
import { replayTelemetryDb } from './replayDatabase';
import { identityOf } from './prescriptionAggregateReads';

/** Visitors resolved per call. */
export const RESOLVE_MAX_VISITORS = 500;

export interface KnownContact {
  contactId: string;
  name: string;
  email: string;
  /** The visitors (recording `visitor_id`s) this contact was seen as. */
  visitorIds: string[];
}

export interface KnownContactsResult {
  matched: KnownContact[];
  /** Identifiable visitors with no matching contact — counted, never listed. */
  unmatched: number;
  /** Visitors who never identified (the site's `identify` off, or anonymous). */
  anonymous: number;
}

const normal = (identity: string): string => identity.trim().toLowerCase();

export async function resolveKnownContacts(
  env: Env | undefined,
  db: Db,
  scope: ReplayScope,
  visitorIds: readonly string[],
): Promise<KnownContactsResult> {
  const wanted = [...new Set(visitorIds)].slice(0, RESOLVE_MAX_VISITORS);
  if (wanted.length === 0) return { matched: [], unmatched: 0, anonymous: 0 };

  const rows = await replayTelemetryDb(env, db)
    .select({ visitorId: replayRecordings.visitorId, identifiedId: replayRecordings.identifiedId, tags: replayRecordings.tags })
    .from(replayRecordings)
    .where(and(
      eq(replayRecordings.tenantId, scope.tenantId),
      eq(replayRecordings.siteId, scope.siteId),
      inArray(replayRecordings.visitorId, wanted),
    ))
    .orderBy(desc(replayRecordings.startedAt));

  // A visitor's newest identity wins (a person who signed in as someone else later).
  const identityByVisitor = new Map<string, string>();
  for (const row of rows) {
    const identity = identityOf(row);
    if (identity && !identityByVisitor.has(row.visitorId)) identityByVisitor.set(row.visitorId, normal(identity));
  }
  const anonymous = wanted.filter((v) => !identityByVisitor.has(v)).length;
  const identities = [...new Set(identityByVisitor.values())];
  if (identities.length === 0) return { matched: [], unmatched: 0, anonymous };

  const ids = identities.filter(isUuid);
  const contacts = await db
    .select({ id: salesContacts.id, name: salesContacts.name, email: salesContacts.email })
    .from(salesContacts)
    .innerJoin(tenantMembers, eq(tenantMembers.userId, salesContacts.ownerUserId))
    .where(scopedToTenant(tenantMembers, scope.tenantId, and(
      eq(tenantMembers.isActive, true),
      or(
        inArray(sql`lower(${salesContacts.email})`, identities),
        ids.length > 0 ? inArray(salesContacts.id, ids) : undefined,
      ),
    )));

  const byKey = new Map<string, { id: string; name: string; email: string }>();
  for (const c of contacts) {
    byKey.set(c.id.toLowerCase(), c);
    if (c.email) byKey.set(normal(c.email), c);
  }
  const matched = new Map<string, KnownContact>();
  let unmatched = 0;
  for (const [visitorId, identity] of identityByVisitor) {
    const contact = byKey.get(identity);
    if (!contact) {
      unmatched += 1;
      continue;
    }
    const entry = matched.get(contact.id) ?? { contactId: contact.id, name: contact.name, email: contact.email, visitorIds: [] };
    entry.visitorIds.push(visitorId);
    matched.set(contact.id, entry);
  }
  return { matched: [...matched.values()], unmatched, anonymous };
}
