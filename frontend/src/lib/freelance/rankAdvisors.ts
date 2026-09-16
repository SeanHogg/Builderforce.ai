/**
 * A0 ranked Talent discovery for founders seeking mentorship.
 *
 * Advisors are Talent `person` listings with a bound `booking_services` row
 * (`bookable`). There is no `advisor` listing kind and no `/advisors` route.
 * `?category=advisors` is a talent filter (same family as `?family=talent`).
 *
 * Free (price 0) is a valid rank signal — never a reason to drop a listing.
 */
export type RankableTalent = {
  userId: string;
  bookable?: boolean;
  hourlyRateCents?: number | null;
  skills?: string[];
  headline?: string | null;
  bio?: string | null;
  rating?: number;
};

export type FounderRankContext = {
  seeking?: string | null;
  businessStage?: string | null;
};

const STAGE_TOKENS: Record<string, readonly string[]> = {
  idea: ['idea', 'pre-seed', 'preseed', 'ideation'],
  mvp: ['mvp', 'prototype', 'launch', 'product-market'],
  early_revenue: ['early_revenue', 'early-revenue', 'revenue', 'traction'],
  growth: ['growth', 'scale-up', 'scaleup'],
  scale: ['scale', 'enterprise'],
};

const MENTORSHIP_TOKENS = ['mentor', 'mentorship', 'advisor', 'advisors', 'coach'] as const;

/** `category=advisors` is a talent filter, not a marketplace family or route. */
export function isTalentFamilyParam(familyOrCategory: string | null | undefined): boolean {
  const v = (familyOrCategory ?? '').trim().toLowerCase();
  return v === 'talent' || v === 'advisors';
}

export function isAdvisorsTalentFilter(familyOrCategory: string | null | undefined): boolean {
  return (familyOrCategory ?? '').trim().toLowerCase() === 'advisors';
}

export function founderSeeksMentorship(seeking: string | null | undefined): boolean {
  const v = (seeking ?? '').toLowerCase();
  return v.includes('mentorship') || v.includes('advisor');
}

function haystack(row: RankableTalent): string {
  return `${row.headline ?? ''} ${row.bio ?? ''} ${(row.skills ?? []).join(' ')}`.toLowerCase();
}

function scoreTalent(row: RankableTalent, ctx: FounderRankContext): number {
  let score = 0;
  if (row.bookable) score += 100;
  // Free 1:1 (price 0) ranks with paid — never filtered out.
  if (row.bookable && row.hourlyRateCents === 0) score += 20;
  const seekingMentorship = founderSeeksMentorship(ctx.seeking);
  if (seekingMentorship && row.bookable) score += 30;
  const stage = (ctx.businessStage ?? '').trim().toLowerCase();
  const stageTokens = STAGE_TOKENS[stage] ?? (stage ? [stage] : []);
  const hay = haystack(row);
  if (stageTokens.some((token) => hay.includes(token))) score += 40;
  if (seekingMentorship && MENTORSHIP_TOKENS.some((token) => hay.includes(token))) score += 25;
  score += Math.min(Math.max(row.rating ?? 0, 0), 5);
  return score;
}

/**
 * Stable rank: bookable + stage/seeking fit first, Free (0) kept in the set.
 * Does not drop any listing — callers that want "advisors only" filter `bookable`
 * themselves (category=advisors).
 */
export function rankTalentForFounder<T extends RankableTalent>(
  listings: readonly T[],
  ctx: FounderRankContext = {},
): T[] {
  return listings
    .map((row, index) => ({ row, index, score: scoreTalent(row, ctx) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.row);
}
