import { describe, it, expect } from 'vitest';
import { classifyReplyAccount, buildReplyProvenance } from './replyProvenance';

describe('classifyReplyAccount', () => {
  it("returns 'own' whenever the tenant's own credential served the turn", () => {
    expect(classifyReplyAccount(true, true)).toBe('own');
    // byoFunded wins even if we somehow think there's no connection recorded.
    expect(classifyReplyAccount(true, false)).toBe('own');
  });

  it("flags 'shared_byo_unused' when the shared pool served a turn despite a connected account", () => {
    expect(classifyReplyAccount(false, true)).toBe('shared_byo_unused');
  });

  it("returns plain 'shared' when there is no connected account to have used", () => {
    expect(classifyReplyAccount(false, false)).toBe('shared');
  });
});

describe('buildReplyProvenance', () => {
  it('carries the resolved model + classified account, omitting vendor when absent', () => {
    expect(buildReplyProvenance({ model: 'anthropic/claude-opus-4-8', byoFunded: true, hasConnectedAccount: true }))
      .toEqual({ model: 'anthropic/claude-opus-4-8', account: 'own' });
  });

  it('includes the vendor when known', () => {
    expect(buildReplyProvenance({ model: 'xiaomi/mimo', vendor: 'openrouter', byoFunded: false, hasConnectedAccount: true }))
      .toEqual({ model: 'xiaomi/mimo', account: 'shared_byo_unused', vendor: 'openrouter' });
  });
});
