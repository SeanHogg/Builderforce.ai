/**
 * Composed answers — turning "how are things looking?" into a situation, not a scalar.
 *
 * ── THE GAP THIS CLOSES ─────────────────────────────────────────────────────
 * {@link answerQuery} maps a question to ONE whitelisted metric. That is exactly
 * right for "how much are we spending?" and useless for the questions people
 * actually type into a box that says "ask a question": "give me a summary of how
 * things are looking", "are we behind?", "how are we doing on cost?". Those have
 * no single metric, so the keyword rules never matched them, so they fell to the
 * default and came back as a dollar figure with a disclaimer. The box worked and
 * answered nothing.
 *
 * A composed answer resolves a TOPIC — a small, closed set of situations — into an
 * ORDERED list of whitelisted metric keys plus the registry widgets that draw
 * them, and writes a headline and a narrative out of the figures it actually got
 * back. So the answer is a small dashboard: a sentence that names its own numbers,
 * the readings behind it, and the charts.
 *
 * ── THE SAFETY PROPERTIES ARE THE SAME THREE ────────────────────────────────
 * The topic classifier is keyword-first, in the same shape as `nlQuery`'s RULES,
 * and the optional gateway refiner keeps every property that mapper was written
 * to have:
 *
 *   1. IT CANNOT WIDEN THE SURFACE. The refiner's reply is a candidate string and
 *      nothing more. It is a topic only if {@link toTopic} says so, and a metric
 *      only if the registry says so. A topic resolves to metric keys and widget
 *      ids that were declared HERE, in source, before the question existed — so a
 *      model cannot name a metric, a widget, or a topic that does not exist, and
 *      the question never becomes a query.
 *   2. IT IS NEVER ON THE CRITICAL PATH. A recognised question never reaches it;
 *      an absent, throwing, declining or hallucinating refiner is indistinguishable
 *      from having none, and the deterministic answer stands in every case.
 *   3. IT COSTS NOTHING ON THE HAPPY PATH — and it is now ONE call rather than
 *      two, because topics and metric keys are offered to it in a single closed
 *      list and separated on the way back by the same gate.
 *
 * ── WHY THE NARRATIVE IS ASSEMBLED, NOT GENERATED ───────────────────────────
 * The headline is built by deterministic string assembly from the resolved
 * figures and names each number it used. A generated summary would be the one
 * part of this feature that could state a number the system never computed, which
 * is the single failure a metrics surface cannot survive.
 */

import type { Db } from '../../infrastructure/database/connection';
import { isMetricKey, listMetricKeys, METRIC_REGISTRY } from './metricRegistry';
import {
  DEFAULT_METRIC_KEY,
  formatMetricValue,
  parseDays,
  parseIntent,
  readMetric,
  type IntentRefiner,
  type IntentSource,
  type MetricCache,
  type QueryAnswer,
} from './nlQuery';
import { COMPOSABLE_WIDGET_IDS, type ComposableWidgetId } from './widgetIds';
import { reportCaughtError } from '../observability/caughtErrorReporter';

/**
 * THE CLOSED SET. A question resolves to one of these or to the single-metric
 * path — there is no third outcome, and nothing (keyword rule, model, request
 * body) can introduce a topic that is not on this list.
 *
 * `metric` is the escape hatch that keeps the original behaviour intact: a
 * question the topic rules do not recognise but the metric rules DO is answered
 * exactly as it always was, wrapped in the composed envelope.
 */
export const ANSWER_TOPICS = [
  'overview',
  'delivery',
  'cost',
  'reliability',
  'people',
  'workforce.health',
  'ai',
] as const;

export type AnswerTopic = (typeof ANSWER_TOPICS)[number];
/** The topic of an answer that resolved through the single-metric path instead. */
export type ComposedTopic = AnswerTopic | 'metric';

/**
 * What a topic renders: whitelisted metric keys (ordered — the first is the one
 * the headline leads on) and the registry widgets that draw them.
 *
 * The widget ids are typed as {@link ComposableWidgetId}, so a topic cannot name a
 * card the frontend test does not cover.
 */
export interface TopicSpec {
  /** Ordered metric keys, all from {@link METRIC_REGISTRY}. Index 0 leads the headline. */
  metricKeys: string[];
  /** Registry widget ids to render beneath the readings. */
  widgetIds: ComposableWidgetId[];
  /** The subject the headline opens with ("Delivery", "Cost"). */
  subject: string;
}

/**
 * Topic → what to show. Every key here is asserted against the registry (and every
 * widget id against the frontend registry) by test, so this table cannot quietly
 * name something that stopped existing.
 */
export const TOPIC_SPECS: Record<AnswerTopic, TopicSpec> = {
  overview: {
    subject: 'Overall',
    metricKeys: ['delivery.agentRuns', 'engineering.mergeRate', 'finance.spend', 'quality.incidents'],
    widgetIds: ['delivery.verdict', 'ai-impact.merge-rate', 'finance.spend-trend', 'inc.status'],
  },
  delivery: {
    subject: 'Delivery',
    metricKeys: ['dora.leadTime', 'dora.deployFreq', 'dora.changeFailureRate', 'delivery.agentRuns'],
    widgetIds: ['delivery.verdict', 'dora.lead-time', 'dora.deploy-freq', 'delivery.velocity-trend'],
  },
  cost: {
    subject: 'Cost',
    metricKeys: ['finance.spend', 'finance.forecast', 'finance.costPerMergedPr', 'ai.tokens'],
    widgetIds: ['finance.spend-trend', 'finance.forecast', 'finance.cost-per-pr', 'core.llm-tokens'],
  },
  reliability: {
    subject: 'Reliability',
    metricKeys: ['quality.incidents', 'quality.mttr', 'quality.uptime', 'quality.errorEvents'],
    widgetIds: ['inc.status', 'inc.mttr', 'obs.quality-resolution', 'obs.alert-fires'],
  },
  people: {
    subject: 'People',
    metricKeys: ['people.devSatisfaction', 'people.attrition'],
    widgetIds: ['emp.performer-tiers', 'emp.collab-score', 'wf.performance-by-discipline'],
  },
  'workforce.health': {
    subject: 'Workforce',
    metricKeys: ['people.overAllocated', 'people.underUtilised', 'people.idle'],
    widgetIds: ['workforce.health', 'emp.over-allocated', 'emp.performer-tiers'],
  },
  ai: {
    subject: 'AI',
    metricKeys: ['aiImpact.productivity', 'engineering.mergeRate', 'engineering.avgScore', 'ai.tokens'],
    widgetIds: ['ai-impact.productivity', 'ai-impact.merge-rate', 'ai-impact.quality', 'core.llm-tokens'],
  },
};

/**
 * Widgets worth drawing beside a SINGLE-metric answer.
 *
 * A scalar with a chart under it is a better answer than a scalar, and these are
 * the pairings that are obvious enough to hard-declare. A metric with no entry
 * renders as it always did — a number and a sentence — which is why this is a
 * partial map and not a required field on {@link METRIC_REGISTRY}.
 */
export const METRIC_WIDGET_HINTS: Partial<Record<string, ComposableWidgetId[]>> = {
  'finance.spend': ['finance.spend-trend'],
  'finance.forecast': ['finance.forecast'],
  'finance.costPerMergedPr': ['finance.cost-per-pr'],
  'dora.leadTime': ['dora.lead-time'],
  'dora.deployFreq': ['dora.deploy-freq'],
  'dora.changeFailureRate': ['dora.change-fail'],
  'engineering.mergeRate': ['ai-impact.merge-rate'],
  'engineering.avgScore': ['ai-impact.quality'],
  'aiImpact.productivity': ['ai-impact.productivity'],
  'quality.incidents': ['inc.status'],
  'quality.mttr': ['inc.mttr'],
  'quality.errorEvents': ['obs.quality-resolution'],
  'alerts.fires': ['obs.alert-fires'],
  'ai.tokens': ['core.llm-tokens'],
  'people.overAllocated': ['workforce.health', 'emp.over-allocated'],
  'people.underUtilised': ['workforce.health'],
  'people.idle': ['workforce.health'],
};

// ── Deterministic topic classification ───────────────────────────────────────

/**
 * Keyword → topic rules, evaluated IN ORDER (first match wins), in the same shape
 * as `nlQuery`'s RULES: an AND of `all` plus an OR of `any`, lowercased.
 *
 * ORDER IS LOAD-BEARING and runs narrow → broad. `workforce.health` precedes
 * `people` because "who is overworked" is a specific cohort question and "how is
 * morale" is not; `overview` runs LAST because its terms ("how are things", "how
 * are we doing") appear inside more specific questions too — "how are we doing on
 * cost" is a cost question, and would otherwise be swallowed by the summary rule.
 */
interface TopicRule {
  topic: AnswerTopic;
  all?: string[];
  any?: string[];
}

const TOPIC_RULES: TopicRule[] = [
  // Workforce health — the cohort question, before the general people rule.
  { topic: 'workforce.health', any: [
    'who is not working', 'who is idle', 'who is overworked', 'who is overloaded',
    'over-allocated', 'over allocated', 'overallocated', 'overloaded', 'underutilis', 'underutiliz',
    'under-utilis', 'under-utiliz', 'under utilis', 'under utiliz', 'spare capacity', 'who has capacity',
    'workforce health', 'bench', 'burnout', 'who is free', 'workload',
  ] },

  // Delivery — "are we behind?" is the question that started this.
  { topic: 'delivery', any: [
    'are we behind', 'behind on', 'behind schedule', 'at risk', 'at-risk', 'slipping', 'slip',
    'how is delivery', 'delivery health', 'shipping', 'are we on track', 'on track', 'throughput',
    'how fast are we', 'are we late', 'roadmap health',
  ] },

  // Cost — the topical form of the finance questions.
  { topic: 'cost', any: [
    'on cost', 'cost picture', 'how is cost', 'how are costs', 'cost health', 'burn rate', 'burn-rate',
    'how is spend', 'spend picture', 'financial health', 'are we overspending', 'overspending',
    'budget health', 'how is the budget', 'cost situation',
  ] },

  // Reliability — the situational form of the quality/incident questions.
  { topic: 'reliability', any: [
    'reliability', 'how stable', 'stability', 'are we down', 'is anything broken', 'anything broken',
    'do we have a breach', 'breach', 'how is production', 'production health', 'is prod healthy',
    'service health', 'are we healthy',
  ] },

  // AI — the situational form of the impact/effectiveness questions.
  { topic: 'ai', any: [
    'how is ai', 'how is the ai', 'ai health', 'are the agents working', 'how are the agents',
    'agent health', 'is ai working', 'ai situation', 'how effective are the agents',
  ] },

  // People — morale/retention, after the cohort rule above.
  { topic: 'people', any: [
    'how is the team', 'how is the team doing', 'team health', 'how are people', 'people health',
    'morale', 'are people happy', 'is the team ok', 'is the team okay',
  ] },

  // Overview — LAST. Broad summary phrasings only.
  { topic: 'overview', any: [
    'summary', 'summarise', 'summarize', 'overview', 'how are things', 'how are we doing',
    'how is everything', 'state of play', 'the big picture', 'big picture', 'how is it going',
    'how are we looking', "how's it going", 'status update', 'brief me',
  ] },
];

/**
 * Deterministic topic classification. Returns null when NOTHING recognises the
 * question as situational — the caller then tries the single-metric path, and only
 * a question neither path recognises is worth spending a model call on.
 */
export function classifyTopic(question: string): AnswerTopic | null {
  const q = (question || '').toLowerCase();
  for (const rule of TOPIC_RULES) {
    const allOk = !rule.all || rule.all.every((t) => q.includes(t));
    const anyOk = !rule.any || rule.any.some((t) => q.includes(t));
    if (allOk && anyOk) return rule.topic;
  }
  return null;
}

/** The prefix that distinguishes a topic from a metric key in the refiner's list. */
const TOPIC_KEY_PREFIX = 'topic.';

/** The topic half of the refiner's allowed list (metric keys are the other half). */
export function listTopicKeys(): string[] {
  return ANSWER_TOPICS.map((t) => `${TOPIC_KEY_PREFIX}${t}`);
}

/**
 * THE GATE for topics. A candidate is a topic only if it is on {@link ANSWER_TOPICS};
 * prose, an invented topic, or an instruction smuggled through the question all
 * fail here identically. Accepts the bare topic or the prefixed key form.
 */
export function toTopic(candidate: string | null | undefined): AnswerTopic | null {
  const raw = (candidate ?? '').trim();
  const bare = raw.startsWith(TOPIC_KEY_PREFIX) ? raw.slice(TOPIC_KEY_PREFIX.length) : raw;
  return (ANSWER_TOPICS as readonly string[]).includes(bare) ? (bare as AnswerTopic) : null;
}

// ── The composed answer ──────────────────────────────────────────────────────

export interface ComposedAnswer {
  /** The situation this answers, or 'metric' for the single-metric path. */
  topic: ComposedTopic;
  /** One sentence, assembled from the resolved figures, naming the numbers it used. */
  headline: string;
  /** The supporting readings, joined — every number in it came back from a compute. */
  narrative: string;
  /** How the topic/metric was chosen: 'keyword' | 'llm' | 'default'. */
  source: IntentSource;
  /** The window every reading was taken over. */
  days: number;
  /** The resolved readings, in the topic's declared order. */
  metrics: QueryAnswer[];
  /** Registry widget ids to render beneath the readings. */
  widgetIds: string[];
}

export interface ComposeOptions {
  /** Optional gateway refiner — consulted ONLY when nothing deterministic matched. */
  refiner?: IntentRefiner;
  /** The route's `getOrSetCached`, bound to its env. Absent → computes run directly. */
  cache?: MetricCache;
}

/**
 * Answer a question as a SITUATION where one exists, and as a single metric where
 * it does not. Never runs SQL from the question: every value comes from a metric
 * key declared in the registry before the question was asked.
 */
export async function composeAnswer(
  db: Db,
  tenantId: number,
  question: string,
  opts: ComposeOptions = {},
): Promise<ComposedAnswer> {
  const days = parseDays(question);

  // 1. Deterministic topic. A recognised situation never reaches a model.
  const keywordTopic = classifyTopic(question);
  if (keywordTopic) return composeTopic(db, tenantId, keywordTopic, days, 'keyword', opts.cache);

  // 2. Deterministic single metric. Also free, also never reaches a model.
  const intent = parseIntent(question);
  if (intent.source !== 'default') {
    return composeMetric(db, tenantId, intent.metricKey, intent.days, intent.source, opts.cache);
  }

  // 3. Only now — nothing recognised the question at all — is the refiner worth a
  //    call, and it gets ONE, over a single closed list holding both halves.
  const picked = await refineUnrecognised(question, opts.refiner);
  const llmTopic = toTopic(picked);
  if (llmTopic) return composeTopic(db, tenantId, llmTopic, days, 'llm', opts.cache);
  if (picked && isMetricKey(picked)) return composeMetric(db, tenantId, picked, intent.days, 'llm', opts.cache);

  // 4. Nothing understood it. Answer the default metric and SAY the question was
  //    not understood — a defaulted answer dressed as a match is the failure the
  //    `source` field exists to prevent.
  return composeMetric(db, tenantId, DEFAULT_METRIC_KEY, intent.days, 'default', opts.cache);
}

/**
 * One refiner call, over topics AND metric keys. Every escape route lands on the
 * caller's deterministic result: no refiner, a throw, a decline, or an answer that
 * fails the gate are all indistinguishable from having no model wired.
 */
async function refineUnrecognised(question: string, refiner?: IntentRefiner): Promise<string | null> {
  if (!refiner) return null;
  try {
    return (await refiner(question, [...listTopicKeys(), ...listMetricKeys()]))?.trim() ?? null;
  } catch (error) {
    // Reported rather than swallowed: a refiner failing EVERY question would
    // otherwise look identical to a model that simply never had a better answer.
    reportCaughtError(error, {
      source: 'application/dashboards/answerComposer.ts',
      operation: 'refineUnrecognised',
      context: { logMessage: '[nl-query] composed refinement failed; keeping the deterministic answer' },
    });
    return null;
  }
}

/** Resolve a topic's declared metrics (concurrently, through the cache) and write it up. */
async function composeTopic(
  db: Db,
  tenantId: number,
  topic: AnswerTopic,
  days: number,
  source: IntentSource,
  cache?: MetricCache,
): Promise<ComposedAnswer> {
  const spec = TOPIC_SPECS[topic];
  const metrics = await Promise.all(
    spec.metricKeys.map((key) => readMetric(db, tenantId, key, days, source, cache)),
  );
  return {
    topic,
    headline: headlineFor(spec.subject, metrics, days),
    narrative: narrativeFor(metrics),
    source,
    days,
    metrics,
    widgetIds: [...spec.widgetIds],
  };
}

/** The single-metric path, wrapped in the composed envelope so ONE shape leaves the route. */
async function composeMetric(
  db: Db,
  tenantId: number,
  metricKey: string,
  days: number,
  source: IntentSource,
  cache?: MetricCache,
): Promise<ComposedAnswer> {
  const answer = await readMetric(db, tenantId, metricKey, days, source, cache);
  return {
    topic: 'metric',
    headline: headlineFor(answer.label, [answer], days),
    narrative: answer.explanation,
    source,
    days,
    metrics: [answer],
    widgetIds: [...(METRIC_WIDGET_HINTS[metricKey] ?? [])],
  };
}

// ── Deterministic composition ────────────────────────────────────────────────

/** "12 production incidents" — a reading in the form a sentence can hold. */
function phrase(m: QueryAnswer): string {
  return `${m.label.toLowerCase()} ${formatMetricValue(m.value, m.unit)}`;
}

/**
 * Is this reading worth leading on? A metric flagged `goodWhenUp: false` that came
 * back above zero is a cost the reader should hear first; everything else is
 * context. Nothing here invents a threshold the registry did not declare — the
 * only judgement is "is rising bad", which is a registry field.
 */
function isConcerning(m: QueryAnswer): boolean {
  const def = METRIC_REGISTRY[m.matchedMetric];
  return def?.goodWhenUp === false && m.value != null && m.value > 0;
}

/**
 * The headline, assembled — never generated.
 *
 * It names the figures it used, in the units the readings used, because a summary
 * sentence is the one place a metrics surface could state a number nothing
 * computed. Assembling it means the sentence cannot say anything the readings
 * beneath it do not.
 */
export function headlineFor(subject: string, metrics: QueryAnswer[], days: number): string {
  const known = metrics.filter((m) => m.value != null);
  if (known.length === 0) {
    return `${subject}: no data in the last ${days} days.`;
  }
  const concerning = known.filter(isConcerning);
  const lead = (concerning.length ? concerning : known).slice(0, 2).map(phrase);
  const verdict = concerning.length ? 'needs attention' : 'looks steady';
  return `${subject} ${verdict} over the last ${days} days: ${lead.join(', ')}.`;
}

/** Every reading, in the topic's order, as one paragraph. */
export function narrativeFor(metrics: QueryAnswer[]): string {
  return metrics.map((m) => m.explanation).join(' ');
}

/** Re-exported so a caller can assert against the same list the topics draw from. */
export { COMPOSABLE_WIDGET_IDS };
