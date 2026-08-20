/**
 * AI-Powered Queries — deterministic natural-language → safe metric mapping.
 *
 * A question NEVER becomes SQL. {@link parseIntent} maps the question to ONE
 * whitelisted {@link METRIC_REGISTRY} key + a time window using keyword matching.
 * This mapper is fully standalone — the feature is functional with NO LLM wired.
 *
 * ── THE LLM REFINEMENT (AIIMP-3) ────────────────────────────────────────────
 * The keyword rules cover the phrasings we anticipated; a question they do not
 * recognise used to fall through to `finance.spend` and answer CONFIDENTLY about
 * spend. "How is uptime looking?" returned a dollar figure. That is worse than
 * refusing, because nothing in the response said the question had not been
 * understood.
 *
 * So the parse now reports whether it MATCHED or defaulted, and an optional
 * gateway LLM is consulted only in the defaulted case. Three properties make it
 * safe to add:
 *
 *   1. IT CANNOT WIDEN THE SURFACE. The model returns a metric KEY, which is
 *      validated against {@link isMetricKey} before use. An invented key, prose,
 *      an injected instruction — all fail the same check and are discarded. The
 *      question never becomes a query; it selects from a fixed list, exactly as
 *      the keyword rules do.
 *   2. IT IS NEVER ON THE CRITICAL PATH. No refiner, an error, a timeout, an
 *      unusable answer — every one of them keeps the deterministic result. The
 *      feature works with no LLM wired, which is how it shipped.
 *   3. IT COSTS NOTHING ON THE HAPPY PATH. A question the keywords match never
 *      reaches it.
 *
 * {@link answerQuery} then resolves the matched key through the registry and
 * returns a structured, explainable answer that names how the metric was chosen.
 */

import type { Db } from '../../infrastructure/database/connection';
import { METRIC_REGISTRY, isMetricKey, listMetricKeys } from './metricRegistry';
import { reportCaughtError } from '../observability/caughtErrorReporter';

/** How the metric was chosen — reported so a guess is never read as a match. */
export type IntentSource = 'keyword' | 'llm' | 'default';

export interface Intent {
  metricKey: string;
  days: number;
  source: IntentSource;
}

/**
 * A constrained refiner: given the question and the allowed keys, return ONE of
 * those keys, or anything else to decline. Returning junk is not an error case
 * to handle — it is the ordinary way to decline, and it is discarded by the same
 * validation that discards a hallucinated key.
 */
export type IntentRefiner = (question: string, allowedKeys: string[]) => Promise<string | null>;

export interface QueryAnswer {
  matchedMetric: string;
  label: string;
  value: number | null;
  unit: string;
  days: number;
  explanation: string;
  /**
   * How `matchedMetric` was chosen. 'default' means the question was NOT
   * understood and the answer is about the fallback metric — the UI says so
   * rather than presenting it as the answer to what was asked.
   */
  source: IntentSource;
}

/** Default window when the question names no period. */
const DEFAULT_DAYS = 30;

/**
 * Keyword → metric-key rules, evaluated IN ORDER (first match wins). Each rule is
 * an AND of `all` terms plus an OR of `any` terms, so e.g. "merge rate" beats the
 * bare "rate" of change-failure. Terms are matched against the lowercased question.
 */
interface Rule {
  metricKey: string;
  all?: string[];
  any?: string[];
}

const RULES: Rule[] = [
  // Finance — order matters: "cost per" / "forecast" before bare "spend".
  { metricKey: 'finance.costPerMergedPr', any: ['cost per merged', 'cost per pr', 'cost per merge', 'cost per ticket'] },
  { metricKey: 'finance.forecast', all: ['forecast'] },
  { metricKey: 'finance.forecast', any: ['projected spend', 'month-end', 'month end'] },
  { metricKey: 'finance.spend', any: ['spend', 'cost', 'how much are we spending', 'budget', 'bill', 'dollars', 'money'] },

  // DORA.
  { metricKey: 'dora.deployFreq', any: ['deploy frequency', 'deployment frequency', 'deploys per day', 'how often do we deploy', 'release frequency', 'deploy rate'] },
  { metricKey: 'dora.leadTime', any: ['lead time', 'cycle time', 'how long to ship', 'time to ship', 'delivery time'] },
  { metricKey: 'dora.changeFailureRate', any: ['change failure', 'failure rate', 'failed deploy', 'broken deploy', 'cfr'] },

  // Engineering effectiveness — "merge rate" must beat the generic "rate".
  { metricKey: 'engineering.mergeRate', any: ['merge rate', 'merged rate', 'pr merge', 'how many prs merge', 'merge ratio'] },
  { metricKey: 'engineering.avgScore', any: ['run score', 'run quality', 'outcome score', 'effectiveness score', 'ai quality'] },

  // AI impact.
  { metricKey: 'aiImpact.productivity', any: ['productivity', 'ai impact', 'ai effectiveness', 'how effective', 'productivity score'] },

  // Allocation / capex.
  { metricKey: 'allocation.capexPct', any: ['capex', 'capitaliz', 'capitalis', 'capitalizable'] },

  // Reliability / quality. These rules cover registry keys the rule list never
  // reached: every question about uptime, incidents, attrition, tokens or alerts
  // fell through to `finance.spend` and was answered — confidently — with a
  // dollar figure. Ordered after the finance rules on purpose: "incident cost" is
  // a spend question, "how many incidents" is not.
  { metricKey: 'quality.uptime', any: ['uptime', 'availability', 'downtime', 'sla'] },
  { metricKey: 'quality.mttr', any: ['mttr', 'time to restore', 'time to recover', 'recovery time', 'restore time'] },
  { metricKey: 'quality.incidents', any: ['incident', 'outage', 'sev1', 'sev 1', 'pager'] },
  { metricKey: 'quality.errorEvents', any: ['error event', 'errors', 'exception', 'crash', 'error volume'] },

  // People.
  { metricKey: 'people.attrition', any: ['attrition', 'turnover', 'people leaving', 'retention'] },
  { metricKey: 'people.devSatisfaction', any: ['satisfaction', 'morale', 'happiness', 'enps', 'how do people feel', 'developer experience', 'devex'] },

  // Platform consumption.
  { metricKey: 'delivery.agentRuns', any: ['agent run', 'how many runs', 'run volume', 'runs per'] },
  { metricKey: 'ai.tokens', any: ['token', 'context usage', 'tokens used'] },
  { metricKey: 'alerts.fires', any: ['alert', 'alerts fired', 'how many alerts'] },

  // R&D.
  { metricKey: 'rdFinancials.rdToRevenue', any: ['r&d to revenue', 'rd to revenue', 'r&d ratio', 'research spend ratio'] },
];

/**
 * Parse a time window from the question. Recognizes "today", "yesterday",
 * "last/past N day(s)/week(s)/month(s)/quarter(s)/year", and bare "week/month/
 * quarter/year". Falls back to {@link DEFAULT_DAYS}. Clamped to [1, 365].
 */
export function parseDays(question: string): number {
  const q = question.toLowerCase();

  if (/\btoday\b/.test(q)) return 1;
  if (/\byesterday\b/.test(q)) return 1;

  // "last/past N <unit>".
  const m = q.match(/\b(?:last|past|previous|trailing)?\s*(\d{1,3})\s*(day|week|month|quarter|year)s?\b/);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2];
    const mult = unit === 'day' ? 1 : unit === 'week' ? 7 : unit === 'month' ? 30 : unit === 'quarter' ? 90 : 365;
    return clampDays(n * mult);
  }

  // Bare unit words ("this week", "last month", "this quarter", "this year").
  if (/\b(week|weekly|last week|this week)\b/.test(q)) return 7;
  if (/\b(quarter|quarterly|qtd|this quarter|last quarter)\b/.test(q)) return 90;
  if (/\b(year|yearly|annual|ytd|this year|last year)\b/.test(q)) return 365;
  if (/\b(month|monthly|mtd|this month|last month)\b/.test(q)) return 30;

  return DEFAULT_DAYS;
}

function clampDays(n: number): number {
  if (!Number.isFinite(n) || n < 1) return DEFAULT_DAYS;
  return Math.min(365, Math.floor(n));
}

/** The metric a question falls back to when nothing recognises it. */
export const DEFAULT_METRIC_KEY = 'finance.spend';

/**
 * Deterministic intent: map the question to a whitelisted metric key + window.
 * Falls back to {@link DEFAULT_METRIC_KEY} when nothing matches, so the feature
 * always returns a real, answerable result — but reports `source: 'default'` so
 * the caller knows the question was not understood rather than answered.
 */
export function parseIntent(question: string): Intent {
  const q = (question || '').toLowerCase();
  const days = parseDays(q);

  for (const rule of RULES) {
    const allOk = !rule.all || rule.all.every((t) => q.includes(t));
    const anyOk = !rule.any || rule.any.some((t) => q.includes(t));
    if (allOk && anyOk && isMetricKey(rule.metricKey)) {
      return { metricKey: rule.metricKey, days, source: 'keyword' };
    }
  }

  return { metricKey: DEFAULT_METRIC_KEY, days, source: 'default' };
}

/**
 * Give an unmatched question one more chance, through a refiner that may ONLY
 * return a whitelisted key.
 *
 * Every escape route lands on the deterministic intent: a matched question skips
 * the refiner entirely, and an absent / throwing / declining / hallucinating
 * refiner is indistinguishable from having none. That is what keeps this an
 * enhancement rather than a dependency — the property the original mapper was
 * written to have and this must not spend.
 */
export async function refineIntent(intent: Intent, question: string, refiner?: IntentRefiner): Promise<Intent> {
  if (!refiner || intent.source !== 'default') return intent;
  try {
    const picked = (await refiner(question, listMetricKeys()))?.trim();
    // THE GATE. Whatever came back is a candidate string and nothing more: it is
    // a metric key only if the registry says so. Prose, an invented key, or an
    // instruction smuggled through the question all fail here identically.
    if (picked && isMetricKey(picked)) return { ...intent, metricKey: picked, source: 'llm' };
  } catch (error) {
    // A refiner failure is not a query failure — the deterministic answer stands.
    // Reported rather than swallowed so a refiner that is failing EVERY question
    // is visible; silently degrading to the keyword parse would look identical to
    // a model that simply never had a better answer.
    reportCaughtError(error, {
      source: 'application/dashboards/nlQuery.ts',
      operation: 'refineIntent',
      context: { logMessage: '[nl-query] intent refinement failed; keeping the keyword parse' },
    });
  }
  return intent;
}

/**
 * Format a resolved value for the explanation sentence.
 *
 * Exported because the COMPOSED answer ({@link ../dashboards/answerComposer})
 * writes sentences out of the same figures. A second formatter would drift — the
 * composed narrative would say "4.1 hours" while the metric reading beside it in
 * the same card said "4 hours", and the reader would rightly stop trusting both.
 */
export function formatMetricValue(value: number | null, unit: string): string {
  if (value == null) return 'no data yet';
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 100) / 100;
  if (unit === 'USD') return `$${rounded.toLocaleString('en-US')}`;
  if (unit === '%') return `${rounded}%`;
  if (unit === '/day') return `${rounded} per day`;
  if (unit === 'hours') return `${rounded} hours`;
  if (unit === 'score') return `${rounded}`;
  return `${rounded}`;
}

/**
 * A read-through cache hook for the registry's compute paths.
 *
 * The metric computes are the expensive part of an answer — each one runs a
 * windowed insight collector — and a COMPOSED answer resolves four or five of
 * them for one question. The caller (the route) supplies the canonical
 * `getOrSetCached` bound to its `env`; this layer never reaches for infrastructure
 * itself, and never grows a private Map+TTL of its own, so one cache and one
 * invalidation story covers both `/dashboards/:id/data` and the Ask box.
 *
 * Absent (tests, non-Worker callers) → the loader runs directly.
 */
export type MetricCache = <T>(key: string, loader: () => Promise<T>) => Promise<T>;

/** The cache key the dashboard data route already uses — same shape, same entries. */
export function metricCacheKey(tenantId: number, metricKey: string, days: number): string {
  return `dashboards:metric:t:${tenantId}:k:${metricKey}:d:${days}`;
}

/**
 * Resolve ONE whitelisted key into the structured reading, cache included.
 *
 * Shared by the single-metric answer and by every metric inside a composed one, so
 * a figure reads identically whichever path produced it — the drift this exists to
 * prevent is a composed answer whose numbers disagree with the same question asked
 * on its own.
 */
export async function readMetric(
  db: Db,
  tenantId: number,
  metricKey: string,
  days: number,
  source: IntentSource,
  cache?: MetricCache,
): Promise<QueryAnswer> {
  const def = METRIC_REGISTRY[metricKey];
  if (!def) {
    return { matchedMetric: metricKey, label: metricKey, value: null, unit: '', days, explanation: `No metric is registered for "${metricKey}".`, source };
  }
  const compute = () => def.compute(db, tenantId, days);
  const value = cache ? await cache(metricCacheKey(tenantId, metricKey, days), compute) : await compute();

  const reading = value == null
    ? `${def.label}: no data for the last ${days} days. ${def.description}`
    : `${def.label} over the last ${days} days is ${formatMetricValue(value, def.unit)}. ${def.description}`;

  // A defaulted match SAYS it defaulted. The old sentence read identically whether
  // the question had been understood or silently replaced with "spend", which made
  // an unanswered question look like an answered one.
  const explanation = source === 'default'
    ? `I could not tell which metric that question is about, so this is ${def.label}, the default. ${reading}`
    : reading;

  return { matchedMetric: metricKey, label: def.label, value, unit: def.unit, days, explanation, source };
}

/**
 * Answer a natural-language question: parse intent, resolve the whitelisted metric
 * through the registry, and return a structured + human-readable result. Never runs
 * SQL from the question — only the registry's pre-declared compute path.
 */
export async function answerQuery(
  db: Db,
  tenantId: number,
  question: string,
  refiner?: IntentRefiner,
  cache?: MetricCache,
): Promise<QueryAnswer> {
  const { metricKey, days, source } = await refineIntent(parseIntent(question), question, refiner);
  return readMetric(db, tenantId, metricKey, days, source, cache);
}
