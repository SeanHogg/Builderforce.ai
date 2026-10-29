import { describe, expect, it } from 'vitest';
import { carriesRoutingSignal, foldsIntoRouting, parseRunOutcomeRequest } from './runOutcomeContract.js';

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

describe('foldsIntoRouting', () => {
  it('folds a completed or failed run that carries a routing signal', () => {
    expect(foldsIntoRouting({ source: 'ide', terminalStatus: 'completed' })).toBe(true);
    expect(foldsIntoRouting({ source: 'ide', terminalStatus: 'failed' })).toBe(true);
    expect(foldsIntoRouting({})).toBe(true);
  });

  it('never folds a run the person stopped: it says nothing about the model', () => {
    expect(foldsIntoRouting({ source: 'ide', terminalStatus: 'cancelled' })).toBe(false);
    expect(foldsIntoRouting({ terminalStatus: 'cancelled' })).toBe(false);
  });

  it('keeps every reason carriesRoutingSignal had to refuse', () => {
    expect(foldsIntoRouting({ source: 'canvas', terminalStatus: 'completed' })).toBe(false);
    expect(foldsIntoRouting({ entryPoint: 'canvas', terminalStatus: 'completed' })).toBe(false);
    expect(foldsIntoRouting({ source: 'ide', routingSignal: false, terminalStatus: 'completed' })).toBe(false);
  });
});
