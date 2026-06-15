import { describe, expect, it } from 'vitest';
import { ACTION_TYPES, DEFAULT_ACTION_TYPE, normalizeActionType, learnedRoutingEnabled, actionTypeLabel } from './actionTypes';

describe('actionTypes', () => {
  it('the enum is closed and includes the fallback bucket', () => {
    expect(ACTION_TYPES).toContain('other');
    expect(DEFAULT_ACTION_TYPE).toBe('other');
    expect(new Set(ACTION_TYPES).size).toBe(ACTION_TYPES.length); // no duplicates
  });

  it('normalizeActionType passes valid labels through', () => {
    for (const t of ACTION_TYPES) expect(normalizeActionType(t)).toBe(t);
  });

  it('normalizeActionType coerces anything unknown to "other"', () => {
    expect(normalizeActionType('SQL')).toBe('other'); // case-sensitive enum
    expect(normalizeActionType('made-up')).toBe('other');
    expect(normalizeActionType(null)).toBe('other');
    expect(normalizeActionType(undefined)).toBe('other');
    expect(normalizeActionType(42)).toBe('other');
    expect(normalizeActionType({})).toBe('other');
  });

  it('every action type has a human label', () => {
    for (const t of ACTION_TYPES) expect(actionTypeLabel(t).length).toBeGreaterThan(0);
  });

  it('learnedRoutingEnabled defaults ON and only an explicit off value disables it', () => {
    expect(learnedRoutingEnabled(undefined)).toBe(true);
    expect(learnedRoutingEnabled({})).toBe(true);
    expect(learnedRoutingEnabled({ LEARNED_ROUTING_ENABLED: '1' })).toBe(true);
    expect(learnedRoutingEnabled({ LEARNED_ROUTING_ENABLED: 'true' })).toBe(true);
    expect(learnedRoutingEnabled({ LEARNED_ROUTING_ENABLED: '0' })).toBe(false);
    expect(learnedRoutingEnabled({ LEARNED_ROUTING_ENABLED: 'false' })).toBe(false);
    expect(learnedRoutingEnabled({ LEARNED_ROUTING_ENABLED: 'off' })).toBe(false);
  });
});
