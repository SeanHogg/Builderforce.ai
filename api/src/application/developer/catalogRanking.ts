/**
 * Directory RANKING — one function, four signals, and the arithmetic written down.
 *
 * ── WHY THIS IS A FUNCTION AND NOT AN `ORDER BY` ────────────────────────────
 * `listPublicCatalog` orders by `install_count DESC`. That is not a ranking, it
 * is a leaderboard, and a leaderboard has one property that kills a young
 * marketplace: it is self-reinforcing. The listing at the top is installed
 * because it is at the top, and a package published this week — reviewed, sound,
 * better — cannot climb past it, because the only signal in the sort is the one
 * it has not had time to accumulate. PRD 24 §2.5 makes the same argument about
 * rev-share: the scarce resource in year one is LISTINGS, not margin. A directory
 * that only rewards incumbency does not produce listings.
 *
 * An `ORDER BY` also cannot be read, cannot be tested and cannot be argued with.
 * The moment a publisher asks "why am I below them?", the honest answer has to be
 * a formula somebody can look at. This is that formula.
 *
 * ── THE FOUR SIGNALS ────────────────────────────────────────────────────────
 *
 *   popularity — installs, on a LOG curve saturating at {@link POPULARITY_SATURATION}.
 *     Log rather than linear because the interesting distinction is 0 → 10
 *     installs (nobody uses this / some people do), not 900 → 1000. Above the
 *     saturation point extra installs buy nothing, which is precisely what stops
 *     the leaderboard from freezing.
 *
 *   freshness — exponential decay on the age of the head version's REVIEW, with a
 *     {@link FRESHNESS_HALF_LIFE_DAYS} half-life. The date that counts is when a
 *     version passed review and was published, not when the package row was
 *     touched: an edit to a tagline is not evidence that the integration still
 *     works, and a package whose last reviewed version is fourteen months old is
 *     a package whose vendor may have stopped answering.
 *
 *   assurance — how much of the review pipeline actually ran, and how it came out.
 *     A package the dynamic and agentic stages both exercised is a stronger claim
 *     than one only the static parser looked at, and the directory should say so.
 *     This is the signal the MCP registries do not have and the reason PRD 24 §2.6
 *     calls trust our differentiated position rather than a me-too one.
 *
 *   relevance — text match, supplied by the query layer as a normalized 0..1.
 *     Only present when somebody typed something, and DOMINANT when they did:
 *     a person searching "invoice" is asking for invoices, not for whatever is
 *     most popular this month.
 *
 * ── THE COMBINATION ─────────────────────────────────────────────────────────
 * Two weightings, because browsing and searching are different questions:
 *
 *   BROWSE  = 0.50·popularity + 0.30·freshness + 0.20·assurance
 *   SEARCH  = 0.60·relevance  + 0.15·popularity + 0.10·freshness + 0.15·assurance
 *
 * Each weight set sums to 1, so a score is always in [0, 1] and two scores are
 * comparable. Pure and synchronous: no database, no clock of its own — `now` is
 * passed in, which is what makes the decay testable rather than something that
 * quietly changes answer between two runs of the same test.
 */

/** Installs beyond this buy no further popularity. Ten workspaces is already the
 *  signal "real people run this"; the thousandth adds nothing a buyer needs. */
export const POPULARITY_SATURATION = 100;

/** A reviewed version is worth half as much after this long. Ninety days is the
 *  span over which an unmaintained integration typically starts breaking against
 *  an upstream API, so it is the interval the decay is tuned to. */
export const FRESHNESS_HALF_LIFE_DAYS = 90;

const DAY_MS = 86_400_000;

/** The one place the browse/search weightings are written. */
export const RANK_WEIGHTS = {
  browse: { popularity: 0.5, freshness: 0.3, assurance: 0.2, relevance: 0 },
  search: { popularity: 0.15, freshness: 0.1, assurance: 0.15, relevance: 0.6 },
} as const;

/**
 * How far a submission got through the review pipeline, worst-first.
 *
 * Ordered deliberately: a caller asks "at least this?" rather than enumerating,
 * and the ORDER is the claim being made — `exercised` is a stronger statement
 * than `parsed`, which is a stronger statement than `unreviewed`.
 */
export const ASSURANCE_TIERS = ['unreviewed', 'parsed', 'flagged', 'exercised'] as const;
export type AssuranceTier = (typeof ASSURANCE_TIERS)[number];

/** What each tier is worth. Written as a total map so a new tier cannot compile
 *  without a value — a tier with no score would silently rank as zero. */
const ASSURANCE_SCORE: Record<AssuranceTier, number> = {
  /** Not approved, or approved by a pipeline whose record is missing. */
  unreviewed: 0,
  /** The static stage passed and nothing else ran — the spec is well-formed, and
   *  that is the entire claim. */
  parsed: 0.4,
  /** Every stage that ran passed, but at least one raised a warning. */
  flagged: 0.7,
  /** The dynamic stage genuinely exercised it and the agentic stage cleared it. */
  exercised: 1,
};

export interface ListingSignals {
  /** Distinct workspaces that have installed this package. */
  installs: number;
  /** When the head version passed review and was published. Null = never. */
  reviewedAt: Date | string | null;
  assurance: AssuranceTier;
  /** 0..1 text match. Ignored under the browse weighting. */
  relevance?: number;
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** Installs → 0..1, log-saturating. `log1p` so zero installs is exactly zero. */
export function popularityScore(installs: number): number {
  if (!Number.isFinite(installs) || installs <= 0) return 0;
  return clamp01(Math.log1p(installs) / Math.log1p(POPULARITY_SATURATION));
}

/**
 * Age of the last reviewed version → 0..1, halving every
 * {@link FRESHNESS_HALF_LIFE_DAYS}.
 *
 * A package that has never had a reviewed version scores 0 rather than 1: never
 * reviewed is not "reviewed just now", and treating a missing date as fresh is
 * the one direction this can be wrong that puts an unproven listing on top.
 */
export function freshnessScore(reviewedAt: Date | string | null, now: Date): number {
  if (!reviewedAt) return 0;
  const then = reviewedAt instanceof Date ? reviewedAt.getTime() : Date.parse(String(reviewedAt));
  if (!Number.isFinite(then)) return 0;
  // A future timestamp is a clock skew, not a bonus — clamp the age at zero.
  const days = Math.max(0, (now.getTime() - then) / DAY_MS);
  return clamp01(Math.pow(0.5, days / FRESHNESS_HALF_LIFE_DAYS));
}

export function assuranceScore(tier: AssuranceTier): number {
  return ASSURANCE_SCORE[tier] ?? 0;
}

/**
 * THE ranking function. One score in [0, 1] for one listing.
 *
 * `mode` is not a preference — it says which QUESTION the reader asked. Browsing
 * asks "what should I look at?"; searching asks "which of these is the thing I
 * named?". Answering the second with the first's weighting is how a directory
 * returns the most popular package for a query it does not match.
 */
export function rankListing(
  signals: ListingSignals,
  mode: 'browse' | 'search',
  now: Date = new Date(),
): number {
  const w = RANK_WEIGHTS[mode];
  return clamp01(
    w.popularity * popularityScore(signals.installs) +
    w.freshness * freshnessScore(signals.reviewedAt, now) +
    w.assurance * assuranceScore(signals.assurance) +
    w.relevance * clamp01(signals.relevance ?? 0),
  );
}

/**
 * Rank many listings and return them ordered, best first.
 *
 * Ties break on install count and then on the stable key, so the order is TOTAL:
 * a directory whose second page depends on the planner's row order shows the same
 * listing twice and hides another one entirely.
 */
export function rankListings<T extends { key: string; signals: ListingSignals }>(
  rows: readonly T[],
  mode: 'browse' | 'search',
  now: Date = new Date(),
): Array<T & { score: number }> {
  return rows
    .map((row) => ({ ...row, score: rankListing(row.signals, mode, now) }))
    .sort((a, b) =>
      b.score - a.score ||
      b.signals.installs - a.signals.installs ||
      a.key.localeCompare(b.key));
}

/**
 * The assurance tier a version's stored review record earns.
 *
 * Kept here, beside the score it feeds, rather than in the pipeline: the pipeline
 * decides whether a submission is APPROVED, which is a safety question, and this
 * decides how loudly the directory recommends it, which is an editorial one. They
 * move for different reasons and a package can legitimately be approved and
 * poorly-recommended — that is exactly what `parsed` means.
 */
export function assuranceFor(input: {
  approved: boolean;
  /** Verdicts of the stages that were actually recorded, by stage key. */
  stageVerdicts: Readonly<Record<string, string>>;
}): AssuranceTier {
  if (!input.approved) return 'unreviewed';
  const verdicts = Object.values(input.stageVerdicts);
  if (verdicts.length === 0) return 'unreviewed';
  const ran = (stage: string): boolean => {
    const v = input.stageVerdicts[stage];
    return v === 'pass' || v === 'warn';
  };
  const anyWarn = verdicts.includes('warn');
  // `exercised` requires that something actually WENT AND LOOKED. A skipped
  // dynamic stage is not a pass; it is the absence of the evidence this tier
  // claims to have, and claiming it anyway is the failure the whole stage record
  // exists to prevent.
  if (ran('dynamic') && ran('agentic')) return anyWarn ? 'flagged' : 'exercised';
  if (anyWarn) return 'flagged';
  return 'parsed';
}
