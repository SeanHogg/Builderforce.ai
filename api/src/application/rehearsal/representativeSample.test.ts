import { describe, expect, it } from 'vitest';
import { selectRepresentativeTickets } from './rehearsalService';

describe('selectRepresentativeTickets', () => {
  it('covers distinct strata before repeating the newest stratum', () => {
    const rows = [
      { id: 1, priority: 'high', status: 'done', taskType: 'task' },
      { id: 2, priority: 'high', status: 'done', taskType: 'task' },
      { id: 3, priority: 'low', status: 'failed', taskType: 'task' },
    ];
    expect(selectRepresentativeTickets(rows, 2).map((r) => r.id)).toEqual([1, 3]);
  });
});
