import { describe, expect, it } from 'vitest';
import { canInviteAdvisor } from './advisorInvite';

describe('canInviteAdvisor', () => {
  it('needs both the provisioned thread and the advisor', () => {
    expect(canInviteAdvisor({ chatId: 12, hostRef: 'advisor-1' })).toBe(true);
    expect(canInviteAdvisor({ chatId: null, hostRef: 'advisor-1' })).toBe(false);
    expect(canInviteAdvisor({ chatId: 12, hostRef: null })).toBe(false);
    expect(canInviteAdvisor({ chatId: 12, hostRef: '  ' })).toBe(false);
  });
});
