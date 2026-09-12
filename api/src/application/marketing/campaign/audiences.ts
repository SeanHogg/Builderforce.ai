/**
 * Campaign audiences and the tenant-wide suppression list — who a campaign may
 * reach. Split out of `../campaignEngine.ts` (whose header states the four things
 * the engine refuses to do); that module re-exports everything here.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../../infrastructure/database/connection';
import {
  marketingAudienceMembers,
  marketingAudiences,
  marketingSuppressions,
} from '../../../infrastructure/database/schema';
import { excluded } from '../../../infrastructure/database/upsert';
import { isSendableEmail, normalizeEmail } from '../../shared/dnsVerification';
import { isE164 } from '../campaignTransports';

// ---------------------------------------------------------------------------
// Audiences
// ---------------------------------------------------------------------------

export interface AudienceView {
  id: number;
  name: string;
  description: string;
  memberCount: number;
  projectId: number | null;
  updatedAt: Date;
}

export async function listAudiences(db: Db, tenantId: number): Promise<AudienceView[]> {
  return db
    .select({
      id: marketingAudiences.id,
      name: marketingAudiences.name,
      description: marketingAudiences.description,
      memberCount: marketingAudiences.memberCount,
      projectId: marketingAudiences.projectId,
      updatedAt: marketingAudiences.updatedAt,
    })
    .from(marketingAudiences)
    .where(eq(marketingAudiences.tenantId, tenantId))
    .orderBy(sql`${marketingAudiences.updatedAt} DESC`);
}

export async function createAudience(
  db: Db,
  tenantId: number,
  input: { name: string; description?: string; projectId?: number | null },
): Promise<AudienceView> {
  const [row] = await db
    .insert(marketingAudiences)
    .values({
      tenantId,
      name: input.name.trim().slice(0, 255) || 'Audience',
      description: (input.description ?? '').slice(0, 2_000),
      projectId: input.projectId ?? null,
    })
    .returning({
      id: marketingAudiences.id,
      name: marketingAudiences.name,
      description: marketingAudiences.description,
      memberCount: marketingAudiences.memberCount,
      projectId: marketingAudiences.projectId,
      updatedAt: marketingAudiences.updatedAt,
    });
  return row!;
}

export interface AudienceMemberInput {
  email: string;
  name?: string;
  /** E.164 mobile number, for SMS campaigns. Anything that is not E.164 is
   *  DROPPED rather than stored: a number Twilio cannot dial is not a number,
   *  and keeping it would make an audience look messageable when it is not. */
  phone?: string | null;
  source?: string;
  attributes?: Record<string, unknown>;
}

/**
 * Add or refresh audience members. Returns how many were genuinely new so the
 * caller can report "12 added, 3 already there" rather than a meaningless total.
 *
 * Re-adding an UNSUBSCRIBED member deliberately does NOT resubscribe them: the
 * `status` column is left alone on conflict. Importing a list must never undo
 * someone's opt-out.
 */
export async function addAudienceMembers(
  db: Db,
  tenantId: number,
  audienceId: number,
  members: AudienceMemberInput[],
): Promise<{ added: number; updated: number; rejected: number }> {
  const [audience] = await db
    .select({ id: marketingAudiences.id })
    .from(marketingAudiences)
    .where(and(eq(marketingAudiences.id, audienceId), eq(marketingAudiences.tenantId, tenantId)))
    .limit(1);
  if (!audience) return { added: 0, updated: 0, rejected: members.length };

  const seen = new Set<string>();
  const rows: Array<typeof marketingAudienceMembers.$inferInsert> = [];
  let rejected = 0;
  for (const member of members) {
    if (!isSendableEmail(member.email)) {
      rejected += 1;
      continue;
    }
    const email = normalizeEmail(member.email);
    // De-duplicate WITHIN the batch too: Postgres rejects an ON CONFLICT insert
    // that touches the same key twice in one statement.
    if (seen.has(email)) continue;
    seen.add(email);
    const phone = (member.phone ?? '').trim();
    rows.push({
      audienceId,
      tenantId,
      email,
      name: (member.name ?? '').slice(0, 255),
      // A number that is not E.164 is dropped rather than stored — see the field
      // doc. `undefined` (not null) so an import that omits the column cannot
      // wipe a number the audience already holds.
      ...(isE164(phone) ? { phone } : {}),
      source: (member.source ?? 'manual').slice(0, 32),
      attributes: member.attributes ?? {},
    });
  }
  if (rows.length === 0) return { added: 0, updated: 0, rejected };

  const inserted = await db
    .insert(marketingAudienceMembers)
    .values(rows)
    .onConflictDoUpdate({
      target: [marketingAudienceMembers.audienceId, marketingAudienceMembers.email],
      set: {
        name: excluded(marketingAudienceMembers.name),
        // COALESCE, not overwrite: re-importing a list without phone numbers must
        // not delete the ones already there. `phone_status` is untouched for the
        // same reason `status` is — an import must never undo an opt-out.
        phone: sql`COALESCE(${excluded(marketingAudienceMembers.phone)}, ${marketingAudienceMembers.phone})`,
        updatedAt: sql`NOW()`,
      },
    })
    // `xmax = 0` is true only for a freshly-inserted row, so this distinguishes
    // a real add from an update without a second round-trip.
    .returning({ id: marketingAudienceMembers.id, isNew: sql<boolean>`(xmax = 0)` });

  const added = inserted.filter((r) => r.isNew).length;
  await refreshAudienceCount(db, tenantId, audienceId);
  return { added, updated: inserted.length - added, rejected };
}

/** Recompute the denormalized subscribed count. One statement, no read-back. */
export async function refreshAudienceCount(db: Db, tenantId: number, audienceId: number): Promise<void> {
  await db
    .update(marketingAudiences)
    .set({
      memberCount: sql`(
        SELECT COUNT(*)::int FROM ${marketingAudienceMembers}
        WHERE ${marketingAudienceMembers.audienceId} = ${audienceId}
          AND ${marketingAudienceMembers.status} = 'subscribed'
      )`,
      updatedAt: sql`NOW()`,
    })
    .where(and(eq(marketingAudiences.id, audienceId), eq(marketingAudiences.tenantId, tenantId)));
}

// ---------------------------------------------------------------------------
// Suppression
// ---------------------------------------------------------------------------

/** Add addresses to the tenant-wide do-not-contact list. Idempotent. */
export async function suppressEmails(
  db: Db,
  tenantId: number,
  emails: string[],
  reason: 'unsubscribed' | 'bounced' | 'complaint' | 'manual' = 'manual',
): Promise<number> {
  const rows = [...new Set(emails.filter(isSendableEmail).map(normalizeEmail))]
    .map((email) => ({ tenantId, email, reason }));
  if (rows.length === 0) return 0;
  const inserted = await db
    .insert(marketingSuppressions)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: marketingSuppressions.id });
  return inserted.length;
}

/** The subset of `emails` this tenant may not contact. ONE query, never per-row. */
export async function suppressedSubset(db: Db, tenantId: number, emails: string[]): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const rows = await db
    .select({ email: marketingSuppressions.email })
    .from(marketingSuppressions)
    .where(and(eq(marketingSuppressions.tenantId, tenantId), inArray(marketingSuppressions.email, emails)));
  return new Set(rows.map((r) => r.email));
}
