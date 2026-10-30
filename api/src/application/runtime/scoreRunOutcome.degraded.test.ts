import { describe, expect, it } from 'vitest';
import { weakerServedIn } from './scoreRunOutcome';

/**
 * The cloud writes `run_model_outcomes.degraded` by the SAME rule as the ONE agent's row and the legacy
 * runner: served by a model WEAKER than the run asked for (`isWeakerModel`). The `coding_model_degraded`
 * event it reads fires whenever the served model is not a curated coder - including a generalist that is
 * STRONGER than the coder the run wanted - so the event alone must not mark a run degraded.
 */
const event = (requestedModel: unknown, resolvedModel: unknown) => ({ args: JSON.stringify({ requestedModel, resolvedModel, executionId: 1 }) });

describe('weakerServedIn', () => {
  it('a STANDARD curated coder floored onto an ULTRA generalist is NOT degraded', () => {
    expect(weakerServedIn([event('anthropic/claude-haiku-4.5', 'anthropic/claude-opus-4.5')])).toBe(false);
  });

  it('an ULTRA model that fell through to a STANDARD one is degraded', () => {
    expect(weakerServedIn([event('anthropic/claude-opus-4.5', 'anthropic/claude-haiku-4.5')])).toBe(true);
  });

  it('says nothing about a run it cannot rank: no intended model, an unpriced model, a malformed event, no events', () => {
    expect(weakerServedIn([event(null, 'anthropic/claude-haiku-4.5')])).toBe(false);
    expect(weakerServedIn([event('anthropic/claude-opus-4.5', 'mystery/unpriced')])).toBe(false);
    expect(weakerServedIn([{ args: 'not json' }, { args: null }])).toBe(false);
    expect(weakerServedIn([])).toBe(false);
  });

  it('any weaker turn among several marks the run', () => {
    expect(weakerServedIn([event('anthropic/claude-haiku-4.5', 'anthropic/claude-opus-4.5'), event('anthropic/claude-opus-4.5', 'anthropic/claude-haiku-4.5')])).toBe(true);
  });
});
