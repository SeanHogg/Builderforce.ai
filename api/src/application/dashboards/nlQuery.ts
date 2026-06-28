/**
 * AI-Powered Queries — deterministic natural-language → safe metric mapping.
 *
 * A question NEVER becomes SQL. {@link parseIntent} maps the question to ONE
 * whitelisted {@link METRIC_REGISTRY} key + a time window using keyword matching.
 * This mapper is fully standalone — the feature is functional with NO LLM wired.
 * (A gateway LLM may LATER refine the parse, but only ever to pick another
 * whitelisted key; it can never widen the surface.)
 *
 * {@link answerQuery} then resolves the matched key through the registry and
 * returns a structured, explainable answer.
 */

import type { Db } from '../../infrastructure/database/connection';
import { METRIC_REGISTRY, isMetricKey } from './metricRegistry';

export interface Intent {
  metricKey: string;
  days: number;
}

export interface QueryAnswer {
  matchedMetric: string;
  label: string;
  value: number | null;
  unit: string;
  days: number;
  explanation: string;
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

/**
 * Deterministic intent: map the question to a whitelisted metric key + window.
 * Defaults to 'finance.spend' (the most-asked manager metric) when nothing else
 * matches, so the feature always returns a real, answerable result.
 */
export function parseIntent(question: string): Intent {
  const q = (question || '').toLowerCase();
  const days = parseDays(q);

  for (const rule of RULES) {
    const allOk = !rule.all || rule.all.every((t) => q.includes(t));
    const anyOk = !rule.any || rule.any.some((t) => q.includes(t));
    if (allOk && anyOk && isMetricKey(rule.metricKey)) {
      return { metricKey: rule.metricKey, days };
    }
  }

  return { metricKey: 'finance.spend', days };
}

/** Format a resolved value for the explanation sentence. */
function formatValue(value: number | null, unit: string): string {
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
 * Answer a natural-language question: parse intent, resolve the whitelisted metric
 * through the registry, and return a structured + human-readable result. Never runs
 * SQL from the question — only the registry's pre-declared compute path.
 */
export async function answerQuery(db: Db, tenantId: number, question: string): Promise<QueryAnswer> {
  const { metricKey, days } = parseIntent(question);
  const def = METRIC_REGISTRY[metricKey];
  if (!def) {
    return { matchedMetric: metricKey, label: metricKey, value: null, unit: '', days, explanation: `No metric is registered for "${metricKey}".` };
  }
  const value = await def.compute(db, tenantId, days);

  const explanation = value == null
    ? `${def.label}: no data for the last ${days} days. ${def.description}`
    : `${def.label} over the last ${days} days is ${formatValue(value, def.unit)}. ${def.description}`;

  return { matchedMetric: metricKey, label: def.label, value, unit: def.unit, days, explanation };
}
