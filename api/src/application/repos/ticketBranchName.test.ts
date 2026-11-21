import { describe, expect, it } from 'vitest';
import { ticketBranchNameAvoiding, TICKET_BRANCH_SUFFIX_LIMIT } from './commitFileAsPendingChange';

describe('ticketBranchNameAvoiding (GAP-W10)', () => {
  it('uses the canonical name when free', () => {
    expect(ticketBranchNameAvoiding(7, new Set())).toBe('builderforce/task-7');
  });
  it('suffixes when a human already created the branch', () => {
    expect(ticketBranchNameAvoiding(7, new Set(['builderforce/task-7', 'builderforce/task-7-2']))).toBe('builderforce/task-7-3');
  });
  it('refuses when every suffix is taken', () => {
    const taken = new Set(['builderforce/task-7']);
    for (let n = 2; n <= TICKET_BRANCH_SUFFIX_LIMIT; n++) taken.add(`builderforce/task-7-${n}`);
    expect(() => ticketBranchNameAvoiding(7, taken)).toThrow(/refusing/);
  });
});
