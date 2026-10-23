import { describe, expect, it } from 'vitest';
import {
  MAX_UNIT_ESCALATIONS,
  cascadeVerdict,
  initialCascadeState,
  nextTierModel,
  verifyStructuredOutput,
  weakestTierModel,
  type TierLadder,
} from './cascade.js';
import { initialRunPolicy, nextTurn, reduceRunPolicy } from './policy.js';

const RANK: Record<string, number> = { 'free-a': 0, 'free-b': 0, 'std-a': 1, 'prem-a': 2, 'prem-b': 2, 'ultra-a': 3 };
const ladder: TierLadder = { candidates: ['prem-a', 'free-a', 'std-a', 'free-b', 'ultra-a', 'prem-b'], rankOf: (m) => RANK[m] ?? 4 };
const fail = { passed: false, verifier: 'changed_files', reason: 'a.ts:3 parse error' };
const pass = { passed: true, verifier: 'changed_files' };

describe('tier ladder', () => {
  it('finds the weakest tier, first in preference order', () => {
    expect(weakestTierModel(ladder)).toBe('free-a');
    expect(weakestTierModel(ladder, ['free-a'])).toBe('free-b');
  });

  it('steps exactly one tier up, and stops at the top', () => {
    expect(nextTierModel(ladder, 'free-a')).toBe('std-a');
    expect(nextTierModel(ladder, 'std-a')).toBe('prem-a');
    expect(nextTierModel(ladder, 'std-a', ['prem-a'])).toBe('prem-b');
    expect(nextTierModel(ladder, 'ultra-a')).toBeUndefined();
    // An auto-selected (unknown) model starts from the floor.
    expect(nextTierModel(ladder, undefined)).toBe('std-a');
  });
});

describe('cascadeVerdict', () => {
  it('escalates one tier per failure, at most MAX_UNIT_ESCALATIONS times per unit', () => {
    let s = initialCascadeState();
    let current = 'free-a';
    const kinds: string[] = [];
    for (let i = 0; i < MAX_UNIT_ESCALATIONS + 1; i++) {
      const r = cascadeVerdict(s, 'code_edit', fail, { current, ladder });
      s = r.state;
      kinds.push(r.action.kind);
      if (r.action.kind === 'escalate' && r.action.to) current = r.action.to;
    }
    expect(kinds).toEqual(['escalate', 'escalate', 'exhausted']);
    expect(current).toBe('prem-a');
    expect(s.escalations).toBe(MAX_UNIT_ESCALATIONS);
  });

  it('carries the verifier reason into the steer', () => {
    const r = cascadeVerdict(initialCascadeState(), 'finish', { ...fail, verifier: 'finish_gates' }, { current: 'free-a', ladder });
    expect(r.action.kind === 'escalate' && r.action.steer).toContain('a.ts:3 parse error');
  });

  it('returns to the unit base once the repaired unit passes', () => {
    const up = cascadeVerdict(initialCascadeState(), 'code_edit', fail, { current: 'free-a', ladder });
    const down = cascadeVerdict(up.state, 'code_edit', pass, { current: 'std-a', ladder });
    expect(down.action).toEqual({ kind: 'deescalate', to: 'free-a' });
    expect(down.state.open).toBeUndefined();
    expect(down.state.reasoningBoost).toBe(0);
  });

  it('ignores an inconclusive verdict and a pass with nothing open', () => {
    const s = initialCascadeState();
    expect(cascadeVerdict(s, 'finish', { passed: false, verifier: 'ci', inconclusive: true }, { current: 'x', ladder }).action.kind).toBe('none');
    expect(cascadeVerdict(s, 'finish', pass, { current: 'x', ladder }).action.kind).toBe('none');
  });

  it('raises reasoning even when no stronger model exists', () => {
    const r = cascadeVerdict(initialCascadeState(), 'code_edit', fail, { current: 'ultra-a', ladder });
    expect(r.action).toMatchObject({ kind: 'escalate', to: undefined, escalateReasoning: true });
    expect(r.state.reasoningBoost).toBe(1);
  });
});

describe('the escalated policy event', () => {
  it('asks for the escalated model strictly and records the one it left', () => {
    let p = initialRunPolicy({ pinnedModel: 'free-a', lockAfterFirstSuccess: true, pinReleasable: true, startPhase: 'code' });
    p = reduceRunPolicy(p, { type: 'escalated', to: 'std-a' });
    expect(nextTurn(p, { hasTools: true })).toMatchObject({ model: 'std-a', strict: true });
    expect(p.tried).toContain('free-a');
  });
});

describe('verifyStructuredOutput', () => {
  it('passes a valid value and names the schema failure otherwise', () => {
    expect(verifyStructuredOutput({ a: 1 }, () => null)).toEqual({ passed: true, verifier: 'schema' });
    expect(verifyStructuredOutput({}, () => 'missing a')).toMatchObject({ passed: false, reason: 'missing a' });
  });
});
