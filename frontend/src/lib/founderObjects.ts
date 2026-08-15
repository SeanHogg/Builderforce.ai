/**
 * THE founder-object specification — one declaration per kind, read by everything.
 *
 * ── WHAT THIS EXISTS TO PREVENT ──────────────────────────────────────────────────
 * The canvas grew to seventy-nine object kinds, and the cost of each one was paid four
 * times: a `createData` entry, a `MUTABLE_FIELDS` row, an entry in `CONTEXT_FIELDS`, and
 * a hand-written `{data.kind === 'x' && <XBody/>}` branch in a 138KB component. Those
 * four lists are maintained independently and they drift — `value`, `target`, `unit` and
 * `trend` were authorable on a `kpi` and absent from `CONTEXT_FIELDS`, so Brain could
 * write a KPI's number onto the board and could never read it back. The card showed a
 * number the model was blind to.
 *
 * The founder kinds are declared ONCE, here — `FOUNDER_OBJECT_KINDS` in the contract is the
 * list, and a test holds the two in step, which is why no count is written into this prose.
 * This module is the single source
 * for:
 *   • the node body           — `SpecObjectBody` renders these sections generically
 *   • the AI field contract   — `founderFieldGuidance()` documents them to the model
 *   • the registry            — `createData`, mutable fields and context fields are
 *                               DERIVED from `fields`, so a field cannot be authorable
 *                               and unreadable at the same time
 *   • the empty-shell rule    — a founder object with only a title is refused because
 *                               `contentFields` falls out of the same declaration
 *
 * Adding a founder kind is adding one entry below. There is no branch to forget.
 *
 * ── WHY THE RENDER STYLES ARE A CLOSED SET ───────────────────────────────────────
 * Seven styles cover every kind in the set, which is the point: a `capTable` and a
 * `customerSegment` are the same shape of thing on a board — a few headline numbers and
 * a table of rows — and rendering them with one component is what keeps a founder's
 * canvas looking like one product. A new kind that genuinely cannot be expressed in
 * these styles is a signal to add a style here, not a bespoke body elsewhere.
 *
 * User-facing labels are i18n KEY SUFFIXES resolved under `creationCanvas.founder.*`;
 * `hint` is model-facing and stays English, like every other tool description.
 */

import type { FounderObjectKind } from '@builderforce/creation-canvas-contract';
import {
  SOURCES_FIELD,
  SUMMARY_FIELD,
  registerSpecObjectSet,
  type SpecField,
  type SpecObjectSpec,
} from './specObjects';

/**
 * A founder field IS a spec field.
 *
 * ── WHY THIS IS AN ALIAS AND NOT A DECLARATION ──────────────────────────────────
 * It used to be its own interface — seven render styles, `columns`, `bookkeeping` —
 * written before `specObjects.ts` generalised the mechanism, and left behind after. The
 * two were structurally compatible, which is exactly what made the duplicate dangerous
 * rather than merely redundant: `registerSpecObjectSet` accepted these specs happily, so
 * nothing failed, and a capability added to `SpecField` was simply UNAVAILABLE here with
 * no error to say so. `deadline` was the one that made it visible — flagging a contract's
 * `renewsAt` failed to compile against a local type that had never heard of it, while
 * `restricted`, `derived` and `derive` had been quietly out of reach for the founder
 * vocabulary the whole time.
 *
 * The names survive because the file's own vocabulary reads better with them and its
 * existing importers use them; the TYPE is the shared one, so there is nothing left to
 * drift.
 */
export type FounderField = SpecField;
export type FounderFieldRender = SpecField['render'];

/** A founder spec, with the kind narrowed to the declared founder set — the one thing
 *  this vocabulary knows that the generic type cannot. */
export interface FounderObjectSpec extends SpecObjectSpec {
  kind: FounderObjectKind;
  /** Mirrors `CreationObjectGroup` in the registry; kept as a string union rather than
   *  imported to avoid a cycle. */
  group: 'Insights' | 'Work' | 'People' | 'Data' | 'Knowledge' | 'Collaborate';
}

/**
 * Money is WRITTEN as prose and READ as a number.
 *
 * The original rule was prose-only, and its reasoning was sound: a founder object
 * routinely holds a figure that is a range, an estimate, or explicitly unknown
 * ("~$2–4M ARR", "not disclosed"), and forcing those into an integer either loses the
 * qualifier or invents a precision the source never had — an invented precision in a
 * competitor analysis being exactly what the empty-shell rule exists to stop.
 *
 * The conclusion was wrong, because it made the CFO's most basic operation
 * UNREPRESENTABLE rather than merely unimplemented: a cap table could not be totalled,
 * `committed` could not be compared to `targetAmount`, and no two entities could be
 * consolidated. Every real figure left for a spreadsheet and came back as a screenshot.
 *
 * `canvasMoney.ts` resolves it without changing what the model writes: {@link
 * parseMoney} reads the SAME prose and yields `{amount, currency, approximate, low,
 * high, qualifier}`, so "~$2–4M ARR" is both a preserved qualifier and a real number,
 * and "not disclosed" is `disclosed: false` with NO amount — never a silent zero. So the
 * hint below is unchanged for the research kinds (write what the source said), while the
 * operational kinds added under "the money, operated" ask for a plain number plus a
 * `currency` field, because an invoice's amount is a fact and not a characterisation.
 */
const MONEY_HINT = 'A human-readable amount including its currency and any qualifier the source actually carried, e.g. "$1.2M ARR (2025 estimate)" or "not disclosed". Never invent a precise figure — it is parsed into a real number for totals, and "not disclosed" is preserved as undisclosed rather than counted as zero.';

/** For the operated kinds, where the number is a fact rather than a characterisation. */
const EXACT_MONEY_HINT = 'A plain number in major units (dollars, not cents) — no symbols, no "k"/"M" suffix, no commas. The currency lives in the `currency` field so this object can be totalled and consolidated. Leave it empty rather than estimating.';

const CURRENCY_FIELD: FounderField = {
  name: 'currency',
  render: 'stat',
  label: 'currency',
  hint: 'ISO-4217 code for every amount on this object, e.g. "USD", "EUR", "GBP". One currency per object — a mixed-currency total is refused rather than silently added.',
};

// `SOURCES_FIELD` and `SUMMARY_FIELD` are imported from `specObjects.ts`. They were
// declared here too, byte-identical, which is the same duplicate the type alias above
// removes: two constants that agreed until somebody improved one of them.

export const FOUNDER_OBJECT_SPECS: readonly FounderObjectSpec[] = [
  // ── Who we are ────────────────────────────────────────────────────────────────
  {
    kind: 'company',
    icon: '⌂',
    group: 'Insights',
    defaultStatus: 'describeBusiness',
    actions: ['sync', 'research'],
    fields: [
      { name: 'legalName', render: 'stat', label: 'legalName', hint: 'Registered legal name, if it differs from the trading name in the title.' },
      { name: 'sector', render: 'stat', label: 'sector', hint: 'The industry the business actually sells into, in the words its buyers use.' },
      { name: 'stage', render: 'stat', label: 'stage', hint: 'idea | pre-seed | seed | series-a | growth | profitable.' },
      { name: 'headcount', render: 'stat', label: 'headcount', hint: 'Current full-time-equivalent headcount as an integer.' },
      { name: 'arr', render: 'stat', label: 'arr', hint: MONEY_HINT },
      { name: 'website', render: 'stat', label: 'website', hint: 'Primary marketing domain.' },
      { name: 'geography', render: 'chips', label: 'geography', hint: 'Markets served today, most important first, e.g. ["Florida", "Georgia"]. This is what a geographic analysis is scoped against.' },
      { name: 'offerings', render: 'list', label: 'offerings', hint: 'What the business sells: [{title, detail}] where detail names who it is for and what it costs.' },
      { name: 'differentiators', render: 'chips', label: 'differentiators', hint: 'The reasons a customer picks this business over the obvious alternative. Specific and checkable, never adjectives.' },
      SUMMARY_FIELD,
      SOURCES_FIELD,
    ],
  },
  // ── Who we are against ────────────────────────────────────────────────────────
  {
    kind: 'competitor',
    icon: '⚔',
    group: 'Insights',
    defaultStatus: 'researching',
    actions: ['research', 'map', 'battlecard'],
    fields: [
      { name: 'website', render: 'stat', label: 'website', hint: 'Primary domain. Use it to verify every other claim.' },
      { name: 'headquarters', render: 'stat', label: 'headquarters', hint: 'City, state of the head office.' },
      { name: 'estimatedRevenue', render: 'stat', label: 'estimatedRevenue', hint: MONEY_HINT },
      { name: 'employeeRange', render: 'stat', label: 'employeeRange', hint: 'Reported headcount band, e.g. "50-200".' },
      { name: 'positioning', render: 'text', label: 'positioning', hint: 'How they describe themselves to a buyer, close to their own words.' },
      {
        name: 'locations',
        render: 'rows',
        label: 'locations',
        columns: ['name', 'city', 'region', 'lat', 'lng'],
        hint: 'Physical presence, one row per site: {name, city, region, lat, lng}. `lat`/`lng` are decimal degrees — resolve them with builtin_geo_geocode and never estimate them, because canvas_map_competitors plots these coordinates and a guessed one puts a rival in the ocean.',
      },
      { name: 'pricingModel', render: 'text', label: 'pricingModel', hint: 'How they charge, with real figures where published, and "not published" where not.' },
      { name: 'strengths', render: 'chips', label: 'strengths', hint: 'What they genuinely do well. A competitor analysis with no strengths listed is flattery, not analysis.' },
      { name: 'weaknesses', render: 'chips', label: 'weaknesses', hint: 'Verifiable gaps — from reviews, pricing pages, coverage maps. These become the wedge in a battlecard, so a soft one wastes the whole strategy.' },
      { name: 'segmentsServed', render: 'chips', label: 'segmentsServed', hint: 'Which customer segments they actually serve today.' },
      SUMMARY_FIELD,
      SOURCES_FIELD,
    ],
  },
  // ── Who we sell to ────────────────────────────────────────────────────────────
  {
    kind: 'customerSegment',
    icon: '◕',
    group: 'Insights',
    defaultStatus: 'sizing',
    actions: ['size', 'target'],
    fields: [
      { name: 'sizeEstimate', render: 'stat', label: 'sizeEstimate', hint: 'How many buyers are in this segment, with the basis in brackets, e.g. "~4,200 firms (FL SoS registrations, 2025)".' },
      { name: 'valueEstimate', render: 'stat', label: 'valueEstimate', hint: MONEY_HINT },
      { name: 'fitScore', render: 'meter', label: 'fitScore', hint: '0-100: how well this segment matches what the company can actually deliver today. Justify it in `summary`.' },
      { name: 'geography', render: 'chips', label: 'geography', hint: 'Where these buyers are, specific enough to act on — metro areas, not "the south".' },
      { name: 'pains', render: 'list', label: 'pains', hint: 'The problems that make them buy: [{title, detail}]. Sourced from interviews or reviews wherever possible.' },
      { name: 'buyingTriggers', render: 'chips', label: 'buyingTriggers', hint: 'Events that start a purchase — a renewal, a regulation, a hire, an outage.' },
      { name: 'channels', render: 'chips', label: 'channels', hint: 'Where this segment can actually be reached. Must be consistent with the linked gtmPlan.' },
      { name: 'currentProvider', render: 'chips', label: 'currentProvider', hint: 'Who they buy from today. Naming a competitor here is what makes a switch strategy targetable.' },
      SUMMARY_FIELD,
      SOURCES_FIELD,
    ],
  },
  {
    kind: 'gtmPlan',
    icon: '➤',
    group: 'Work',
    defaultStatus: 'draft',
    actions: ['review', 'plan'],
    fields: [
      { name: 'motion', render: 'stat', label: 'motion', hint: 'The dominant motion: self-serve | inside-sales | field-sales | partner-led | community-led.' },
      { name: 'salesCycleDays', render: 'stat', label: 'salesCycleDays', hint: 'Typical days from first touch to closed-won, as an integer.' },
      { name: 'targetCac', render: 'stat', label: 'targetCac', hint: MONEY_HINT },
      { name: 'targetLtv', render: 'stat', label: 'targetLtv', hint: MONEY_HINT },
      { name: 'segments', render: 'chips', label: 'segments', hint: 'Titles of the customerSegment objects this plan targets. Keep them identical to the segment titles on the board so the two objects stay joined.' },
      { name: 'channels', render: 'rows', label: 'channels', columns: ['channel', 'motion', 'cost', 'expected'], hint: 'One row per channel: {channel, motion, cost, expected}. `expected` is the outcome you would call success.' },
      { name: 'offer', render: 'text', label: 'offer', hint: 'The specific offer that opens a conversation — the thing said in the first message, not the value proposition.' },
      { name: 'proofPoints', render: 'chips', label: 'proofPoints', hint: 'Evidence a sceptical buyer would accept: named customers, measured outcomes, certifications.' },
      SUMMARY_FIELD,
      SOURCES_FIELD,
    ],
  },
  {
    kind: 'battlecard',
    icon: '⛊',
    group: 'Work',
    defaultStatus: 'draft',
    actions: ['review', 'deliver'],
    fields: [
      { name: 'againstCompetitor', render: 'stat', label: 'againstCompetitor', hint: 'The exact title of the competitor object this card is written against. A battlecard with no named rival is a positioning doc.' },
      { name: 'wedge', render: 'verdict', label: 'wedge', hint: 'The ONE weakness being attacked, in a sentence. This is the whole strategy; everything else supports it.' },
      { name: 'targetSegments', render: 'chips', label: 'targetSegments', hint: 'Which of their customers to go after first — the segments where the wedge bites hardest.' },
      { name: 'switchTriggers', render: 'chips', label: 'switchTriggers', hint: 'Moments when their customer is reachable: renewal dates, price rises, outages, acquisitions.' },
      { name: 'talkTrack', render: 'list', label: 'talkTrack', hint: 'What to actually say: [{title, detail}] where title is the situation and detail is the line.' },
      { name: 'objections', render: 'rows', label: 'objections', columns: ['objection', 'response', 'evidence'], hint: 'One row per likely objection: {objection, response, evidence}. `evidence` must be something that exists.' },
      { name: 'switchOffer', render: 'text', label: 'switchOffer', hint: 'The concrete offer that lowers the cost of switching — migration help, overlap credit, a pilot.' },
      { name: 'doNotSay', render: 'chips', label: 'doNotSay', hint: 'Claims that are untrue, unprovable, or legally risky. A battlecard without this list gets someone in trouble.' },
      SUMMARY_FIELD,
      SOURCES_FIELD,
    ],
  },
  // ── The evidence ──────────────────────────────────────────────────────────────
  {
    kind: 'customerInterview',
    icon: '☏',
    group: 'People',
    defaultStatus: 'scheduled',
    actions: ['record', 'synthesize'],
    fields: [
      { name: 'participant', render: 'stat', label: 'participant', hint: 'Role and company of the person, e.g. "Ops Director, mid-size FL contractor". Use a role rather than a name unless consent to record it is explicit.' },
      { name: 'segment', render: 'stat', label: 'segment', hint: 'Title of the customerSegment this person belongs to.' },
      { name: 'heldAt', render: 'stat', label: 'heldAt', hint: 'ISO date the conversation happened.' },
      { name: 'questions', render: 'list', label: 'questions', hint: 'What was asked and what came back: [{title, detail}].' },
      { name: 'painsHeard', render: 'chips', label: 'painsHeard', hint: 'Problems the participant raised UNPROMPTED. These are worth more than answers to your own questions, so keep them separate.' },
      { name: 'quotes', render: 'list', label: 'quotes', hint: 'Verbatim lines worth reusing. Never paraphrase into a quote.' },
      { name: 'verdict', render: 'verdict', label: 'verdict', hint: 'What this conversation changed: confirmed, contradicted, or left the assumption untested.' },
      SUMMARY_FIELD,
      SOURCES_FIELD,
    ],
  },
  {
    kind: 'experiment',
    icon: '⚗',
    group: 'Data',
    defaultStatus: 'designing',
    actions: ['run', 'evaluate'],
    fields: [
      { name: 'hypothesis', render: 'verdict', label: 'hypothesis', hint: '"If we <change>, then <metric> moves <direction> because <reason>." An experiment without a falsifiable hypothesis is a change.' },
      { name: 'primaryMetric', render: 'stat', label: 'primaryMetric', hint: 'The ONE metric that decides it. Naming two is how an experiment is declared a success afterwards.' },
      { name: 'sampleSize', render: 'stat', label: 'sampleSize', hint: 'Units observed, as an integer.' },
      { name: 'result', render: 'stat', label: 'result', hint: 'The measured outcome, with its confidence where one was computed.' },
      { name: 'variants', render: 'rows', label: 'variants', columns: ['variant', 'exposure', 'conversion', 'lift'], hint: 'One row per variant: {variant, exposure, conversion, lift}.' },
      { name: 'verdict', render: 'verdict', label: 'verdict', hint: 'shipped | rejected | inconclusive, and the reason. "Inconclusive" is a real and common answer.' },
      SUMMARY_FIELD,
      SOURCES_FIELD,
    ],
  },
  // ── What we chose, and what we are aiming at ──────────────────────────────────
  {
    kind: 'decision',
    icon: '⚖',
    group: 'Work',
    defaultStatus: 'open',
    actions: ['decide', 'revisit'],
    fields: [
      { name: 'question', render: 'verdict', label: 'question', hint: 'The decision being made, as a question with a real fork in it.' },
      { name: 'chosen', render: 'stat', label: 'chosen', hint: 'The option taken. Empty while the decision is still open.' },
      { name: 'decidedBy', render: 'stat', label: 'decidedBy', hint: 'Who actually decided.' },
      { name: 'decidedAt', render: 'stat', label: 'decidedAt', hint: 'ISO date.' },
      { name: 'reversibility', render: 'stat', label: 'reversibility', hint: 'one-way | reversible | cheap-to-reverse. This is what says how much deliberation the decision deserved.' },
      { name: 'options', render: 'rows', label: 'options', columns: ['option', 'upside', 'risk', 'cost'], hint: 'Every option considered, including the ones rejected: {option, upside, risk, cost}. A decision log with one option recorded is a note.' },
      { name: 'rationale', render: 'text', label: 'rationale', hint: 'Why this option, in terms of what was known AT THE TIME. This is the field the whole object exists for.' },
      { name: 'revisitWhen', render: 'chips', label: 'revisitWhen', hint: 'Conditions that should reopen this — the facts whose change would flip the answer.' },
      SOURCES_FIELD,
    ],
  },
  {
    kind: 'objective',
    icon: '◎',
    group: 'Work',
    defaultStatus: 'draft',
    actions: ['review', 'link'],
    fields: [
      { name: 'owner', render: 'stat', label: 'owner', hint: 'The single person accountable. Not a team.' },
      { name: 'period', render: 'stat', label: 'period', hint: 'The window, e.g. "Q3 2026".' },
      { name: 'progress', render: 'meter', label: 'progress', hint: '0-100, derived from the key results rather than asserted.' },
      { name: 'keyResults', render: 'rows', label: 'keyResults', columns: ['result', 'baseline', 'target', 'current'], hint: 'One row per key result: {result, baseline, target, current}. Each must be a number that moves, not an activity that completes.' },
      { name: 'rationale', render: 'text', label: 'rationale', hint: 'Why this objective matters more than the alternatives this period.' },
      SOURCES_FIELD,
    ],
  },
  // ── The live half ─────────────────────────────────────────────────────────────
  {
    kind: 'liveMetric',
    icon: '↗',
    group: 'Data',
    defaultStatus: 'bindMetric',
    actions: ['refresh', 'bind', 'watch'],
    fields: [
      // Reuses the KPI value/target/unit/trend vocabulary deliberately: the two objects
      // answer the same question and differ only in whether the number re-reads.
      { name: 'value', render: 'stat', label: 'value', hint: 'The latest observed value. Written by canvas_refresh_live_metric, not authored by hand once a binding exists.' },
      { name: 'unit', render: 'stat', label: 'unit', hint: 'The unit the value is in, e.g. "months", "USD", "%".' },
      { name: 'target', render: 'stat', label: 'target', hint: 'The value that would mean this is healthy.' },
      { name: 'trend', render: 'stat', label: 'trend', hint: 'Direction and size of the recent move, e.g. "-1.4 vs 30d ago".' },
      {
        name: 'binding',
        render: 'stat',
        label: 'binding',
        hint: 'The domain metric key this object re-reads, e.g. "finance.runway_months", "revenue.pipeline", "growth.leads". This is what makes the object LIVE instead of a snapshot — set it and canvas_refresh_live_metric can answer the same question tomorrow.',
      },
      { name: 'series', render: 'rows', label: 'series', columns: ['at', 'value'], hint: 'Observed points: {at, value}. Written by the refresh, never authored.', bookkeeping: true },
      { name: 'fetchedAt', render: 'stat', label: 'fetchedAt', hint: 'ISO instant the value was last read. Rendered as staleness, so never fabricate it.', bookkeeping: true },
      SUMMARY_FIELD,
    ],
  },
  {
    kind: 'trigger',
    icon: '⚑',
    group: 'Data',
    defaultStatus: 'armed',
    actions: ['evaluate', 'mute'],
    fields: [
      { name: 'watches', render: 'stat', label: 'watches', hint: 'Title of the object on this board that this trigger evaluates — a `liveMetric` for a numeric comparator, or any deadline-bearing object (contract, invoice, bill, fundingRound, obligation, policy, offer, assignment, grant, peerReview) for a date one.' },
      { name: 'watchesField', render: 'stat', label: 'watchesField', hint: 'Which field on the watched object to read. Leave EMPTY unless the object has more than one deadline — the object\'s first declared deadline field is used, which is the right one for every kind that has only one.' },
      { name: 'comparator', render: 'stat', label: 'comparator', hint: 'For a number: below | above | equals | changes-by. For a deadline: due-within (breaches when the date is `threshold` days away or closer, INCLUDING already past — the "warn me before" case) | overdue-by (breaches only once the date is `threshold` days past; 0 means the day after it lapses — the "chase it" case).' },
      { name: 'threshold', render: 'stat', label: 'threshold', hint: 'The number the comparator tests against. For a date comparator this is a number of DAYS, never a date — the date lives on the object being watched, which is what keeps the trigger true next quarter without being re-typed.' },
      { name: 'state', render: 'verdict', label: 'state', hint: 'armed | breached | muted. Written by canvas_evaluate_triggers.', bookkeeping: true },
      { name: 'lastEvaluatedAt', render: 'stat', label: 'lastEvaluatedAt', hint: 'ISO instant of the last evaluation.', bookkeeping: true },
      { name: 'thenDo', render: 'list', label: 'thenDo', hint: 'What should happen on breach: [{title, detail}]. An alert nobody acts on is noise, so name the action and its owner.' },
      SUMMARY_FIELD,
    ],
  },
  // ── The money ─────────────────────────────────────────────────────────────────
  {
    kind: 'pricing',
    icon: '§',
    group: 'Work',
    defaultStatus: 'draft',
    actions: ['model', 'review'],
    fields: [
      { name: 'model', render: 'stat', label: 'pricingModel', hint: 'per-seat | usage | flat | tiered | value-based.' },
      { name: 'grossMargin', render: 'stat', label: 'grossMargin', hint: 'Gross margin as a percentage, with the cost basis stated in `summary`.' },
      { name: 'paybackMonths', render: 'stat', label: 'paybackMonths', hint: 'Months to recover acquisition cost.' },
      { name: 'tiers', render: 'rows', label: 'tiers', columns: ['tier', 'price', 'includes', 'target'], hint: 'One row per tier: {tier, price, includes, target}. `target` is which segment it is priced for.' },
      { name: 'unitEconomics', render: 'rows', label: 'unitEconomics', columns: ['metric', 'value', 'basis'], hint: 'CAC, LTV, contribution margin: {metric, value, basis}. `basis` names the assumption, which is the part that is actually load-bearing.' },
      { name: 'competitorPricing', render: 'rows', label: 'competitorPricing', columns: ['competitor', 'entry', 'mid', 'notes'], hint: 'What rivals charge: {competitor, entry, mid, notes}. Only from published pricing — mark inference as inference in `notes`.' },
      SUMMARY_FIELD,
      SOURCES_FIELD,
    ],
  },
  {
    kind: 'capTable',
    icon: '◱',
    group: 'Work',
    defaultStatus: 'draft',
    actions: ['model', 'review'],
    fields: [
      { name: 'postMoney', render: 'stat', label: 'postMoney', hint: MONEY_HINT },
      { name: 'optionPool', render: 'stat', label: 'optionPool', hint: 'Option pool as a percentage of fully diluted shares.' },
      { name: 'fullyDiluted', render: 'stat', label: 'fullyDiluted', hint: 'Total fully diluted shares as an integer.' },
      { name: 'holders', render: 'rows', label: 'holders', columns: ['holder', 'instrument', 'shares', 'percent'], hint: 'One row per holder: {holder, instrument, shares, percent}. Percentages must total ~100 including the pool — if they do not, say so in `summary` rather than adjusting a number to make it balance.' },
      SUMMARY_FIELD,
    ],
  },
  {
    kind: 'fundingRound',
    icon: '◈',
    group: 'Work',
    defaultStatus: 'planning',
    actions: ['plan', 'track'],
    fields: [
      { name: 'roundType', render: 'stat', label: 'roundType', hint: 'pre-seed | seed | series-a | bridge | safe.' },
      { name: 'targetAmount', render: 'stat', label: 'targetAmount', hint: MONEY_HINT },
      { name: 'committed', render: 'stat', label: 'committed', hint: MONEY_HINT },
      { name: 'valuation', render: 'stat', label: 'valuation', hint: MONEY_HINT },
      { name: 'closeTarget', render: 'stat', label: 'closeTarget', hint: 'ISO date you intend to close. Bind a `trigger` with comparator "due-within" so the runway conversation happens while there is still runway.', deadline: true },
      { name: 'useOfFunds', render: 'rows', label: 'useOfFunds', columns: ['area', 'amount', 'outcome'], hint: 'Where the money goes: {area, amount, outcome}. `outcome` is what the money BUYS, which is the question an investor actually asks.' },
      { name: 'investors', render: 'rows', label: 'investors', columns: ['investor', 'stage', 'amount', 'nextStep'], hint: 'Pipeline, one row per firm: {investor, stage, amount, nextStep}.' },
      SUMMARY_FIELD,
    ],
  },
  {
    kind: 'investorUpdate',
    icon: '✉',
    group: 'Knowledge',
    defaultStatus: 'draft',
    actions: ['draft', 'send'],
    fields: [
      { name: 'period', render: 'stat', label: 'period', hint: 'The month or quarter being reported.' },
      { name: 'highlights', render: 'list', label: 'highlights', hint: 'What went well: [{title, detail}] with a number in each detail.' },
      { name: 'lowlights', render: 'list', label: 'lowlights', hint: 'What did not. An update with no lowlights is not read as good news, it is read as unreliable.' },
      { name: 'metrics', render: 'rows', label: 'metrics', columns: ['metric', 'value', 'previous', 'change'], hint: 'The standing numbers: {metric, value, previous, change}. Same metrics every period, including the ones that got worse.' },
      { name: 'asks', render: 'chips', label: 'asks', hint: 'Specific, actionable requests — an intro to a named company, a hire, a customer reference.' },
      SUMMARY_FIELD,
    ],
  },
  {
    kind: 'dataRoom',
    icon: '▤',
    group: 'Knowledge',
    defaultStatus: 'assembling',
    actions: ['assemble', 'share'],
    fields: [
      { name: 'audience', render: 'stat', label: 'audience', hint: 'Who this room is for — a named firm or a stage of diligence.' },
      { name: 'readiness', render: 'meter', label: 'readiness', hint: '0-100: share of required documents actually present.' },
      { name: 'documents', render: 'rows', label: 'documents', columns: ['document', 'category', 'status', 'owner'], hint: 'One row per required document: {document, category, status, owner}. Include the MISSING ones with status "missing" — a data room that lists only what exists hides the gap it was built to close.' },
      SUMMARY_FIELD,
    ],
  },
  // ── The money, operated ───────────────────────────────────────────────────────
  //
  // The five kinds above hold the money a company RAISES and CHARGES. These five hold
  // the money it PLANS, COLLECTS, OWES and SPENDS ON PEOPLE. Every amount is a plain
  // number beside one `currency`, because these are facts to be totalled rather than
  // characterisations to be preserved — see the MONEY_HINT note.
  {
    kind: 'budget',
    icon: '▦',
    group: 'Work',
    // Never "approved" on a blank card: the whole value of a budget is that it was
    // agreed and then stopped changing, and a default that claims agreement would make
    // the object lie about the one property it exists to carry.
    defaultStatus: 'drafting',
    actions: ['plan', 'compare', 'approve'],
    fields: [
      { name: 'period', render: 'stat', label: 'period', hint: 'The period this budget covers — "FY2027", "2026-Q4", "2026-09".' },
      CURRENCY_FIELD,
      { name: 'plannedTotal', render: 'stat', label: 'plannedTotal', hint: `${EXACT_MONEY_HINT} The total of every line's planned amount. Computed from \`lines\` — do not author it independently, or the header will disagree with the table under it.` },
      { name: 'actualTotal', render: 'stat', label: 'actualTotal', hint: `${EXACT_MONEY_HINT} The total actually spent so far. Written by a refresh against connected actuals, not typed.`, bookkeeping: true },
      { name: 'variance', render: 'verdict', label: 'variance', hint: 'The one sentence a budget exists to produce: which lines are over, by how much, and whether the period total is still achievable. Say "under" or "over" explicitly.' },
      {
        name: 'lines',
        render: 'rows',
        label: 'lines',
        columns: ['line', 'category', 'owner', 'planned', 'actual', 'variance'],
        hint: 'One row per budget line: {line, category, owner, planned, actual, variance}. `planned` and `actual` are plain numbers in the object currency. `owner` is REQUIRED — an over-budget line with nobody accountable is a number, not a control.',
      },
      { name: 'assumptions', render: 'list', label: 'assumptions', hint: 'What this budget takes for granted: [{title, detail}]. Headcount, price, conversion, FX. The assumptions are what a reviewer actually challenges, so an unstated one is the defect.' },
      SUMMARY_FIELD,
    ],
  },
  {
    kind: 'forecast',
    icon: '◹',
    group: 'Insights',
    defaultStatus: 'modelling',
    actions: ['model', 'run', 'compare'],
    fields: [
      { name: 'horizon', render: 'stat', label: 'horizon', hint: 'How far forward this projects, e.g. "12 months", "8 quarters".' },
      CURRENCY_FIELD,
      { name: 'basis', render: 'stat', label: 'basis', hint: 'What the projection extends — "actuals to 2026-07", "budget FY27", "bottom-up pipeline". A forecast whose basis is unstated cannot be checked.' },
      { name: 'runwayMonths', render: 'stat', label: 'runwayMonths', hint: 'Months of cash remaining under the base scenario. The single number a founder opens this object for.' },
      {
        name: 'drivers',
        render: 'rows',
        label: 'drivers',
        columns: ['driver', 'value', 'unit', 'appliesTo'],
        hint: 'The INPUTS the model is sensitive to: {driver, value, unit, appliesTo}. Growth rate, churn, headcount adds, ACV, gross margin. A scenario changes these, so anything a scenario needs to move must appear here.',
      },
      {
        name: 'scenarios',
        render: 'rows',
        label: 'scenarios',
        columns: ['scenario', 'change', 'runwayMonths', 'endingCash', 'verdict'],
        hint: 'One row per scenario: {scenario, change, runwayMonths, endingCash, verdict}. `change` names which driver moved and to what ("churn 2%→4%"). Always include a DOWNSIDE — a forecast with only a base and an upside is a pitch, not a plan.',
      },
      { name: 'periods', render: 'rows', label: 'periods', columns: ['period', 'revenue', 'costs', 'netCash', 'closingCash'], hint: 'The projected series, one row per period: {period, revenue, costs, netCash, closingCash}. Plain numbers in the object currency.' },
      SUMMARY_FIELD,
    ],
  },
  {
    kind: 'invoice',
    icon: '↙',
    group: 'Work',
    defaultStatus: 'draft',
    actions: ['issue', 'record-payment', 'chase'],
    fields: [
      { name: 'customer', render: 'stat', label: 'customer', hint: 'The legal name of the party that owes this. Match it to a `company`, `salesContact` or `contract` on the board where one exists.' },
      { name: 'invoiceNumber', render: 'stat', label: 'invoiceNumber', hint: 'Your own reference for it.' },
      CURRENCY_FIELD,
      { name: 'amount', render: 'stat', label: 'amount', hint: `${EXACT_MONEY_HINT} The total payable including tax.` },
      { name: 'issuedAt', render: 'stat', label: 'issuedAt', hint: 'ISO date it was issued.' },
      { name: 'dueAt', render: 'stat', label: 'dueAt', hint: 'ISO date payment is due. This is the field that makes an invoice something the board can warn about, so an invoice without it cannot age. Bind a `trigger` with comparator "overdue-by" to have the board chase it.', deadline: true },
      { name: 'paidAmount', render: 'stat', label: 'paidAmount', hint: `${EXACT_MONEY_HINT} How much has actually landed. Part payment is the normal case, so this is not a boolean.` },
      { name: 'ageingDays', render: 'stat', label: 'ageingDays', hint: 'Days past due. Computed from `dueAt` — never authored, because a stale ageing is worse than none.', bookkeeping: true },
      { name: 'lineItems', render: 'rows', label: 'lineItems', columns: ['description', 'quantity', 'unitPrice', 'amount'], hint: 'One row per billed item: {description, quantity, unitPrice, amount}. Plain numbers in the object currency.' },
      { name: 'collection', render: 'list', label: 'collection', hint: 'What has actually been done to collect it: [{title, detail}] with a date in each detail. Collections work with no record is collections work that gets done twice or not at all.' },
      SUMMARY_FIELD,
    ],
  },
  {
    kind: 'bill',
    icon: '↗',
    group: 'Work',
    defaultStatus: 'received',
    actions: ['approve', 'schedule-payment', 'dispute'],
    fields: [
      { name: 'vendor', render: 'stat', label: 'vendor', hint: 'The legal name of the party owed. Match it to a `contract` on the board where one exists — a bill without its contract cannot be checked against what was agreed.' },
      { name: 'reference', render: 'stat', label: 'reference', hint: "The vendor's own invoice reference." },
      CURRENCY_FIELD,
      { name: 'amount', render: 'stat', label: 'amount', hint: `${EXACT_MONEY_HINT} The total payable including tax.` },
      { name: 'dueAt', render: 'stat', label: 'dueAt', hint: 'ISO date payment is due. Bind a `trigger` with comparator "due-within" so a payment run is prepared before the date, not after it.', deadline: true },
      { name: 'category', render: 'stat', label: 'category', hint: 'Which budget line this lands on. This is what connects a bill to a `budget` — an uncategorised bill cannot appear in a variance.' },
      { name: 'approvedBy', render: 'stat', label: 'approvedBy', hint: 'Who authorised it. Never fill this in on the requester\'s behalf: an approval nobody gave is the one field on this object that can cause real harm.', bookkeeping: true },
      { name: 'recurring', render: 'stat', label: 'recurring', hint: 'none | monthly | quarterly | annual. A recurring bill is a committed cost and belongs in the forecast, not just in this month.' },
      { name: 'risks', render: 'chips', label: 'risks', hint: 'Anything worth a second look — an unexpected increase, an auto-renewal, a charge with no matching contract, a duplicate.' },
      SUMMARY_FIELD,
    ],
  },
  // ── The paper ─────────────────────────────────────────────────────────────────
  {
    kind: 'contract',
    icon: '✎',
    group: 'Knowledge',
    defaultStatus: 'draft',
    actions: ['review', 'sign'],
    fields: [
      { name: 'counterparty', render: 'stat', label: 'counterparty', hint: 'The legal name of the other party.' },
      { name: 'contractType', render: 'stat', label: 'contractType', hint: 'msa | sow | nda | employment | vendor | formation.' },
      { name: 'effectiveAt', render: 'stat', label: 'effectiveAt', hint: 'ISO start date.' },
      { name: 'renewsAt', render: 'stat', label: 'renewsAt', hint: 'ISO renewal or expiry date — the field that makes a contract something the board can warn about. Bind a `trigger` with comparator "due-within" to be told before an auto-renewal rather than after it.', deadline: true },
      { name: 'valueAmount', render: 'stat', label: 'valueAmount', hint: MONEY_HINT },
      { name: 'obligations', render: 'rows', label: 'obligations', columns: ['obligation', 'owner', 'due'], hint: 'What this commits us to: {obligation, owner, due}. The reason to hold a contract on a board rather than in a drive.' },
      { name: 'risks', render: 'chips', label: 'risks', hint: 'Clauses worth a second look — auto-renewal, unlimited liability, exclusivity, IP assignment.' },
      SUMMARY_FIELD,
    ],
  },
];

const SPEC_BY_KIND: ReadonlyMap<string, FounderObjectSpec> = new Map(
  FOUNDER_OBJECT_SPECS.map((spec) => [spec.kind, spec]),
);

export function founderObjectSpec(kind: string): FounderObjectSpec | null {
  return SPEC_BY_KIND.get(kind) ?? null;
}

/**
 * Every field name any founder object owns, deduplicated.
 *
 * The registry folds this into `CONTEXT_FIELDS` so a founder field is readable by Brain
 * the moment it is declared — closing, for these kinds, exactly the drift that left a
 * KPI's `value` authorable and invisible.
 */
export const FOUNDER_FIELD_NAMES: readonly string[] = [
  ...new Set(FOUNDER_OBJECT_SPECS.flatMap((spec) => spec.fields.map((field) => field.name))),
];

/**
 * Founder fields that are bookkeeping rather than work.
 *
 * Folded into the registry's `NON_SUBSTANTIVE_FIELDS` so the empty-shell rule reads them
 * correctly: a `trigger` whose only populated field is `state`, or a `metric` carrying
 * only `series` and `fetchedAt`, was written by the evaluator or the refresh — not
 * authored — and must still count as a shell that hands the work back.
 */
export const FOUNDER_BOOKKEEPING_FIELDS: readonly string[] = [
  ...new Set(FOUNDER_OBJECT_SPECS.flatMap((spec) => spec.fields.filter((field) => field.bookkeeping).map((field) => field.name))),
];

/** The authorable fields for one founder kind, in declaration order. */
export function founderMutableFields(kind: FounderObjectKind): readonly string[] {
  const spec = SPEC_BY_KIND.get(kind);
  return spec ? ['content', ...spec.fields.map((field) => field.name)] : ['content'];
}

/**
 * Model-facing documentation for one founder kind: what each field is and what good
 * content looks like. Injected into `canvas_add_object`'s description so the model is
 * told the shape at the moment it authors one, rather than in a prompt paragraph that
 * drifts from the registry.
 */
export function founderFieldGuidance(kind: FounderObjectKind): string {
  const spec = SPEC_BY_KIND.get(kind);
  if (!spec) return '';
  const lines = spec.fields.map((field) => {
    const columns = field.columns ? ` Columns: ${field.columns.join(', ')}.` : '';
    return `• ${field.name} — ${field.hint}${columns}`;
  });
  return `${spec.kind}:\n${lines.join('\n')}`;
}

/** Guidance for every founder kind, for the one place the whole vocabulary is taught. */
export function allFounderFieldGuidance(): string {
  return FOUNDER_OBJECT_SPECS.map((spec) => founderFieldGuidance(spec.kind)).join('\n\n');
}

/**
 * Register this vocabulary with the shared spec-object primitive.
 *
 * The mechanism this file invented is now `lib/specObjects.ts`, because a second
 * vocabulary needed it (the academic objects) and "add a founder spec for a doctoral
 * thesis" is not a sentence anyone should have to write. Registering here means ONE
 * node body renders both sets, and the derivations above stay as the founder-specific
 * names their existing callers use.
 *
 * The namespace is unchanged, so no message key moves: each vocabulary owns its own
 * terms, which is the ubiquitous-language rule applied to the catalogs.
 */
registerSpecObjectSet({
  id: 'founder',
  namespace: 'creationCanvas.founder',
  specs: FOUNDER_OBJECT_SPECS,
});
