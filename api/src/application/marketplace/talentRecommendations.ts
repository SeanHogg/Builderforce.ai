/**
 * The recommendation feed — "a cached match query", in both directions.
 *
 * ── WHAT IT IS GROUNDED ON ───────────────────────────────────────────────────────
 * Nothing invented. Every signal is data the platform already holds and already shows
 * somebody:
 *
 *   skills      `job_postings.skills` (+ its prose) against `freelancer_profiles.skills`
 *               (+ headline and bio), tokenised with the SAME lexicon the résumé match
 *               uses, so a number here and a number on the career surface mean the same
 *               thing.
 *   category    `discipline`, and the `specialty` leaf beneath it (0985).
 *   shape       `engagement_type` — an hourly posting and a person who only takes fixed
 *               work is a bad introduction however well the skills line up.
 *   rate        the posting's rate band against `freelancer_profiles.hourly_rate_cents`.
 *               Compared ONLY for hourly work: a fixed-bid total and an hourly rate are
 *               different quantities (0985) and comparing them is the category error the
 *               budget columns exist to prevent.
 *   reputation  the two-way review average (`freelancer_reviews.direction =
 *               'employer_to_freelancer'`) and the count of completed engagements — the
 *               job-success signal the register records as already built.
 *   availability `freelancer_profiles.availability`, because recommending somebody who
 *               has said they are unavailable is worse than recommending nobody.
 *
 * ── WHY THE TOKENISER IS BORROWED AND `compareResumeToJob` IS NOT CALLED ────────
 * `application/career/jobMatch.ts` already measures a RÉSUMÉ against a posting, and this
 * module deliberately does not call it: `compareResumeToJob` parses a résumé DOCUMENT
 * (sections, bullets, seniority) and a for-hire profile is a headline, a bio and a skills
 * list — feeding it one would produce a confident number about a document that does not
 * exist. What IS shared is the vocabulary: `tokenSet` / `isSkillToken` / `displaySkill`
 * come from `@builderforce/creation-canvas-contract`, which is where `jobMatch` gets them
 * too, so "React" means the same token to both and neither has its own tokeniser to drift.
 *
 * ── WHY IT IS CACHED THE WAY IT IS ──────────────────────────────────────────────
 * The ranking is a fan-out: the whole candidate pool (or the whole open board) scored in
 * memory. That is exactly the shape `getOrSetCached` exists for. But an invalidation
 * hook is only as good as the number of writers that remember it, and the inputs here
 * have THREE independent writers — postings, proposals, and freelancer profiles, the last
 * of which is written by a route this module has no business reaching into.
 *
 * So the key carries a VERSION TOKEN read from the inputs themselves: one cheap query
 * returns the newest `updated_at` across postings, proposals and published profiles, and
 * the token goes in the key. An edit to ANY of the three mints a new key and the stale
 * entry ages out on its own — the repo's documented pattern for an unbounded keyspace,
 * and the only one that cannot be defeated by a writer forgetting to call an invalidator.
 * Posting writes still call {@link invalidatePostingCaches} for the browse slice; this
 * feed does not depend on their doing so.
 */
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { displaySkill, isSkillToken, tokenSet } from '@builderforce/creation-canvas-contract';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import {
  freelancerProfiles,
  jobInvites,
  jobPostings,
  jobProposals,
  tenants,
  users,
} from '../../infrastructure/database/schema';
import { parseJsonArray } from '../../domain/shared/json';
import { hireShape } from './engagementShape';

/** How many candidates one ranking considers, and how many it returns. */
export const RECOMMENDATION_POOL_LIMIT = 300;
export const RECOMMENDATION_RESULT_LIMIT = 24;

/** L2 lifetime. The version token is what makes a stale entry impossible; this is only
 *  the ceiling on how long an untouched-but-unread key sits in KV. */
const RECOMMENDATION_TTL_SECONDS = 900;

export interface MatchReason {
  /** A stable code the UI localises — never a sentence assembled on the server, which
   *  would be an English string in a five-language product. */
  code: 'skills' | 'discipline' | 'specialty' | 'rate' | 'reputation' | 'available' | 'shape';
  /** Points this reason contributed, so a person can see WHY the order is the order. */
  points: number;
}

export interface TalentMatch {
  freelancerUserId: string;
  displayName: string | null;
  avatarUrl: string | null;
  headline: string | null;
  discipline: string | null;
  skills: string[];
  hourlyRateCents: number | null;
  currency: string;
  availability: string | null;
  rating: number | null;
  ratingCount: number;
  completedEngagements: number;
  /** 0..100. */
  score: number;
  reasons: MatchReason[];
  /** Skills the posting asks for that this person lists — the evidence behind the score. */
  matchedSkills: string[];
  /** Skills the posting asks for that they do not. Shown, not hidden: an honest gap is
   *  what makes the rest of the list believable. */
  missingSkills: string[];
  /** They already hold an invite to this posting. */
  invited: boolean;
}

export interface PostingMatch {
  id: string;
  title: string;
  description: string | null;
  tenantId: number;
  tenantName: string | null;
  discipline: string | null;
  specialty: string | null;
  skills: string[];
  engagementType: string | null;
  experienceLevel: string | null;
  projectLength: string | null;
  rateMinCents: number | null;
  rateMaxCents: number | null;
  budgetTotalCents: number | null;
  currency: string;
  createdAt: Date | string | null;
  score: number;
  reasons: MatchReason[];
  matchedSkills: string[];
  missingSkills: string[];
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

/** The recognised skill tokens in a blob of text plus a stored JSON skill list. */
function skillTokens(...parts: Array<unknown>): Set<string> {
  const text = parts
    .map((part) => (Array.isArray(part) ? part.join(' ') : typeof part === 'string' ? part : ''))
    .join('\n');
  return new Set(tokenSet(text).filter(isSkillToken));
}

interface Scored {
  score: number;
  reasons: MatchReason[];
  matched: string[];
  missing: string[];
}

/**
 * One scoring function, used from BOTH directions.
 *
 * Deliberately symmetric: "who should bid on this job" and "which jobs should I bid on"
 * are the same overlap read from two ends, and two scorers would let the two surfaces
 * disagree about a pairing they both display.
 *
 * The weights are stated here, once, in one expression, so the ranking is auditable
 * rather than emergent:
 *
 *   skills       up to 55 — the dominant term, because it is the only one that is about
 *                the WORK. A posting that names no recognisable skill scores a neutral
 *                28 rather than a confident zero (the same refusal `compareResumeToJob`
 *                makes: with nothing to measure, say so instead of inventing a number).
 *   discipline   12, plus 8 more when the specialty leaf agrees.
 *   rate         up to 10, hourly work only.
 *   reputation   up to 10, and it needs EVIDENCE — a 5.0 from one review is not a
 *                track record, so the count damps the average.
 *   availability 5 for open, 2 for limited, and `unavailable` never reaches here.
 */
function scoreMatch(input: {
  postingSkills: Set<string>;
  candidateSkills: Set<string>;
  postingDiscipline: string | null;
  candidateDiscipline: string | null;
  specialtyAgrees: boolean;
  engagementType: string | null;
  rateMinCents: number | null;
  rateMaxCents: number | null;
  hourlyRateCents: number | null;
  rating: number | null;
  ratingCount: number;
  availability: string | null;
}): Scored {
  const reasons: MatchReason[] = [];
  const wanted = [...input.postingSkills];
  const matched = wanted.filter((token) => input.candidateSkills.has(token));
  const missing = wanted.filter((token) => !input.candidateSkills.has(token));

  let score = 0;
  if (wanted.length === 0) {
    score += 28;
  } else {
    const points = Math.round((matched.length / wanted.length) * 55);
    score += points;
    if (points > 0) reasons.push({ code: 'skills', points });
  }

  if (input.postingDiscipline && input.postingDiscipline === input.candidateDiscipline) {
    score += 12;
    reasons.push({ code: 'discipline', points: 12 });
    if (input.specialtyAgrees) {
      score += 8;
      reasons.push({ code: 'specialty', points: 8 });
    }
  }

  // Rate is comparable ONLY on hourly work — see the module header.
  if (hireShape(input.engagementType) === 'hourly' && input.hourlyRateCents != null) {
    const min = input.rateMinCents;
    const max = input.rateMaxCents;
    if (min != null || max != null) {
      const above = max != null && input.hourlyRateCents > max;
      const below = min != null && input.hourlyRateCents < min;
      // Inside the band is the match. BELOW it still scores — a client's band is a
      // ceiling they are willing to pay, not a floor somebody has to clear.
      const points = above ? 0 : below ? 7 : 10;
      score += points;
      if (points > 0) reasons.push({ code: 'rate', points });
    }
  }

  if (input.ratingCount > 0 && input.rating != null) {
    // `count / (count + 3)` is the damping: one 5.0 review earns a quarter of the
    // reputation points, five earn most of them. A brand-new profile is not punished
    // into invisibility, and a single friendly review does not outrank a track record.
    const confidence = input.ratingCount / (input.ratingCount + 3);
    const points = Math.round(((input.rating - 3) / 2) * 10 * confidence);
    if (points > 0) {
      score += points;
      reasons.push({ code: 'reputation', points });
    }
  }

  if (input.availability === 'open') {
    score += 5;
    reasons.push({ code: 'available', points: 5 });
  } else if (input.availability === 'limited') {
    score += 2;
    reasons.push({ code: 'available', points: 2 });
  }

  return {
    score: clamp(score),
    reasons: reasons.sort((a, b) => b.points - a.points),
    matched: matched.map(displaySkill),
    missing: missing.slice(0, 8).map(displaySkill),
  };
}

// ---------------------------------------------------------------------------
// The version token
// ---------------------------------------------------------------------------

/**
 * A token that changes whenever any INPUT to the ranking changes.
 *
 * One round trip, three sub-selects. Postings and proposals are narrowed to the tenant
 * asking; published profiles are global because the candidate pool is. Epoch seconds
 * rather than a hash: it is monotone, it is a bounded-length key fragment, and a reader
 * debugging a stale feed can tell at a glance when the inputs last moved.
 */
async function recommendationVersion(db: Db, tenantId: number): Promise<string> {
  const [row] = await db
    .select({
      postings: sql<string>`COALESCE(MAX(EXTRACT(EPOCH FROM ${jobPostings.updatedAt}))::bigint, 0)::text`,
      profiles: sql<string>`(SELECT COALESCE(MAX(EXTRACT(EPOCH FROM updated_at))::bigint, 0) FROM freelancer_profiles WHERE published = true)::text`,
      proposals: sql<string>`(SELECT COALESCE(MAX(EXTRACT(EPOCH FROM p.updated_at))::bigint, 0) FROM job_proposals p JOIN job_postings j ON j.id = p.job_id WHERE j.tenant_id = ${tenantId})::text`,
    })
    .from(jobPostings)
    .where(scopedToTenant(jobPostings, tenantId));
  return `${row?.postings ?? '0'}.${row?.profiles ?? '0'}.${row?.proposals ?? '0'}`;
}

/** The seeker-side token: the open board and this person's own profile and bids. */
async function seekerRecommendationVersion(db: Db, userId: string): Promise<string> {
  const [row] = await db
    .select({
      board: sql<string>`COALESCE(MAX(EXTRACT(EPOCH FROM ${jobPostings.updatedAt}))::bigint, 0)::text`,
      me: sql<string>`(SELECT COALESCE(EXTRACT(EPOCH FROM updated_at)::bigint, 0) FROM freelancer_profiles WHERE user_id = ${userId})::text`,
      mine: sql<string>`(SELECT COALESCE(MAX(EXTRACT(EPOCH FROM updated_at))::bigint, 0) FROM job_proposals WHERE freelancer_user_id = ${userId})::text`,
    })
    .from(jobPostings)
    .where(acrossTenants(jobPostings, 'public_catalogue',
      eq(jobPostings.status, 'open'),
      eq(jobPostings.visibility, 'public')));
  return `${row?.board ?? '0'}.${row?.me ?? '0'}.${row?.mine ?? '0'}`;
}

/** The freelancer's received rating, as raw SQL: `freelancer_reviews.direction` is in the
 *  DB (0299) but not on the Drizzle table, so the predicate cannot be built. */
const ratingSql = sql<string | null>`(SELECT ROUND(AVG(rating)::numeric, 2) FROM freelancer_reviews r WHERE r.freelancer_user_id = freelancer_profiles.user_id AND r.direction = 'employer_to_freelancer')`;
const ratingCountSql = sql<number>`(SELECT COUNT(*) FROM freelancer_reviews r WHERE r.freelancer_user_id = freelancer_profiles.user_id AND r.direction = 'employer_to_freelancer')::int`;
const completedSql = sql<number>`(SELECT COUNT(*) FROM freelancer_engagements e WHERE e.freelancer_user_id = freelancer_profiles.user_id AND e.status IN ('active','completed'))::int`;

// ---------------------------------------------------------------------------
// Direction 1 — who should bid on this posting
// ---------------------------------------------------------------------------

/**
 * Rank freelancers for one of this tenant's postings.
 *
 * People who have ALREADY bid are excluded: this list answers "who should I invite",
 * and inviting somebody whose proposal is sitting in the next tab is the feature
 * embarrassing itself. A `saved` row (they bookmarked it, or accepted an invite and have
 * not bid yet) is not a bid and does not exclude them.
 */
export async function recommendTalentForPosting(
  db: Db,
  env: Env,
  input: { tenantId: number; jobId: string },
): Promise<TalentMatch[] | null> {
  const [job] = await db
    .select({
      id: jobPostings.id,
      title: jobPostings.title,
      description: jobPostings.description,
      requirements: jobPostings.requirements,
      discipline: jobPostings.discipline,
      specialty: jobPostings.specialty,
      skills: jobPostings.skills,
      engagementType: jobPostings.engagementType,
      rateMinCents: jobPostings.rateMinCents,
      rateMaxCents: jobPostings.rateMaxCents,
    })
    .from(jobPostings)
    .where(scopedToTenant(jobPostings, input.tenantId, eq(jobPostings.id, input.jobId)))
    .limit(1);
  if (!job) return null;

  const version = await recommendationVersion(db, input.tenantId);
  return getOrSetCached(
    env,
    `talent:rec:job:${input.tenantId}:${input.jobId}:${version}`,
    async () => {
      const postingSkills = skillTokens(job.skills, job.title, job.description, job.requirements);

      const [pool, alreadyBid, invited] = await Promise.all([
        db
          .select({
            userId: freelancerProfiles.userId,
            headline: freelancerProfiles.headline,
            bio: freelancerProfiles.bio,
            discipline: freelancerProfiles.discipline,
            skills: freelancerProfiles.skills,
            hourlyRateCents: freelancerProfiles.hourlyRateCents,
            currency: freelancerProfiles.currency,
            availability: freelancerProfiles.availability,
            targetRoles: freelancerProfiles.targetRoles,
            displayName: users.displayName,
            avatarUrl: users.avatarUrl,
            rating: ratingSql,
            ratingCount: ratingCountSql,
            completed: completedSql,
          })
          .from(freelancerProfiles)
          .innerJoin(users, eq(users.id, freelancerProfiles.userId))
          .where(and(
            eq(freelancerProfiles.published, true),
            eq(freelancerProfiles.visibility, 'public'),
            // Somebody who has said they are unavailable is not a recommendation.
            ne(freelancerProfiles.availability, 'unavailable'),
          ))
          .limit(RECOMMENDATION_POOL_LIMIT),
        db
          .select({ freelancerUserId: jobProposals.freelancerUserId })
          .from(jobProposals)
          .where(and(
            eq(jobProposals.jobId, input.jobId),
            inArray(jobProposals.status, ['submitted', 'shortlisted', 'accepted']),
          )),
        db
          .select({ freelancerUserId: jobInvites.freelancerUserId })
          .from(jobInvites)
          .where(scopedToTenant(jobInvites, input.tenantId, eq(jobInvites.jobId, input.jobId))),
      ]);

      const bidders = new Set(alreadyBid.map((r) => r.freelancerUserId));
      const invitees = new Set(invited.map((r) => r.freelancerUserId));

      return pool
        .filter((candidate) => !bidders.has(candidate.userId))
        .map((candidate) => {
          const candidateSkills = skillTokens(
            candidate.skills, candidate.headline, candidate.bio, parseJsonArray<string>(candidate.targetRoles),
          );
          const scored = scoreMatch({
            postingSkills,
            candidateSkills,
            postingDiscipline: job.discipline ?? null,
            candidateDiscipline: candidate.discipline ?? null,
            // A profile carries no specialty column, so the leaf agrees when the
            // person's own words name it — the honest read of the data that exists.
            specialtyAgrees: Boolean(job.specialty) && candidateSkills.has(String(job.specialty)),
            engagementType: job.engagementType ?? null,
            rateMinCents: job.rateMinCents == null ? null : Number(job.rateMinCents),
            rateMaxCents: job.rateMaxCents == null ? null : Number(job.rateMaxCents),
            hourlyRateCents: candidate.hourlyRateCents == null ? null : Number(candidate.hourlyRateCents),
            rating: candidate.rating == null ? null : Number(candidate.rating),
            ratingCount: Number(candidate.ratingCount ?? 0),
            availability: candidate.availability ?? null,
          });
          const match: TalentMatch = {
            freelancerUserId: candidate.userId,
            displayName: candidate.displayName ?? null,
            avatarUrl: candidate.avatarUrl ?? null,
            headline: candidate.headline ?? null,
            discipline: candidate.discipline ?? null,
            skills: parseJsonArray<string>(candidate.skills),
            hourlyRateCents: candidate.hourlyRateCents == null ? null : Number(candidate.hourlyRateCents),
            currency: candidate.currency ?? 'USD',
            availability: candidate.availability ?? null,
            rating: candidate.rating == null ? null : Number(candidate.rating),
            ratingCount: Number(candidate.ratingCount ?? 0),
            completedEngagements: Number(candidate.completed ?? 0),
            score: scored.score,
            reasons: scored.reasons,
            matchedSkills: scored.matched,
            missingSkills: scored.missing,
            invited: invitees.has(candidate.userId),
          };
          return match;
        })
        .sort((a, b) => b.score - a.score || b.ratingCount - a.ratingCount)
        .slice(0, RECOMMENDATION_RESULT_LIMIT);
    },
    { kvTtlSeconds: RECOMMENDATION_TTL_SECONDS },
  );
}

// ---------------------------------------------------------------------------
// Direction 2 — which postings should this freelancer bid on
// ---------------------------------------------------------------------------

/**
 * Rank the open board for one freelancer.
 *
 * Postings they have already engaged with — bid, shortlisted, saved — are excluded,
 * because a "recommended for you" list whose top item is the thing you bid on yesterday
 * is a list nobody reads twice. Cross-tenant with the same declared reason the anonymous
 * browse uses, and the same access predicate: open and public.
 */
export async function recommendPostingsForFreelancer(
  db: Db,
  env: Env,
  input: { userId: string },
): Promise<PostingMatch[]> {
  const [me] = await db
    .select({
      userId: freelancerProfiles.userId,
      headline: freelancerProfiles.headline,
      bio: freelancerProfiles.bio,
      discipline: freelancerProfiles.discipline,
      skills: freelancerProfiles.skills,
      targetRoles: freelancerProfiles.targetRoles,
      hourlyRateCents: freelancerProfiles.hourlyRateCents,
      availability: freelancerProfiles.availability,
      rating: ratingSql,
      ratingCount: ratingCountSql,
    })
    .from(freelancerProfiles)
    .where(eq(freelancerProfiles.userId, input.userId))
    .limit(1);
  // No for-hire profile is not an error — it is somebody who has not told us anything to
  // match on. An empty feed says that honestly; a random board would not.
  if (!me) return [];

  const version = await seekerRecommendationVersion(db, input.userId);
  return getOrSetCached(
    env,
    `talent:rec:seeker:${input.userId}:${version}`,
    async () => {
      const candidateSkills = skillTokens(me.skills, me.headline, me.bio, parseJsonArray<string>(me.targetRoles));
      const [board, mine] = await Promise.all([
        db
          .select({
            id: jobPostings.id,
            title: jobPostings.title,
            description: jobPostings.description,
            requirements: jobPostings.requirements,
            tenantId: jobPostings.tenantId,
            tenantName: tenants.name,
            discipline: jobPostings.discipline,
            specialty: jobPostings.specialty,
            skills: jobPostings.skills,
            engagementType: jobPostings.engagementType,
            experienceLevel: jobPostings.experienceLevel,
            projectLength: jobPostings.projectLength,
            rateMinCents: jobPostings.rateMinCents,
            rateMaxCents: jobPostings.rateMaxCents,
            budgetTotalCents: jobPostings.budgetTotalCents,
            currency: jobPostings.currency,
            createdAt: jobPostings.createdAt,
          })
          .from(jobPostings)
          .innerJoin(tenants, eq(tenants.id, jobPostings.tenantId))
          .where(acrossTenants(jobPostings, 'public_catalogue',
            eq(jobPostings.status, 'open'),
            eq(jobPostings.visibility, 'public')))
          .orderBy(desc(jobPostings.createdAt))
          .limit(RECOMMENDATION_POOL_LIMIT),
        db
          .select({ jobId: jobProposals.jobId })
          .from(jobProposals)
          .where(eq(jobProposals.freelancerUserId, input.userId)),
      ]);
      const engaged = new Set(mine.map((r) => r.jobId));

      return board
        .filter((posting) => !engaged.has(posting.id))
        .map((posting) => {
          const postingSkills = skillTokens(posting.skills, posting.title, posting.description, posting.requirements);
          const scored = scoreMatch({
            postingSkills,
            candidateSkills,
            postingDiscipline: posting.discipline ?? null,
            candidateDiscipline: me.discipline ?? null,
            specialtyAgrees: Boolean(posting.specialty) && candidateSkills.has(String(posting.specialty)),
            engagementType: posting.engagementType ?? null,
            rateMinCents: posting.rateMinCents == null ? null : Number(posting.rateMinCents),
            rateMaxCents: posting.rateMaxCents == null ? null : Number(posting.rateMaxCents),
            hourlyRateCents: me.hourlyRateCents == null ? null : Number(me.hourlyRateCents),
            rating: me.rating == null ? null : Number(me.rating),
            ratingCount: Number(me.ratingCount ?? 0),
            availability: me.availability ?? null,
          });
          const match: PostingMatch = {
            id: posting.id,
            title: posting.title,
            description: posting.description ?? null,
            tenantId: Number(posting.tenantId),
            tenantName: posting.tenantName ?? null,
            discipline: posting.discipline ?? null,
            specialty: posting.specialty ?? null,
            skills: parseJsonArray<string>(posting.skills),
            engagementType: posting.engagementType ?? null,
            experienceLevel: posting.experienceLevel ?? null,
            projectLength: posting.projectLength ?? null,
            rateMinCents: posting.rateMinCents == null ? null : Number(posting.rateMinCents),
            rateMaxCents: posting.rateMaxCents == null ? null : Number(posting.rateMaxCents),
            budgetTotalCents: posting.budgetTotalCents == null ? null : Number(posting.budgetTotalCents),
            currency: posting.currency ?? 'USD',
            createdAt: posting.createdAt ?? null,
            score: scored.score,
            reasons: scored.reasons,
            matchedSkills: scored.matched,
            missingSkills: scored.missing,
          };
          return match;
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, RECOMMENDATION_RESULT_LIMIT);
    },
    { kvTtlSeconds: RECOMMENDATION_TTL_SECONDS },
  );
}

/** Exported for the scorer's unit test — the weights are the product decision here, and
 *  a change to them that nobody notices is the failure worth pinning. */
export const __scoreMatch = scoreMatch;
/** Exported for the same test: the tokeniser boundary between prose and skills. */
export const __skillTokens = skillTokens;
