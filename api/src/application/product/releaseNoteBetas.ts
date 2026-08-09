/**
 * Beta enrolment — who has put themselves in which beta, and on what terms.
 *
 * A "beta program" is not a second kind of entity: it IS a published release note
 * on a beta stage that the operator opened for self-enrolment (`isJoinableBeta`).
 * That keeps one list of product updates rather than a changelog and a parallel
 * beta catalogue that drift apart — the panel shows both because they are the
 * same rows.
 *
 * READ SHAPE. The joinable list is an in-memory filter of the ALREADY cached
 * published list, so it costs no extra cache key and no extra invalidation point;
 * whatever invalidates the changelog invalidates this. The per-user enrolment
 * rows are then one indexed lookup — and when there are no joinable betas at all
 * (the common case) the lookup is skipped entirely, so the app-wide banner costs
 * a cache read and nothing else.
 *
 * CONSENT. Joining records WHEN the user agreed and a hash of WHICH text they
 * agreed to, so editing the terms afterwards is detectable rather than silently
 * rewriting what someone signed. Dismissing records neither — declining is not
 * consent — which is also why `status` distinguishes 'dismissed' from 'left'.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { releaseNoteBetaEnrollments } from '../../infrastructure/database/schema';
import { isJoinableBeta, listPublishedReleaseNotes, type ReleaseNote } from './releaseNotes';

export const BETA_ENROLLMENT_STATUSES = ['joined', 'left', 'dismissed'] as const;
export type BetaEnrollmentStatus = (typeof BETA_ENROLLMENT_STATUSES)[number];

export function isBetaEnrollmentStatus(value: unknown): value is BetaEnrollmentStatus {
  return typeof value === 'string' && (BETA_ENROLLMENT_STATUSES as readonly string[]).includes(value);
}

/**
 * What the consent hash covers when a beta carries no bespoke terms: the user
 * agreed to the platform's standard beta terms, and this sentinel says so
 * stably. Hashing the empty string instead would make "agreed to the default"
 * indistinguishable from "agreed to nothing".
 */
export const DEFAULT_BETA_TERMS_REF = 'platform-default-beta-terms/v1';

/** A beta as one user sees it — the note, plus where THEY stand with it. */
export interface BetaProgram extends ReleaseNote {
  /** null = never acted on it, which is the only state the banner offers. */
  myStatus: BetaEnrollmentStatus | null;
  agreedAt: string | null;
}

/** SHA-256 hex of the terms text as served — the "which text did they agree to"
 *  half of the consent record. Web Crypto, so it works on the worker runtime. */
export async function hashBetaTerms(terms: string | null): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(terms && terms.trim() ? terms : DEFAULT_BETA_TERMS_REF),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Every beta this user could join or has joined, newest first, each carrying
 * their own standing. Costs zero queries when no beta is open.
 */
export async function listBetaProgramsForUser(env: Env, db: Db, userId: string): Promise<BetaProgram[]> {
  const notes = (await listPublishedReleaseNotes(env, db)).filter(isJoinableBeta);
  if (notes.length === 0) return [];

  const rows = await db
    .select({
      releaseNoteId: releaseNoteBetaEnrollments.releaseNoteId,
      status: releaseNoteBetaEnrollments.status,
      agreedAt: releaseNoteBetaEnrollments.agreedAt,
    })
    .from(releaseNoteBetaEnrollments)
    .where(and(
      eq(releaseNoteBetaEnrollments.userId, userId),
      inArray(releaseNoteBetaEnrollments.releaseNoteId, notes.map((n) => n.id)),
    ));

  const mine = new Map(rows.map((r) => [r.releaseNoteId, r]));
  return notes.map((note) => {
    const row = mine.get(note.id);
    return {
      ...note,
      myStatus: isBetaEnrollmentStatus(row?.status) ? row!.status : null,
      agreedAt: row?.agreedAt ? row.agreedAt.toISOString() : null,
    };
  });
}

/**
 * The one beta worth interrupting someone about, or null.
 *
 * A PUBLIC beta they have never acted on: not joined, not left, not dismissed.
 * Private betas are invitation-only, and someone who already answered — in
 * either direction — has answered. Newest first, one at a time: two banners
 * stacked is how a product update becomes noise.
 */
export function bannerBeta(programs: BetaProgram[]): BetaProgram | null {
  return programs.find((p) => p.stage === 'public_beta' && p.myStatus === null) ?? null;
}

export interface BetaEnrollmentResult {
  status: BetaEnrollmentStatus;
  agreedAt: string | null;
}

/**
 * Join / leave / dismiss, upserted on (note, user) so a rejoin updates in place.
 *
 * `agreedAt`/`agreedTermsHash` are written on join and DELIBERATELY left intact
 * on leave: that they consented on that date to that text stays true after they
 * walk away. Rejoining re-stamps both, because the terms may have moved on.
 */
export async function setBetaEnrollment(
  db: Db,
  input: { note: ReleaseNote; userId: string; status: BetaEnrollmentStatus },
): Promise<BetaEnrollmentResult> {
  const { note, userId, status } = input;
  const agreedAt = status === 'joined' ? new Date() : null;
  const agreedTermsHash = status === 'joined' ? await hashBetaTerms(note.betaTerms) : null;

  const [row] = await db
    .insert(releaseNoteBetaEnrollments)
    .values({ releaseNoteId: note.id, userId, status, agreedAt, agreedTermsHash })
    .onConflictDoUpdate({
      target: [releaseNoteBetaEnrollments.releaseNoteId, releaseNoteBetaEnrollments.userId],
      set: {
        status,
        // COALESCE: only a join carries new consent; leaving/dismissing must not
        // erase the record of a consent that really happened.
        agreedAt: sql`COALESCE(EXCLUDED.agreed_at, ${releaseNoteBetaEnrollments.agreedAt})`,
        agreedTermsHash: sql`COALESCE(EXCLUDED.agreed_terms_hash, ${releaseNoteBetaEnrollments.agreedTermsHash})`,
        updatedAt: new Date(),
      },
    })
    .returning({ status: releaseNoteBetaEnrollments.status, agreedAt: releaseNoteBetaEnrollments.agreedAt });

  return {
    status: isBetaEnrollmentStatus(row?.status) ? row!.status : status,
    agreedAt: row?.agreedAt ? row.agreedAt.toISOString() : null,
  };
}

/**
 * Live participant count per note — the operator's answer to "is anyone actually
 * in this beta?". Only 'joined' counts; a dismissal is not a participant.
 */
export async function countBetaParticipants(db: Db, noteIds: string[]): Promise<Record<string, number>> {
  if (noteIds.length === 0) return {};
  const rows = await db
    .select({
      releaseNoteId: releaseNoteBetaEnrollments.releaseNoteId,
      participants: sql<number>`COUNT(*)::int`,
    })
    .from(releaseNoteBetaEnrollments)
    .where(and(
      inArray(releaseNoteBetaEnrollments.releaseNoteId, noteIds),
      eq(releaseNoteBetaEnrollments.status, 'joined'),
    ))
    .groupBy(releaseNoteBetaEnrollments.releaseNoteId);
  return Object.fromEntries(rows.map((r) => [r.releaseNoteId, Number(r.participants)]));
}
