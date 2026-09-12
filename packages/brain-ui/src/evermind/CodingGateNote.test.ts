import { describe, expect, it } from 'vitest';
import { codingGateMessage } from './CodingGateNote';
import { DEFAULT_EVERMIND_LABELS, type EvermindCodingGateView } from './types';

/**
 * The console line behind the operator's 90% coding bar. Routing enforces the gate
 * silently, so this is the only place "why isn't my Evermind answering in the editor?"
 * gets an answer — and it must never read "90% — needs 90%" on a head that was refused.
 */
const gate = (over: Partial<EvermindCodingGateView>): EvermindCodingGateView => ({
  qualified: false, reason: 'no_eval', bar: 0.9, ratio: null, headVersion: 12, evaluatedVersion: null, ...over,
});

describe('codingGateMessage', () => {
  it('says what it takes when no eval is recorded (every project today)', () => {
    expect(codingGateMessage(gate({}), DEFAULT_EVERMIND_LABELS)).toEqual({
      tone: 'warn',
      text: 'No coding eval recorded for this version — needs 90% of the frontier baseline before it can serve IDE coding turns.',
    });
  });

  it('reports the score against the bar, flooring so a near-miss never reads as a pass', () => {
    expect(codingGateMessage(gate({ reason: 'below_bar', ratio: 0.899, evaluatedVersion: 12 }), DEFAULT_EVERMIND_LABELS)?.text)
      .toBe('Coding eval 89% of baseline, needs 90% — IDE coding turns stay on the frontier model.');
  });

  it('confirms a qualified head', () => {
    expect(codingGateMessage(gate({ qualified: true, reason: 'qualified', ratio: 0.9000000001, evaluatedVersion: 12 }), DEFAULT_EVERMIND_LABELS))
      .toEqual({ tone: 'ok', text: 'Coding eval 90% of baseline — qualified to serve IDE coding turns (needs 90%).' });
  });

  it('names both versions when the eval is stale', () => {
    expect(codingGateMessage(gate({ reason: 'stale_eval', ratio: 0.95, evaluatedVersion: 11 }), DEFAULT_EVERMIND_LABELS)?.text)
      .toMatch(/v11.*v12/);
  });

  it('stays silent where another element already explains the state', () => {
    expect(codingGateMessage(gate({ reason: 'unseeded' }), DEFAULT_EVERMIND_LABELS)).toBeNull();
    expect(codingGateMessage(gate({ reason: 'quarantined' }), DEFAULT_EVERMIND_LABELS)).toBeNull();
    expect(codingGateMessage(undefined, DEFAULT_EVERMIND_LABELS)).toBeNull();
  });
});
