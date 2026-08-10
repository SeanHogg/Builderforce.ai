import { describe, expect, it } from 'vitest';
import { isAgentRunnable } from './agentState';

describe('isAgentRunnable', () => {
  it('allows only active agents', () => {
    expect(isAgentRunnable('active')).toBe(true);
    expect(isAgentRunnable('inactive')).toBe(false);
    expect(isAgentRunnable('quarantined')).toBe(false);
    expect(isAgentRunnable('')).toBe(false);
  });
});
