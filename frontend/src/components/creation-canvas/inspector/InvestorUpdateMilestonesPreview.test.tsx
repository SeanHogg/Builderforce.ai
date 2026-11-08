import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InvestorUpdateMilestonesView } from './InvestorUpdateMilestonesPreview';

describe('InvestorUpdateMilestonesView', () => {
  it('lists work items and board milestones', () => {
    render(<InvestorUpdateMilestonesView pending={{
      since: '2026-10-01T00:00:00.000Z',
      until: '2026-11-01T00:00:00.000Z',
      moreCount: 0,
      milestones: [
        { source: 'work_item', id: '7', key: 'BF-7', title: 'SSO general availability', reachedAt: '2026-10-20T00:00:00.000Z', projectId: 1 },
        { source: 'board', id: 'b1:Q4', title: 'Q4 launch', reachedAt: '2026-10-25T00:00:00.000Z', boardId: 'b1', boardName: 'Platform', earnedPoints: 12 },
      ],
    }} />);
    expect(screen.getByText('SSO general availability')).toBeTruthy();
    expect(screen.getByText('Q4 launch')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows an empty state instead of an empty list', () => {
    render(<InvestorUpdateMilestonesView pending={{ since: '2026-10-01T00:00:00.000Z', until: '2026-11-01T00:00:00.000Z', milestones: [], moreCount: 0 }} />);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByText(/investorMilestonesEmpty|nothing|no milestones/i)).toBeTruthy();
  });
});
