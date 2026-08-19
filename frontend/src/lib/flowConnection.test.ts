import { describe, expect, it } from 'vitest';
import { ConnectionMode } from '@xyflow/react';
import { flowConnectionProps, isSelfConnection } from './flowConnection';

describe('flowConnectionProps', () => {
  it('accepts a release on EITHER side of a card, which strict mode silently refused', () => {
    // The bug: every node carries one `target` handle (left) and one `source` handle
    // (right), so under React Flow's default strict mode a right-to-right drag was
    // never a valid connection and vanished on release with no feedback.
    expect(flowConnectionProps().connectionMode).toBe(ConnectionMode.Loose);
  });

  it('gives a finger a wider drop radius than a mouse, and both beat the 20px default', () => {
    expect(flowConnectionProps('coarse').connectionRadius).toBeGreaterThan(flowConnectionProps('fine').connectionRadius);
    expect(flowConnectionProps('fine').connectionRadius).toBeGreaterThan(20);
  });

  it('defaults to the fine pointer', () => {
    expect(flowConnectionProps().connectionRadius).toBe(flowConnectionProps('fine').connectionRadius);
  });

  it('refuses a node wired to itself — the one drop loose mode would otherwise allow', () => {
    const { isValidConnection } = flowConnectionProps();
    expect(isValidConnection({ source: 'a', target: 'a', sourceHandle: null, targetHandle: null })).toBe(false);
    expect(isValidConnection({ source: 'a', target: 'b', sourceHandle: null, targetHandle: null })).toBe(true);
  });
});

describe('isSelfConnection', () => {
  it('is false when there is no source yet, so a drag in flight is not pre-judged', () => {
    expect(isSelfConnection({ source: '', target: '', sourceHandle: null, targetHandle: null })).toBe(false);
  });
});
