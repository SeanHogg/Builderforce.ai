import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReplayIssueDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { InsightsScopeProvider } from '../insightsScope';
import { InsightsPanelProvider } from '../usePanel';
import { IssuesTable } from './IssuesTable';

/**
 * The issues band honours the ONE filter: the list is read with it, and an
 * estimated answer (kept recordings, D15/D18) says so and prints sessions as ≈.
 */

const issue: ReplayIssueDto = {
  id: 'i-1', fingerprint: 'fp', kind: 'rage', route: '/pay', subject: 'button', title: 'Rage on Pay',
  status: 'new', sessions: 12, share: 0.5, sparkline: [1, 2], firstRelease: null, lastRelease: null,
  firstSeenAt: '2026-10-01T00:00:00.000Z', lastSeenAt: '2026-10-12T00:00:00.000Z', prescriptionId: null,
};

function renderTable() {
  render(
    <InsightsScopeProvider siteId="site-1">
      <InsightsPanelProvider>
        <IssuesTable />
      </InsightsPanelProvider>
    </InsightsScopeProvider>,
  );
}

beforeEach(() => {
  window.history.replaceState({}, '', '/apps/insights?f.device.eq=phone');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('IssuesTable', () => {
  it('reads the issues with the filter and marks an estimated answer', async () => {
    vi.spyOn(replayApi, 'listIssues').mockResolvedValue({ items: [issue], nextCursor: null, estimated: true });
    renderTable();
    expect(await screen.findByText('insights.issues.estimatedNote')).toBeInTheDocument();
    expect(screen.getByText('insights.issues.approx 12')).toBeInTheDocument();
    expect(replayApi.listIssues).toHaveBeenCalledWith('site-1', expect.objectContaining({
      filter: { all: [{ field: 'device', op: 'eq', value: 'phone' }] },
    }));
  });

  it('prints exact sessions without the note when not estimated', async () => {
    vi.spyOn(replayApi, 'listIssues').mockResolvedValue({ items: [issue], nextCursor: null });
    renderTable();
    expect(await screen.findByText('Rage on Pay')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.queryByText('insights.issues.estimatedNote')).not.toBeInTheDocument();
  });
});
