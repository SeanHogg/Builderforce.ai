/**
 * Compensation — the band model and the offer comparison.
 *
 * ── WHY A DECLARED MODEL AND NOT A "MARKET DATA" CLAIM ───────────────────────────
 * There is no salary survey in this codebase and no licensed data feed behind it. A tool
 * that answers "what am I worth?" with a confident single number it derived from nothing
 * is the most damaging thing in this whole domain: a person walks into a negotiation
 * carrying it, and it is wrong in a direction they cannot detect.
 *
 * So the band below is an explicit, inspectable MODEL — anchor × seniority × region ×
 * mode — and every reading returns its own assumptions and a `basis` that says in words
 * what it is and is not. The caller is instructed to present it as a starting frame to
 * verify, not a market rate. When a live benchmark source is connected the anchors
 * become its data and the shape of the answer does not change.
 *
 * ── WHAT IS ACTUALLY LOAD-BEARING HERE ───────────────────────────────────────────
 * `compareOffers` is: it does arithmetic on numbers the person supplies (base, bonus,
 * equity, and — the part everyone omits — the value of the benefits and the cost of the
 * commute), and arithmetic is not a guess. That comparison is right regardless of
 * whether the band is.
 */

export type Seniority = 'intern' | 'junior' | 'mid' | 'senior' | 'staff' | 'lead' | 'principal' | 'director' | 'executive';

export interface SalaryBand {
  currency: string;
  low: number;
  median: number;
  high: number;
}

export interface SalaryAnalysis {
  band: SalaryBand;
  discipline: string;
  seniority: Seniority;
  region: string;
  workMode: 'remote' | 'hybrid' | 'onsite';
  /** Every multiplier that produced the band, so the number can be argued with. */
  assumptions: string[];
  /** Where the person's current or offered figure sits in the band, when supplied. */
  position: { value: number; percentile: number; verdict: string } | null;
  basis: string;
  instruction: string;
}

/**
 * Annual base anchors (USD, mid-level, national-average market, full-time employment).
 * Deliberately coarse: a made-up second decimal place is a false precision that makes a
 * model look like a measurement.
 */
const DISCIPLINE_ANCHOR: Readonly<Record<string, number>> = {
  developer: 118_000, engineer: 118_000, software: 118_000, frontend: 110_000, backend: 122_000,
  fullstack: 118_000, mobile: 118_000, devops: 130_000, sre: 135_000, security: 132_000,
  data: 125_000, 'data engineer': 130_000, 'data scientist': 132_000, analyst: 92_000,
  dba: 120_000, architect: 150_000, qa: 92_000, tester: 88_000,
  designer: 95_000, 'ux designer': 105_000, 'product designer': 110_000,
  product: 130_000, 'product manager': 130_000, 'project manager': 105_000, 'program manager': 120_000,
  scrum: 105_000, agile: 105_000, marketing: 88_000, sales: 95_000, 'account executive': 105_000,
  support: 62_000, success: 85_000, operations: 85_000, finance: 100_000, accounting: 82_000,
  hr: 85_000, recruiter: 85_000, legal: 135_000, writer: 75_000, content: 72_000,
};

const SENIORITY_MULTIPLIER: Readonly<Record<Seniority, number>> = {
  intern: 0.38, junior: 0.68, mid: 1, senior: 1.32, staff: 1.58, lead: 1.55,
  principal: 1.85, director: 2.05, executive: 2.6,
};

/** Cost-of-labour multipliers for the regions people most often ask about. */
const REGION_MULTIPLIER: ReadonlyArray<readonly [RegExp, number, string]> = [
  [/san francisco|bay area|silicon valley|palo alto/i, 1.42, 'San Francisco Bay Area'],
  [/new york|nyc|manhattan/i, 1.3, 'New York'],
  [/seattle|bellevue/i, 1.25, 'Seattle'],
  [/boston|los angeles|washington|san diego|austin|denver/i, 1.14, 'Major US metro'],
  [/london/i, 1.05, 'London'],
  [/zurich|geneva/i, 1.35, 'Switzerland'],
  [/dublin|amsterdam|munich|berlin|paris|stockholm|copenhagen/i, 0.92, 'Western Europe'],
  [/toronto|vancouver|ottawa|montreal/i, 0.85, 'Canada'],
  [/sydney|melbourne|brisbane|perth/i, 0.95, 'Australia'],
  [/singapore|hong kong|tokyo/i, 0.95, 'Developed APAC'],
  [/bangalore|bengaluru|mumbai|delhi|pune|hyderabad/i, 0.3, 'India'],
  [/warsaw|krakow|prague|budapest|bucharest|lisbon|madrid|barcelona/i, 0.6, 'Southern / Central Europe'],
  [/manila|jakarta|bangkok|hanoi|ho chi minh/i, 0.32, 'Southeast Asia'],
  [/sao paulo|são paulo|buenos aires|bogota|bogotá|mexico city|santiago/i, 0.42, 'Latin America'],
  [/lagos|nairobi|cairo|johannesburg|cape town/i, 0.35, 'Africa'],
];

const WORK_MODE_MULTIPLIER: Readonly<Record<'remote' | 'hybrid' | 'onsite', number>> = {
  // Remote roles are commonly benchmarked slightly below the top metro band and above
  // the national average; hybrid and onsite carry the local band as written.
  remote: 0.96, hybrid: 1, onsite: 1,
};

function normalizeSeniority(raw: string | undefined | null): Seniority {
  const value = String(raw ?? '').toLowerCase();
  if (/intern|placement|trainee/.test(value)) return 'intern';
  if (/junior|jr\b|entry|graduate|associate/.test(value)) return 'junior';
  if (/principal/.test(value)) return 'principal';
  if (/staff/.test(value)) return 'staff';
  if (/\blead\b|team lead|tech lead/.test(value)) return 'lead';
  if (/director|head of|vp|vice president/.test(value)) return 'director';
  if (/chief|cto|ceo|cfo|cio|executive/.test(value)) return 'executive';
  if (/senior|sr\b|snr/.test(value)) return 'senior';
  return 'mid';
}

function anchorFor(discipline: string): { anchor: number; matched: string } {
  const value = discipline.toLowerCase().trim();
  const exact = DISCIPLINE_ANCHOR[value];
  if (exact) return { anchor: exact, matched: value };
  for (const [key, anchor] of Object.entries(DISCIPLINE_ANCHOR)) {
    if (value.includes(key)) return { anchor, matched: key };
  }
  return { anchor: 95_000, matched: 'general professional (no discipline match)' };
}

function regionFor(location: string): { multiplier: number; label: string } {
  for (const [pattern, multiplier, label] of REGION_MULTIPLIER) {
    if (pattern.test(location)) return { multiplier, label };
  }
  return { multiplier: 1, label: location.trim() || 'national average (no region supplied)' };
}

/** Model an annual base-salary band, and optionally place a figure inside it. */
export function analyzeSalary(input: {
  discipline: string;
  seniority?: string;
  location?: string;
  workMode?: 'remote' | 'hybrid' | 'onsite';
  currency?: string;
  /** A current or offered base to place in the band. */
  currentBase?: number;
}): SalaryAnalysis {
  const { anchor, matched } = anchorFor(input.discipline ?? '');
  const seniority = normalizeSeniority(input.seniority);
  const region = regionFor(input.location ?? '');
  const workMode = input.workMode ?? 'hybrid';
  const multiplier = SENIORITY_MULTIPLIER[seniority] * region.multiplier * WORK_MODE_MULTIPLIER[workMode];
  const median = Math.round((anchor * multiplier) / 500) * 500;
  const band: SalaryBand = {
    currency: (input.currency ?? 'USD').toUpperCase(),
    low: Math.round((median * 0.82) / 500) * 500,
    median,
    high: Math.round((median * 1.24) / 500) * 500,
  };

  let position: SalaryAnalysis['position'] = null;
  if (typeof input.currentBase === 'number' && Number.isFinite(input.currentBase) && input.currentBase > 0) {
    const span = band.high - band.low || 1;
    const percentile = Math.max(0, Math.min(100, Math.round(((input.currentBase - band.low) / span) * 100)));
    position = {
      value: input.currentBase,
      percentile,
      verdict: percentile <= 15 ? 'below the modelled band — the strongest case for a raise or a move'
        : percentile <= 40 ? 'in the lower half of the modelled band'
          : percentile <= 70 ? 'around the modelled midpoint'
            : percentile <= 90 ? 'in the upper half of the modelled band'
              : 'above the modelled band — a lateral move is unlikely to beat it on base alone',
    };
  }

  return {
    band,
    // Computed above and then dropped from the payload — so a caller who supplied
    // their current base got the band back with no answer to the only question
    // that made them supply it.
    position,
    discipline: input.discipline ?? '',
    seniority,
    region: region.label,
    workMode,
    assumptions: [
      `Anchor: ${band.currency} ${anchor.toLocaleString('en-US')} for "${matched}" at mid level, full-time employment.`,
      `Seniority "${seniority}" applies ×${SENIORITY_MULTIPLIER[seniority]}.`,
      `Region "${region.label}" applies ×${region.multiplier}.`,
      `Work mode "${workMode}" applies ×${WORK_MODE_MULTIPLIER[workMode]}.`,
      'Band width is ±18% / +24% around the midpoint.',
      'Base salary only — bonus, equity, pension and benefits are excluded. Use the offer comparison for total compensation.',
    ],
    basis: 'A DECLARED MODEL, not a salary survey. No market data source is connected to this deployment, so these figures are an inspectable starting frame derived from the anchors and multipliers listed in `assumptions` — not a measurement of what employers are currently paying.',
    instruction: 'Give the band with its assumptions, and say plainly in one sentence that it is a model rather than market data and should be checked against two live sources before it is used in a negotiation. Never present the midpoint as "the market rate". If the person supplied a current figure, lead with where it sits and what that means for their next move.',
  };
}

// ---------------------------------------------------------------------------
// Offer comparison
// ---------------------------------------------------------------------------

export interface OfferInput {
  label: string;
  currency?: string;
  base: number;
  bonusAnnual?: number;
  /** Total equity grant value as the person values it, before vesting is applied. */
  equityTotal?: number;
  equityVestYears?: number;
  /** Employer pension/401k contribution, annual. */
  retirementAnnual?: number;
  /** Cash value the person puts on healthcare and other benefits, annual. */
  benefitsAnnual?: number;
  /** Annual out-of-pocket cost of taking this job — commute, relocation amortised, parking. */
  costsAnnual?: number;
  /** Paid days off, used to report a per-working-day rate. */
  paidDaysOff?: number;
  notes?: string;
}

export interface OfferComparison {
  offers: Array<{
    label: string;
    currency: string;
    /** Annualised total, net of the stated costs. */
    effectiveAnnual: number;
    breakdown: { base: number; bonus: number; equityPerYear: number; retirement: number; benefits: number; costs: number };
    perWorkingDay: number | null;
    /** Difference against the best offer in the set. */
    deltaVsBest: number;
  }>;
  best: string;
  /** Everything the arithmetic could not include — stated, never silently omitted. */
  notCounted: string[];
  instruction: string;
}

/**
 * Compare offers on total effective compensation.
 *
 * This is arithmetic on the person's own numbers, which is why it is the one reading in
 * this module that is not a model. The two lines people leave out — the employer's
 * retirement contribution and the annual COST of taking the job — are first-class
 * inputs, because they routinely reverse the ranking of two offers that look ten
 * thousand apart on base.
 */
export function compareOffers(offers: readonly OfferInput[]): OfferComparison {
  const rows = offers.map((offer) => {
    const currency = (offer.currency ?? 'USD').toUpperCase();
    const vestYears = Math.max(1, offer.equityVestYears ?? 4);
    const breakdown = {
      base: Math.max(0, offer.base || 0),
      bonus: Math.max(0, offer.bonusAnnual ?? 0),
      equityPerYear: Math.max(0, (offer.equityTotal ?? 0) / vestYears),
      retirement: Math.max(0, offer.retirementAnnual ?? 0),
      benefits: Math.max(0, offer.benefitsAnnual ?? 0),
      costs: Math.max(0, offer.costsAnnual ?? 0),
    };
    const effectiveAnnual = Math.round(
      breakdown.base + breakdown.bonus + breakdown.equityPerYear + breakdown.retirement + breakdown.benefits - breakdown.costs,
    );
    // 260 weekdays a year, less the paid days off the offer grants.
    const workingDays = offer.paidDaysOff != null ? Math.max(1, 260 - offer.paidDaysOff) : null;
    return {
      label: offer.label,
      currency,
      effectiveAnnual,
      breakdown,
      perWorkingDay: workingDays ? Math.round(effectiveAnnual / workingDays) : null,
      deltaVsBest: 0,
    };
  });

  // Seeded with `undefined` rather than `rows[0]` so an empty comparison is the
  // no-best case the loop below already handles, not a read off an empty array.
  const best = rows.reduce<typeof rows[number] | undefined>(
    (top, row) => (!top || row.effectiveAnnual > top.effectiveAnnual ? row : top),
    undefined,
  );
  for (const row of rows) row.deltaVsBest = row.effectiveAnnual - (best?.effectiveAnnual ?? 0);

  const currencies = new Set(rows.map((r) => r.currency));
  const notCounted = [
    'Tax. Every figure here is gross; two offers in different countries or states are not comparable until they are after-tax.',
    'Equity RISK. Private-company equity is valued at whatever the person entered; it may be worth nothing.',
    'Vesting cliffs and the value of unvested equity left behind at the current employer.',
    'Everything that is not money: the work, the people, the commute in hours rather than currency, and how long each role stays interesting.',
  ];
  if (currencies.size > 1) {
    notCounted.unshift(`Currency conversion. These offers are in ${[...currencies].join(', ')} and NO exchange rate has been applied — the totals are not directly comparable as printed.`);
  }

  return {
    offers: rows,
    best: best?.label ?? '',
    notCounted,
    instruction: 'Lead with the ranking and the size of the gap, then read out `notCounted` — every one of those routinely reverses a decision. If the offers are in different currencies, say explicitly that no conversion was applied before quoting any total.',
  };
}
