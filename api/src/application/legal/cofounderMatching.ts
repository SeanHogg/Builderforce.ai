/**
 * Co-founder matching — the half of FO-D5 that is genuinely new.
 *
 * ── WHAT THIS CLOSES ─────────────────────────────────────────────────────────
 * `grep -i 'co-?founder'` across the frontend returned NO matches: no matching
 * surface, no introduction path, no founder agreement, no IP assignment. The
 * first artifact a company produces had no home at all, and "find a co-founder"
 * — the question that comes before every other question in this vocabulary — had
 * no answer.
 *
 * ── WHY ONLY THE MATCHING HALF ───────────────────────────────────────────────
 * The PAPERWORK half is a signature flow over a template: a founders' agreement,
 * an IP assignment and a vesting schedule are a `contract` signed through
 * `signatureEngine.ts`, and building a second founder-agreement mechanism beside
 * it would be a second answer to "is it signed". Only the matching is a thing the
 * platform could not express at all.
 *
 * ── WHY THE SCORER IS PURE ───────────────────────────────────────────────────
 * It takes two profiles and returns a number with its reasons. No database, no
 * clock, no network — so it is testable as a table, and so the RANKING can be
 * explained to the person being ranked. A match score somebody cannot see the
 * reasons for is a recommendation they have to take on faith about the most
 * consequential professional decision they will make.
 *
 * ── AND WHY IT PRODUCES A RANKING, NEVER A MATCH ─────────────────────────────
 * The scorer ranks; a HUMAN asks; the other human answers. A product that
 * manufactured mutual "matches" out of a similarity score would be asserting an
 * agreement neither party gave — the same defect the approval gate exists to
 * stop, in a different currency.
 */

import { and, desc, eq, ne, or } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { cofounderIntroductions, cofounderProfiles } from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';

/**
 * The halves of a company somebody can cover.
 *
 * Deliberately coarse. A twenty-value taxonomy would be more accurate and less
 * useful: the question a founder is actually asking is "does this person cover
 * what I do not", and four answers make that legible where twenty make it a
 * filter nobody sets.
 */
export const COFOUNDER_STRENGTHS = ['technical', 'commercial', 'product', 'operations'] as const;
export type CofounderStrength = typeof COFOUNDER_STRENGTHS[number];

export const COFOUNDER_COMMITMENTS = ['full-time', 'part-time', 'nights-weekends', 'advisory'] as const;
export type CofounderCommitment = typeof COFOUNDER_COMMITMENTS[number];

export function isCofounderStrength(value: unknown): value is CofounderStrength {
  return typeof value === 'string' && (COFOUNDER_STRENGTHS as readonly string[]).includes(value);
}

export function isCofounderCommitment(value: unknown): value is CofounderCommitment {
  return typeof value === 'string' && (COFOUNDER_COMMITMENTS as readonly string[]).includes(value);
}

/** The shape the scorer reads. Deliberately narrower than the row: a scorer that
 *  could see the user id could be made to prefer somebody, and nothing here needs
 *  to know who anyone is. */
export interface ScorableProfile {
  strength: string;
  seeking: string;
  brings: readonly string[];
  needs: readonly string[];
  commitment: string;
  equityExpectation: number | null;
  location: string | null;
  remoteOk: boolean;
  sectors: readonly string[];
  stage: string | null;
}

export interface MatchReason {
  /** Which dimension this is about, for grouping in the UI. */
  dimension: 'complementarity' | 'skills' | 'commitment' | 'equity' | 'location' | 'sector';
  /** Signed: a negative reason is shown, not hidden. The most useful thing a
   *  match report can say is what does NOT line up. */
  points: number;
  detail: string;
}

export interface MatchScore {
  /** 0–100. Clamped, so a very complementary pair cannot exceed a full match and
   *  a very poor one cannot go negative and sort below "no data". */
  score: number;
  reasons: MatchReason[];
}

/**
 * The weights, declared as data.
 *
 * COMPLEMENTARITY dominates on purpose. Every other dimension is a preference and
 * this one is the reason to have a co-founder at all: two people who cover the
 * same half of a company have hired a peer, not filled a gap. Commitment is next
 * because a full-time founder and a nights-and-weekends one is the single most
 * common way a co-founder relationship ends, and it is knowable on day one.
 */
const WEIGHTS = {
  complementarity: 34,
  skills: 22,
  commitment: 20,
  equity: 12,
  sector: 7,
  location: 5,
} as const;

const normalise = (values: readonly string[]): Set<string> =>
  new Set(values.map((v) => v.trim().toLowerCase()).filter(Boolean));

/**
 * Score one pair, from A's point of view.
 *
 * Asymmetric on purpose: A seeking what B is, is a different fact from B seeking
 * what A is, and a symmetric score would average away the case that matters most
 * — one person who badly wants what the other has, and one who does not.
 * {@link mutualScore} composes the two when both sides are being reported.
 */
export function scoreMatch(a: ScorableProfile, b: ScorableProfile): MatchScore {
  const reasons: MatchReason[] = [];
  let total = 0;

  // 1 — Complementarity. Does B cover what A is looking for?
  if (a.seeking === b.strength) {
    total += WEIGHTS.complementarity;
    reasons.push({ dimension: 'complementarity', points: WEIGHTS.complementarity, detail: `You are looking for ${a.seeking}; they are ${b.strength}.` });
  } else if (a.strength === b.strength) {
    // Not merely "no points": two people covering the same half is a REASON
    // AGAINST, and reporting it as a neutral absence would hide the single
    // most important thing this comparison can tell either of them.
    total -= 10;
    reasons.push({ dimension: 'complementarity', points: -10, detail: `You are both ${a.strength}. That can work, and it means nobody is covering the other half.` });
  } else {
    reasons.push({ dimension: 'complementarity', points: 0, detail: `They are ${b.strength}; you are looking for ${a.seeking}.` });
  }

  // 2 — Skills. What A needs, against what B brings.
  const needs = normalise(a.needs);
  const brings = normalise(b.brings);
  const covered = [...needs].filter((need) => brings.has(need));
  if (needs.size) {
    const share = covered.length / needs.size;
    const points = Math.round(WEIGHTS.skills * share);
    total += points;
    reasons.push({
      dimension: 'skills',
      points,
      detail: covered.length
        ? `They bring ${covered.length} of the ${needs.size} things you said you need: ${covered.slice(0, 5).join(', ')}.`
        : `None of the ${needs.size} things you said you need appear in what they bring.`,
    });
  }

  // 3 — Commitment. Equal is good; adjacent is workable; opposite ends are not.
  const ladder = COFOUNDER_COMMITMENTS as readonly string[];
  const gap = Math.abs(ladder.indexOf(a.commitment) - ladder.indexOf(b.commitment));
  const commitmentPoints = gap === 0 ? WEIGHTS.commitment : gap === 1 ? Math.round(WEIGHTS.commitment / 2) : -8;
  total += commitmentPoints;
  reasons.push({
    dimension: 'commitment',
    points: commitmentPoints,
    detail: gap === 0
      ? `You are both ${a.commitment}.`
      : `You are ${a.commitment}; they are ${b.commitment}. Mismatched commitment is the most common reason a founding team breaks up — settle it before anything else.`,
  });

  // 4 — Equity. Two expectations that add to more than 100 is not a preference
  // mismatch, it is an arithmetic impossibility, and saying so early is worth
  // more than any number of shared interests.
  if (a.equityExpectation != null && b.equityExpectation != null) {
    const combined = a.equityExpectation + b.equityExpectation;
    const points = combined > 100 ? -15 : combined > 90 ? 0 : WEIGHTS.equity;
    total += points;
    reasons.push({
      dimension: 'equity',
      points,
      detail: combined > 100
        ? `Your expectations add to ${combined.toFixed(0)}%, which cannot be split. One of you has to move before anything else is worth discussing.`
        : `Your expectations add to ${combined.toFixed(0)}%, which leaves ${(100 - combined).toFixed(0)}% for the option pool and everyone else.`,
    });
  }

  // 5 — Sector.
  const sectorOverlap = [...normalise(a.sectors)].filter((s) => normalise(b.sectors).has(s));
  if (sectorOverlap.length) {
    total += WEIGHTS.sector;
    reasons.push({ dimension: 'sector', points: WEIGHTS.sector, detail: `You are both interested in ${sectorOverlap.slice(0, 3).join(', ')}.` });
  }

  // 6 — Location. Remote on either side makes distance irrelevant, which is why
  // this is the smallest weight and never a negative one: it is a logistics
  // question, not a compatibility one.
  if (a.remoteOk || b.remoteOk) {
    total += WEIGHTS.location;
    reasons.push({ dimension: 'location', points: WEIGHTS.location, detail: 'At least one of you is open to remote.' });
  } else if (a.location && b.location && a.location.trim().toLowerCase() === b.location.trim().toLowerCase()) {
    total += WEIGHTS.location;
    reasons.push({ dimension: 'location', points: WEIGHTS.location, detail: `You are both in ${b.location}.` });
  } else if (a.location && b.location) {
    reasons.push({ dimension: 'location', points: 0, detail: `You are in ${a.location}; they are in ${b.location}, and neither of you said remote.` });
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(total))),
    // Strongest signal first, positive or negative — a reader scanning the list
    // should meet the thing that decided the score, not the tie-breakers.
    reasons: reasons.sort((x, y) => Math.abs(y.points) - Math.abs(x.points)),
  };
}

/** Both directions, for a report shown to both people. The lower of the two
 *  leads, because a pairing is only as good as the side that wants it less. */
export function mutualScore(a: ScorableProfile, b: ScorableProfile): { score: number; forA: MatchScore; forB: MatchScore } {
  const forA = scoreMatch(a, b);
  const forB = scoreMatch(b, a);
  return { score: Math.min(forA.score, forB.score), forA, forB };
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

export class CofounderError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'CofounderError';
  }
}

/** Bounded: a discovery page nobody scrolls past is still a page somebody paid
 *  to render. */
const DISCOVERY_LIMIT = 40;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').map((v) => v.slice(0, 80)).slice(0, 24) : [];

export interface CofounderProfileInput {
  headline: string;
  bio?: string | null;
  strength: string;
  seeking: string;
  brings?: unknown;
  needs?: unknown;
  commitment?: string;
  equityExpectation?: number | null;
  location?: string | null;
  remoteOk?: boolean;
  sectors?: unknown;
  stage?: string | null;
  visibility?: string;
  status?: string;
}

/** Create or replace the caller's own profile. One per (tenant, user) — the
 *  unique index says so, and a second profile would be a second person. */
export async function upsertCofounderProfile(
  db: Db,
  tenantId: number,
  userId: string,
  input: CofounderProfileInput,
): Promise<{ id: number }> {
  const headline = input.headline.trim().slice(0, 200);
  if (!headline) throw new CofounderError('A profile needs a headline — it is the only thing most people will read.', 400);
  if (!isCofounderStrength(input.strength)) throw new CofounderError(`strength must be one of: ${COFOUNDER_STRENGTHS.join(', ')}.`, 400);
  if (!isCofounderStrength(input.seeking)) throw new CofounderError(`seeking must be one of: ${COFOUNDER_STRENGTHS.join(', ')}.`, 400);
  const commitment = isCofounderCommitment(input.commitment) ? input.commitment : 'full-time';

  const equity = input.equityExpectation;
  if (equity != null && (!Number.isFinite(equity) || equity < 0 || equity > 100)) {
    throw new CofounderError('equityExpectation is a percentage between 0 and 100.', 400);
  }

  const values = {
    headline,
    bio: input.bio?.trim().slice(0, 4000) ?? null,
    strength: input.strength,
    seeking: input.seeking,
    brings: asStringArray(input.brings),
    needs: asStringArray(input.needs),
    commitment,
    equityExpectation: equity == null ? null : String(equity),
    location: input.location?.trim().slice(0, 120) ?? null,
    remoteOk: input.remoteOk !== false,
    sectors: asStringArray(input.sectors),
    stage: input.stage?.trim().slice(0, 24) ?? null,
    // Private unless the author says otherwise. A profile that became publicly
    // discoverable by default would publish somebody's intention to leave their
    // job, which is not a default anyone should have to opt out of.
    visibility: input.visibility === 'public' ? 'public' : 'private',
    status: ['open', 'paused', 'matched'].includes(String(input.status)) ? String(input.status) : 'open',
    updatedAt: new Date(),
  };

  const [row] = await db
    .insert(cofounderProfiles)
    .values({ tenantId, userId, ...values })
    .onConflictDoUpdate({ target: [cofounderProfiles.tenantId, cofounderProfiles.userId], set: values })
    .returning({ id: cofounderProfiles.id });
  if (!row) throw new CofounderError('The profile could not be saved.', 500);
  return row;
}

export async function myCofounderProfile(db: Db, tenantId: number, userId: string) {
  const [row] = await db
    .select()
    .from(cofounderProfiles)
    .where(scopedToTenant(cofounderProfiles, tenantId, eq(cofounderProfiles.userId, userId)))
    .limit(1);
  return row ?? null;
}

export interface DiscoveredMatch {
  profileId: number;
  headline: string;
  bio: string | null;
  strength: string;
  seeking: string;
  commitment: string;
  location: string | null;
  remoteOk: boolean;
  stage: string | null;
  brings: string[];
  score: number;
  reasons: MatchReason[];
  /** Set when an introduction already exists in either direction, so the surface
   *  shows its state instead of offering to ask twice. */
  introduction: { id: number; status: string; outbound: boolean } | null;
}

const toScorable = (row: {
  strength: string; seeking: string; brings: unknown; needs: unknown; commitment: string;
  equityExpectation: string | null; location: string | null; remoteOk: boolean; sectors: unknown; stage: string | null;
}): ScorableProfile => ({
  strength: row.strength,
  seeking: row.seeking,
  brings: asStringArray(row.brings),
  needs: asStringArray(row.needs),
  commitment: row.commitment,
  equityExpectation: row.equityExpectation == null ? null : Number(row.equityExpectation),
  location: row.location,
  remoteOk: row.remoteOk,
  sectors: asStringArray(row.sectors),
  stage: row.stage,
});

/**
 * Rank the public, open profiles against the caller's own.
 *
 * A DECLARED cross-tenant read, because the entire value is meeting somebody who
 * is NOT already in your workspace — a tenant-scoped co-founder search would
 * return your own colleagues. `visibility = 'public'` AND `status = 'open'` is
 * the access predicate, which is what `acrossTenants` refuses to let a caller
 * omit: dropping the tenant filter is allowed, dropping all access control is not.
 */
export async function discoverCofounders(
  db: Db,
  tenantId: number,
  userId: string,
): Promise<{ profile: unknown; matches: DiscoveredMatch[] }> {
  const mine = await myCofounderProfile(db, tenantId, userId);
  if (!mine) throw new CofounderError('Create your own profile first — matching needs something to match against.', 409);

  const candidates = await db
    .select({
      id: cofounderProfiles.id,
      headline: cofounderProfiles.headline,
      bio: cofounderProfiles.bio,
      strength: cofounderProfiles.strength,
      seeking: cofounderProfiles.seeking,
      brings: cofounderProfiles.brings,
      needs: cofounderProfiles.needs,
      commitment: cofounderProfiles.commitment,
      equityExpectation: cofounderProfiles.equityExpectation,
      location: cofounderProfiles.location,
      remoteOk: cofounderProfiles.remoteOk,
      sectors: cofounderProfiles.sectors,
      stage: cofounderProfiles.stage,
    })
    .from(cofounderProfiles)
    .where(acrossTenants(
      cofounderProfiles,
      'public_catalogue',
      eq(cofounderProfiles.visibility, 'public'),
      eq(cofounderProfiles.status, 'open'),
      ne(cofounderProfiles.id, mine.id),
    ))
    .orderBy(desc(cofounderProfiles.updatedAt))
    .limit(DISCOVERY_LIMIT * 4);

  // Read every introduction this profile is party to ONCE, rather than asking
  // per candidate — the N+1 the performance standard rejects outright.
  const existing = await db
    .select({
      id: cofounderIntroductions.id,
      fromProfileId: cofounderIntroductions.fromProfileId,
      toProfileId: cofounderIntroductions.toProfileId,
      status: cofounderIntroductions.status,
    })
    .from(cofounderIntroductions)
    .where(acrossTenants(
      cofounderIntroductions,
      'public_catalogue',
      or(eq(cofounderIntroductions.fromProfileId, mine.id), eq(cofounderIntroductions.toProfileId, mine.id)),
    ));

  const byOther = new Map(existing.map((row) => [
    row.fromProfileId === mine.id ? row.toProfileId : row.fromProfileId,
    { id: row.id, status: row.status, outbound: row.fromProfileId === mine.id },
  ]));

  const self = toScorable({ ...mine, remoteOk: mine.remoteOk });
  return {
    profile: mine,
    matches: candidates
      .map((row): DiscoveredMatch => {
        const { score, reasons } = scoreMatch(self, toScorable(row));
        return {
          profileId: row.id,
          headline: row.headline,
          bio: row.bio,
          strength: row.strength,
          seeking: row.seeking,
          commitment: row.commitment,
          location: row.location,
          remoteOk: row.remoteOk,
          stage: row.stage,
          brings: asStringArray(row.brings),
          score,
          reasons,
          introduction: byOther.get(row.id) ?? null,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, DISCOVERY_LIMIT),
  };
}

/** Ask to be introduced. One request per ordered pair — the unique index says so,
 *  which is what stops a rejected ask being re-sent as a new one. */
export async function requestIntroduction(
  db: Db,
  tenantId: number,
  userId: string,
  toProfileId: number,
  message: string,
): Promise<{ id: number }> {
  const mine = await myCofounderProfile(db, tenantId, userId);
  if (!mine) throw new CofounderError('Create your own profile before asking for an introduction.', 409);
  if (mine.id === toProfileId) throw new CofounderError('That is your own profile.', 400);

  const [target] = await db
    .select({ id: cofounderProfiles.id })
    .from(cofounderProfiles)
    .where(acrossTenants(
      cofounderProfiles,
      'public_catalogue',
      eq(cofounderProfiles.id, toProfileId),
      eq(cofounderProfiles.visibility, 'public'),
      eq(cofounderProfiles.status, 'open'),
    ))
    .limit(1);
  if (!target) throw new CofounderError('That profile is no longer open to introductions.', 404);

  const clean = message.trim().slice(0, 2000);
  if (!clean) throw new CofounderError('Say something. An introduction request with no message is a notification.', 400);

  const { score } = scoreMatch(toScorable({ ...mine, remoteOk: mine.remoteOk }), toScorable(await requireProfile(db, toProfileId)));

  const [row] = await db
    .insert(cofounderIntroductions)
    .values({ tenantId, fromProfileId: mine.id, toProfileId, message: clean, scoreAtRequest: score })
    .onConflictDoNothing({ target: [cofounderIntroductions.fromProfileId, cofounderIntroductions.toProfileId] })
    .returning({ id: cofounderIntroductions.id });
  if (!row) throw new CofounderError('You have already asked for an introduction to this person.', 409);
  return row;
}

/** Answer one. Only the RECIPIENT may accept or decline — enforced by matching
 *  the introduction's `to_profile_id` against the caller's own profile, not by
 *  trusting a body field. */
export async function respondToIntroduction(
  db: Db,
  tenantId: number,
  userId: string,
  introductionId: number,
  decision: 'accepted' | 'declined',
): Promise<void> {
  const mine = await myCofounderProfile(db, tenantId, userId);
  if (!mine) throw new CofounderError('You have no co-founder profile.', 404);

  const [row] = await db
    .update(cofounderIntroductions)
    .set({ status: decision, respondedAt: new Date(), updatedAt: new Date() })
    // NOT tenant-scoped to the RESPONDER's tenant, deliberately: the row belongs
    // to the tenant that ASKED, and matching on `toProfileId` is the stronger
    // predicate — it is the caller's own profile id, resolved from their session
    // one line above. A tenant filter here would silently make every
    // cross-workspace introduction unanswerable, which is every real one.
    .where(acrossTenants(
      cofounderIntroductions,
      'public_catalogue',
      eq(cofounderIntroductions.id, introductionId),
      eq(cofounderIntroductions.toProfileId, mine.id),
      eq(cofounderIntroductions.status, 'requested'),
    ))
    .returning({ id: cofounderIntroductions.id });
  if (!row) throw new CofounderError('No open introduction request addressed to you with that id.', 404);
}

async function requireProfile(db: Db, profileId: number) {
  const [row] = await db
    .select({
      strength: cofounderProfiles.strength,
      seeking: cofounderProfiles.seeking,
      brings: cofounderProfiles.brings,
      needs: cofounderProfiles.needs,
      commitment: cofounderProfiles.commitment,
      equityExpectation: cofounderProfiles.equityExpectation,
      location: cofounderProfiles.location,
      remoteOk: cofounderProfiles.remoteOk,
      sectors: cofounderProfiles.sectors,
      stage: cofounderProfiles.stage,
    })
    .from(cofounderProfiles)
    .where(acrossTenants(cofounderProfiles, 'public_catalogue', eq(cofounderProfiles.id, profileId)))
    .limit(1);
  if (!row) throw new CofounderError('That profile no longer exists.', 404);
  return row;
}
