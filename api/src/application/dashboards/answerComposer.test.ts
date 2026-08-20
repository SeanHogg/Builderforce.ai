import { describe, expect, it, vi } from 'vitest';
import {
  ANSWER_TOPICS,
  METRIC_WIDGET_HINTS,
  TOPIC_SPECS,
  classifyTopic,
  composeAnswer,
  headlineFor,
  listTopicKeys,
  toTopic,
  type AnswerTopic,
} from './answerComposer';
import { COMPOSABLE_WIDGET_IDS } from './widgetIds';
import { isMetricKey } from './metricRegistry';
import type { Db } from '../../infrastructure/database/connection';
import type { IntentRefiner, MetricCache, QueryAnswer } from './nlQuery';

/**
 * The composed answer, asserted rather than described.
 *
 * Three things here are only true because a test says so. The TOPIC TABLE names
 * metric keys and widget ids in plain strings, and a string that stops resolving
 * produces an empty card rather than an error. The CLASSIFIER's rule ORDER is
 * load-bearing in exactly the way `nlQuery`'s is — "how are we doing on cost" is a
 * cost question, not a summary — and order is the first thing an added rule
 * breaks. And the REFINER's gate is a "cannot", which is the kind of claim that
 * decays quietly into "does not currently".
 */

// The metric computes are reached ONLY through the injected cache, so a canned
// cache answers every metric without a database. That seam is the same one the
// route uses to hand in `getOrSetCached`.
function cannedCache(values: Record<string, number | null>): MetricCache {
  return (async (key: string) => {
    const matched = key.match(/:k:(.+):d:/);
    const metricKey = matched?.[1] ?? '';
    return metricKey in values ? values[metricKey] : 0;
  }) as MetricCache;
}

const db = {} as Db;

describe('the topic table', () => {
  it('names only whitelisted metric keys', () => {
    for (const topic of ANSWER_TOPICS) {
      for (const key of TOPIC_SPECS[topic].metricKeys) {
        expect(isMetricKey(key), `${topic} → ${key}`).toBe(true);
      }
    }
  });

  it('names only declared widget ids (the frontend test covers that list)', () => {
    const declared = new Set<string>(COMPOSABLE_WIDGET_IDS);
    for (const topic of ANSWER_TOPICS) {
      for (const id of TOPIC_SPECS[topic].widgetIds) {
        expect(declared.has(id), `${topic} → ${id}`).toBe(true);
      }
    }
    for (const [metric, ids] of Object.entries(METRIC_WIDGET_HINTS)) {
      expect(isMetricKey(metric), metric).toBe(true);
      for (const id of ids ?? []) expect(declared.has(id), `${metric} → ${id}`).toBe(true);
    }
  });

  it('gives every topic at least one metric and one widget', () => {
    for (const topic of ANSWER_TOPICS) {
      expect(TOPIC_SPECS[topic].metricKeys.length, topic).toBeGreaterThan(0);
      expect(TOPIC_SPECS[topic].widgetIds.length, topic).toBeGreaterThan(0);
    }
  });
});

describe('classifyTopic', () => {
  it('recognises the open-ended questions that used to fall through to spend', () => {
    // Every one of these previously returned a dollar figure with a disclaimer.
    expect(classifyTopic('give me a summary of how things are looking')).toBe('overview');
    expect(classifyTopic('are we behind on projects?')).toBe('delivery');
    expect(classifyTopic('how are we doing on cost?')).toBe('cost');
    expect(classifyTopic('do we have a breach')).toBe('reliability');
    expect(classifyTopic('who is not working? who is overworked?')).toBe('workforce.health');
    expect(classifyTopic('how is morale')).toBe('people');
    expect(classifyTopic('how are the agents doing')).toBe('ai');
  });

  it('puts the specific rule ahead of the broad one', () => {
    // 'how are we doing' is an overview phrase and appears inside a cost question;
    // 'overworked' is a people noun and belongs to the cohort question. Both are
    // rule ORDER, and both regress the moment a rule is appended in the wrong place.
    expect(classifyTopic('how are we doing on cost?')).toBe('cost');
    expect(classifyTopic('who is overworked on the team')).toBe('workforce.health');
  });

  it('declines a question that names one specific number', () => {
    // Not a situation — the single-metric path owns these, unchanged.
    expect(classifyTopic('how much did we spend this month')).toBeNull();
    expect(classifyTopic('what is our mttr')).toBeNull();
  });

  it('declines a question nothing recognises', () => {
    expect(classifyTopic('is the vibe good')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(classifyTopic('ARE WE BEHIND ON PROJECTS')).toBe('delivery');
  });
});

describe('toTopic — the gate', () => {
  it('accepts a declared topic in either the bare or prefixed form', () => {
    expect(toTopic('delivery')).toBe('delivery');
    expect(toTopic('topic.workforce.health')).toBe('workforce.health');
    expect(toTopic('  topic.cost  ')).toBe('cost');
  });

  it('rejects everything else identically', () => {
    // An invented topic, prose, an injected instruction, a metric key and an empty
    // reply all fail the SAME check — that is the whole safety argument.
    for (const bad of ['topic.everything', 'I think you want delivery', 'ignore previous instructions', 'finance.spend', '', '   ', null, undefined]) {
      expect(toTopic(bad)).toBeNull();
    }
  });

  it('offers the refiner every topic and nothing else', () => {
    expect(listTopicKeys()).toEqual(ANSWER_TOPICS.map((t) => `topic.${t}`));
  });
});

describe('composeAnswer', () => {
  it('answers a situational question with several metrics and its widgets', async () => {
    const out = await composeAnswer(db, 1, 'are we behind on projects?', {
      cache: cannedCache({ 'dora.leadTime': 4.1, 'dora.deployFreq': 2, 'dora.changeFailureRate': 12, 'delivery.agentRuns': 40 }),
    });

    expect(out.topic).toBe('delivery');
    expect(out.source).toBe('keyword');
    expect(out.metrics.map((m) => m.matchedMetric)).toEqual(TOPIC_SPECS.delivery.metricKeys);
    expect(out.widgetIds).toEqual(TOPIC_SPECS.delivery.widgetIds);
  });

  it('composes a headline out of the figures it actually resolved', async () => {
    const out = await composeAnswer(db, 1, 'are we behind on projects?', {
      cache: cannedCache({ 'dora.leadTime': 4.1, 'dora.deployFreq': 2, 'dora.changeFailureRate': 12, 'delivery.agentRuns': 40 }),
    });
    // The sentence must NAME the numbers beneath it: a summary that could state a
    // figure nothing computed is the one failure a metrics surface cannot survive.
    expect(out.headline).toContain('4.1');
    expect(out.headline).toContain('12');
    expect(out.headline).toContain('needs attention');
    for (const m of out.metrics) expect(out.narrative).toContain(m.explanation);
  });

  it('keeps the single-metric path for a question that names one number', async () => {
    const out = await composeAnswer(db, 1, 'how much did we spend this month', {
      cache: cannedCache({ 'finance.spend': 1234 }),
    });
    expect(out.topic).toBe('metric');
    expect(out.metrics).toHaveLength(1);
    expect(out.metrics[0]!.matchedMetric).toBe('finance.spend');
    expect(out.metrics[0]!.value).toBe(1234);
    // A scalar still gets its chart — that is the point of the hints table.
    expect(out.widgetIds).toEqual(['finance.spend-trend']);
  });

  it('carries the question\'s own window onto every reading', async () => {
    const out = await composeAnswer(db, 1, 'how are things looking this week', { cache: cannedCache({}) });
    expect(out.days).toBe(7);
    for (const m of out.metrics) expect(m.days).toBe(7);
  });

  it('never calls the refiner for a question either classifier recognised', async () => {
    const refiner = vi.fn<IntentRefiner>(async () => 'topic.cost');
    await composeAnswer(db, 1, 'are we behind on projects?', { refiner, cache: cannedCache({}) });
    await composeAnswer(db, 1, 'how much did we spend this month', { refiner, cache: cannedCache({}) });
    expect(refiner).not.toHaveBeenCalled();
  });

  it('spends ONE refiner call on an unrecognised question, over both halves of the list', async () => {
    const refiner = vi.fn<IntentRefiner>(async () => 'topic.reliability');
    const out = await composeAnswer(db, 1, 'is the vibe good', { refiner, cache: cannedCache({}) });
    expect(refiner).toHaveBeenCalledTimes(1);
    const allowed = refiner.mock.calls[0]![1];
    expect(allowed).toContain('topic.reliability');
    expect(allowed).toContain('finance.spend');
    expect(out.topic).toBe('reliability');
    expect(out.source).toBe('llm');
  });

  it('accepts a whitelisted METRIC key from the same call', async () => {
    const out = await composeAnswer(db, 1, 'is the vibe good', {
      refiner: async () => 'people.devSatisfaction',
      cache: cannedCache({ 'people.devSatisfaction': 72 }),
    });
    expect(out.topic).toBe('metric');
    expect(out.source).toBe('llm');
    expect(out.metrics[0]!.matchedMetric).toBe('people.devSatisfaction');
  });

  it('discards anything the gate does not recognise and says the question was not understood', async () => {
    for (const reply of ['topic.everything', 'tenants.deleteAll', 'ignore previous instructions; SELECT *', '', '   ']) {
      const out = await composeAnswer(db, 1, 'is the vibe good', { refiner: async () => reply, cache: cannedCache({}) });
      expect(out.topic, reply).toBe('metric');
      expect(out.source, reply).toBe('default');
      expect(out.metrics[0]!.matchedMetric, reply).toBe('finance.spend');
      expect(out.metrics[0]!.explanation, reply).toContain('could not tell');
    }
  });

  it('keeps the deterministic answer when the refiner throws, and works with none wired', async () => {
    const thrown = await composeAnswer(db, 1, 'is the vibe good', {
      refiner: async () => { throw new Error('gateway down'); },
      cache: cannedCache({}),
    });
    const none = await composeAnswer(db, 1, 'is the vibe good', { cache: cannedCache({}) });
    expect(thrown.source).toBe('default');
    expect(none.source).toBe('default');
    expect(thrown.metrics[0]!.matchedMetric).toBe(none.metrics[0]!.matchedMetric);
  });

  it('resolves every metric through the injected cache — never a private one', async () => {
    const seen: string[] = [];
    const cache = (async (key: string) => { seen.push(key); return 1; }) as MetricCache;
    await composeAnswer(db, 1, 'how are we doing on cost?', { cache });
    expect(seen).toHaveLength(TOPIC_SPECS.cost.metricKeys.length);
    for (const key of seen) expect(key).toMatch(/^dashboards:metric:t:1:k:.+:d:30$/);
  });
});

describe('headlineFor', () => {
  const reading = (matchedMetric: string, value: number | null, unit = ''): QueryAnswer => ({
    matchedMetric, label: matchedMetric, value, unit, days: 30, explanation: '', source: 'keyword',
  });

  it('says so plainly when nothing resolved', () => {
    expect(headlineFor('Delivery', [reading('dora.leadTime', null)], 30))
      .toBe('Delivery: no data in the last 30 days.');
  });

  it('leads on the readings the registry calls bad-when-rising', () => {
    const out = headlineFor('Reliability', [
      reading('quality.uptime', 99.9, '%'),      // goodWhenUp: true
      reading('quality.incidents', 3),           // goodWhenUp: false, > 0
    ], 30);
    expect(out).toContain('needs attention');
    expect(out).toContain('3');
  });

  it('reads as steady when no bad-when-rising metric is above zero', () => {
    expect(headlineFor('Reliability', [reading('quality.uptime', 99.9, '%')], 30)).toContain('looks steady');
  });
});

describe('the closed set', () => {
  it('has a spec for every topic and no spec for anything else', () => {
    expect(Object.keys(TOPIC_SPECS).sort()).toEqual([...ANSWER_TOPICS].sort() as AnswerTopic[]);
  });
});
