import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuditReportRunsList } from './AuditReportRunsList';
import { listAuditReportRuns, type AuditReportRun } from '@/lib/finopsApi';

/**
 * The list exists so an export is visible as a logged event, not a download
 * that vanished. What matters: it fetches on its own, shows the headline figures
 * a run carried, says so when nothing has been exported, surfaces a failure, and
 * re-reads when the export control bumps `refreshKey`. Copy is the passthrough
 * key under the global next-intl mock.
 */
vi.mock('@/lib/finopsApi', () => ({ listAuditReportRuns: vi.fn() }));
const list = vi.mocked(listAuditReportRuns);

const run: AuditReportRun = {
  id: 7, periodMonth: '2026-08', generatedBy: 'user-1', createdAt: '2026-09-06T10:00:00.000Z',
  summary: { format: 'csv', windowDays: 30, generatedAt: '2026-09-06T10:00:00.000Z', spendUsd: 1234, forecastUsd: 1500, capexUsd: 600, opexUsd: 400, qualifiedBaseUsd: 3700, socCoveragePct: 70.4, complianceEvents: 512 },
};

beforeEach(() => { list.mockReset(); });

describe('AuditReportRunsList', () => {
  it('renders each run with its period, actor, format and headline figures', async () => {
    list.mockResolvedValue([run]);
    render(<AuditReportRunsList />);
    expect(screen.getByText('finops.auditRuns.loading')).toBeInTheDocument();
    expect(await screen.findByText('2026-08')).toBeInTheDocument();
    expect(screen.getByText('user-1')).toBeInTheDocument();
    expect(screen.getByText('csv')).toBeInTheDocument();
    expect(screen.getByText('70%')).toBeInTheDocument();
    expect(screen.getByText(/1,234/)).toBeInTheDocument();
  });

  it('shows the empty state and attributes a system run', async () => {
    list.mockResolvedValue([]);
    render(<AuditReportRunsList />);
    expect(await screen.findByText('finops.auditRuns.empty')).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    list.mockRejectedValue(new Error('boom'));
    render(<AuditReportRunsList />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('re-reads when refreshKey changes', async () => {
    list.mockResolvedValue([run]);
    const { rerender } = render(<AuditReportRunsList refreshKey={0} />);
    await screen.findByText('2026-08');
    rerender(<AuditReportRunsList refreshKey={1} />);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });
});
