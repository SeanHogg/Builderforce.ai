import { describe, expect, it } from 'vitest';
import { planAfter } from './planLimitError';

describe('planAfter — the plan an upgrade offers', () => {
  it('offers Teams to someone on Pro and Pro to everyone else', () => {
    expect(planAfter('pro')).toBe('teams');
    expect(planAfter('free')).toBe('pro');
    expect(planAfter(undefined)).toBe('pro');
  });
});
