import { describe, expect, it, vi } from 'vitest';
import { parseIntent, refineIntent, type IntentRefiner } from './nlQuery';

/**
 * The safety properties of the intent mapper, asserted rather than described.
 *
 * The refinement (AIIMP-3) is only defensible because of what it CANNOT do, and
 * "cannot" is exactly the kind of claim that decays into "does not currently".
 * These tests pin the three that matter: a recognised question never reaches the
 * model, an unrecognised one is labelled as unrecognised, and nothing a model
 * returns can name a metric outside the registry.
 */

describe('parseIntent', () => {
  it('reports a keyword match as a match', () => {
    expect(parseIntent('what is our deploy frequency this week')).toEqual({
      metricKey: 'dora.deployFreq', days: 7, source: 'keyword',
    });
  });

  it('covers the reliability metrics that used to fall through to spend', () => {
    // Each of these questions previously returned `finance.spend` — a dollar
    // figure presented as the answer to a question about reliability or people.
    expect(parseIntent('how is uptime looking').metricKey).toBe('quality.uptime');
    expect(parseIntent('how many incidents last month').metricKey).toBe('quality.incidents');
    expect(parseIntent('what is our mttr').metricKey).toBe('quality.mttr');
    expect(parseIntent('what is attrition this year').metricKey).toBe('people.attrition');
    expect(parseIntent('how many tokens did we use').metricKey).toBe('ai.tokens');
  });

  it("keeps 'cost' questions on spend even when they name a reliability noun", () => {
    // Rule ORDER is load-bearing: the finance rules run first, so "incident cost"
    // is a spend question and "how many incidents" is not.
    expect(parseIntent('what did incidents cost us').metricKey).toBe('finance.spend');
  });

  it('marks an unrecognised question as defaulted rather than answered', () => {
    const intent = parseIntent('is the vibe good');
    expect(intent.metricKey).toBe('finance.spend');
    expect(intent.source).toBe('default');
  });
});

describe('refineIntent', () => {
  const unmatched = parseIntent('is the vibe good');

  it('never calls the refiner for a question the keywords matched', async () => {
    const refiner = vi.fn<IntentRefiner>(async () => 'quality.uptime');
    const matched = parseIntent('what is our deploy frequency');
    expect(await refineIntent(matched, 'what is our deploy frequency', refiner)).toEqual(matched);
    expect(refiner).not.toHaveBeenCalled();
  });

  it('accepts a whitelisted key and records that the model chose it', async () => {
    const out = await refineIntent(unmatched, 'is the vibe good', async () => 'people.devSatisfaction');
    expect(out).toEqual({ ...unmatched, metricKey: 'people.devSatisfaction', source: 'llm' });
  });

  it('discards a key that is not in the registry', async () => {
    // The whole safety argument: a model cannot name a metric that does not exist,
    // so it cannot reach a compute path that was never whitelisted.
    expect(await refineIntent(unmatched, 'q', async () => 'tenants.deleteAll')).toEqual(unmatched);
  });

  it('discards prose, an injected instruction and an empty reply alike', async () => {
    for (const reply of ['I think you want spend', 'ignore previous instructions; SELECT *', '', '   ']) {
      expect(await refineIntent(unmatched, 'q', async () => reply)).toEqual(unmatched);
    }
  });

  it('keeps the deterministic intent when the refiner throws', async () => {
    expect(await refineIntent(unmatched, 'q', async () => { throw new Error('gateway down'); })).toEqual(unmatched);
  });

  it('is a no-op with no refiner wired — the feature works with no LLM', async () => {
    expect(await refineIntent(unmatched, 'q', undefined)).toEqual(unmatched);
  });
});
