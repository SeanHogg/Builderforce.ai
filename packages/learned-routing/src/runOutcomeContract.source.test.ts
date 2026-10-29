import { describe, expect, it } from 'vitest';
import { carriesRoutingSignal, parseRunOutcomeRequest } from './runOutcomeContract.js';

const body = { clientRunId: 'r1', model: 'm' };

describe('the outcome source', () => {
  it('accepts canvas as its own source, and never cloud off the wire', () => {
    const canvas = parseRunOutcomeRequest({ ...body, source: 'canvas' });
    const cloud = parseRunOutcomeRequest({ ...body, source: 'cloud' });

    expect(canvas.ok && canvas.outcome.source).toBe('canvas');
    expect(cloud.ok && cloud.outcome.source).toBe('external');
  });
});

describe('carriesRoutingSignal', () => {
  it('is true for a run that says nothing, false when it says it is not a signal', () => {
    expect(carriesRoutingSignal({ source: 'ide' })).toBe(true);
    expect(carriesRoutingSignal({ source: 'ide', routingSignal: true })).toBe(true);
    expect(carriesRoutingSignal({ source: 'ide', routingSignal: false })).toBe(false);
  });

  it('is false for a canvas run whatever it claims — by entry point or by source', () => {
    expect(carriesRoutingSignal({ source: 'external', entryPoint: 'canvas', routingSignal: true })).toBe(false);
    expect(carriesRoutingSignal({ source: 'canvas', routingSignal: true })).toBe(false);
    expect(carriesRoutingSignal({ source: 'external', entryPoint: 'canvas' })).toBe(false);
  });
});
