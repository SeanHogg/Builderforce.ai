/**
 * The startup listing vocabulary and the runway arithmetic — shared by the API
 * and the web (PRD 19 B1/B2: BurnRateOS's business directory, onboarding and
 * runway tracker, merged onto the CEO's `companies` root).
 *
 * ── WHY THIS IS SPEC DATA IN THE CONTRACT PACKAGE ───────────────────────────
 * BurnRateOS carried these lists three times — a Prisma enum, a frontend
 * `types/businessProfile.ts` and an onboarding `constants.ts` whose labels
 * ("Pre-Seed") did not match the enum ("PRE_SEED"), so the public API normalised
 * one to the other at the boundary. One declaration here means a stage the
 * founder picks in onboarding IS the stage the directory filters by, and a new
 * stage is a row rather than three edits.
 *
 * ── WHY THE RUNWAY MATH IS HERE TOO ─────────────────────────────────────────
 * The marketing calculator runs in the browser before sign-in; the founder's
 * onboarding step shows a live runway as they type; the CFO's runway view and
 * the public startup card both print one. Four surfaces, one formula — and the
 * formula has exactly one consequential mistake available (dividing by GROSS
 * spend instead of NET burn understates a company's runway fivefold), so it is
 * written once and tested once.
 */
// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------
/** `companies.stage` — the funding stage, in the order a company walks them. */
export const FUNDING_STAGES = [
    'bootstrapped', 'pre_seed', 'seed', 'series_a', 'series_b', 'series_c', 'series_d_plus', 'ipo_ready',
];
/** `companies.business_stage` — how far the product is, independent of money raised. */
export const BUSINESS_STAGES = ['idea', 'mvp', 'early_revenue', 'growth', 'scale'];
/**
 * `companies.sector` — the directory's industry filter AND the platform's ONE
 * industry vocabulary (PRD 25 §6.4, operator-approved 2026-09-15). The benchmark
 * cohorts (`industry_benchmarks.industry`, `tenant_benchmark_profiles.industry`)
 * carry these same values since migration 1176, so a company that declares a
 * sector is in a benchmark cohort by construction rather than by a second pick.
 *
 * The ten values that carry a preconfigured KPI dashboard are `DASHBOARD_VERTICALS`
 * in verticals.ts; the rest fold onto one of them or onto the founder layer alone.
 */
export const STARTUP_SECTORS = [
    'ai_ml', 'saas', 'fintech', 'healthtech', 'medtech', 'biotech', 'climate_energy',
    'hardware_robotics', 'cybersecurity', 'marketplace', 'ecommerce', 'consumer_apps',
    'enterprise_software', 'edtech', 'blockchain', 'gaming', 'media_entertainment', 'real_estate',
    'logistics', 'other',
];
/** What a listed company says it is looking for. Stored as `companies.seeking`. */
export const SEEKING_TYPES = ['funding', 'cofounders', 'advisors', 'customers', 'partners', 'hiring', 'mentorship'];
/** The instrument an investor proposes on an inquiry. */
export const INVESTMENT_TYPES = ['equity', 'convertible_note', 'safe', 'revenue_share', 'debt'];
/** How soon the investor could move. */
export const INQUIRY_TIMEFRAMES = ['immediate', 'short_term', 'medium_term', 'long_term'];
/** What an investor offers beyond money. */
export const EXPERTISE_AREAS = [
    'product', 'marketing', 'operations', 'finance', 'legal', 'people', 'technology',
    'business_development', 'fundraising', 'international',
];
/** The directory's sort orders. `runway` sorts the longest declared runway first. */
export const DIRECTORY_SORTS = ['newest', 'funding', 'alphabetical', 'runway'];
/** The founder's triage of an inquiry — `deal_flow_opportunities.status`, verbatim. */
export const INQUIRY_STATUSES = ['new', 'qualifying', 'converted', 'rejected'];
const inList = (list) => (v) => typeof v === 'string' && list.includes(v);
export const isFundingStage = inList(FUNDING_STAGES);
export const isBusinessStage = inList(BUSINESS_STAGES);
export const isStartupSector = inList(STARTUP_SECTORS);
export const isSeekingType = inList(SEEKING_TYPES);
export const isInvestmentType = inList(INVESTMENT_TYPES);
export const isInquiryTimeframe = inList(INQUIRY_TIMEFRAMES);
export const isExpertiseArea = inList(EXPERTISE_AREAS);
export const isDirectorySort = inList(DIRECTORY_SORTS);
export const isInquiryStatus = inList(INQUIRY_STATUSES);
/** Bounds every writer applies, so the API and the form reject the same input. */
export const LISTING_LIMITS = {
    tagline: 160,
    description: 4000,
    name: 255,
    city: 120,
    region: 120,
    contactName: 160,
    contactEmail: 320,
    inquiryMessageMin: 20,
    inquiryMessageMax: 4000,
    /** A public directory page never serves more than this many cards. */
    pageMax: 48,
    pageDefault: 12,
};
// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------
/** Runway turns from healthy to a warning under this many months. */
export const RUNWAY_WATCH_MONTHS = 12;
/** Under this many months the founder should already be raising. */
export const RUNWAY_CRITICAL_MONTHS = 6;
const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
/**
 * Runway = cash ÷ NET burn, where net burn = monthly spend − monthly revenue.
 *
 * A company spending $100k and earning $80k is burning $20k, and dividing its cash
 * by $100k would report a fifth of its real runway. `teamCost` is not added on top
 * of `monthlyBudget`: BurnRateOS's onboarding collected it as a component of the
 * budget (so the CFO advisor can name the largest line), and summing it again
 * doubled the burn for anyone who filled both fields in.
 */
export function computeRunway(input, now = new Date()) {
    const cash = Math.max(0, finite(input.cashOnHand));
    const netBurn = finite(input.monthlyBudget) - finite(input.monthlyRevenue);
    if (netBurn <= 0) {
        return { netBurn, runwayMonths: null, health: 'profitable', zeroCashDate: null };
    }
    const runwayMonths = Math.round((cash / netBurn) * 10) / 10;
    const health = runwayMonths < RUNWAY_CRITICAL_MONTHS ? 'critical'
        : runwayMonths < RUNWAY_WATCH_MONTHS ? 'watch'
            : 'healthy';
    return { netBurn, runwayMonths, health, zeroCashDate: zeroCashDateFrom(now, runwayMonths) };
}
/** The calendar date `months` from `now`, to the day. */
export function zeroCashDateFrom(now, months) {
    const whole = Math.floor(months);
    const days = Math.round((months - whole) * 30);
    const at = new Date(now.getTime());
    at.setMonth(at.getMonth() + whole);
    at.setDate(at.getDate() + days);
    return at.toISOString();
}
/**
 * A declared cashflow projection: the same inflow and outflow every month,
 * starting from cash on hand, for `months` months. A projection and not a
 * forecast — it answers "at this burn, where does the balance go", which is the
 * question the founder is asking when they type the numbers in.
 */
export function projectCashflow(input, months, from = new Date()) {
    const outflows = Math.max(0, finite(input.monthlyBudget));
    const inflows = Math.max(0, finite(input.monthlyRevenue));
    let balance = Math.max(0, finite(input.cashOnHand));
    const out = [];
    const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
    for (let i = 0; i < Math.max(0, Math.floor(months)); i += 1) {
        balance = balance + inflows - outflows;
        out.push({
            month: monthKey(cursor),
            inflows,
            outflows,
            net: inflows - outflows,
            endingBalance: balance,
        });
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return out;
}
/** `YYYY-MM` for a date, in UTC — the key every cashflow series is joined on. */
export function monthKey(at) {
    return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
}
/**
 * The slug a listed company is reached by. The one place the rule lives, so the
 * founder's preview and the public URL cannot spell it differently.
 */
export function startupProfilePath(slug) {
    return `/marketplace/company/${encodeURIComponent(slug)}`;
}
//# sourceMappingURL=startupListing.js.map