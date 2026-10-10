import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReportSchedule } from '@/lib/reports/reportSchedulesApi';
import type { ReportSchedulesState } from '@/lib/reports/useReportSchedules';

/**
 * The panel holds view state only: what it must get right is the four answers a
 * list gives (loading, failed, empty, rows), that pause/resume and delete call
 * the hook's writes, and that delete goes through the destructive confirm.
 * Copy is the passthrough key under the global next-intl mock.
 */
const confirmSpy = vi.fn();
vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => confirmSpy }));
vi.mock('@/components/RoleGate', () => ({ RoleGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/SlideOutPanel', () => ({
  SlideOutPanel: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div data-testid="slideout">{children}</div> : null),
}));
vi.mock('@/i18n/useFormat', () => ({ useFormat: () => ({ dateTime: (value: string) => `at ${value}` }) }));
vi.mock('./ReportScheduleForm', () => ({
  ReportScheduleForm: ({ schedule }: { schedule: ReportSchedule | null }) => <div data-testid="form">{schedule ? schedule.id : 'new'}</div>,
}));

const hook = vi.fn<() => ReportSchedulesState>();
vi.mock('@/lib/reports/useReportSchedules', () => ({ useReportSchedules: () => hook() }));

import { ReportSchedulesPanel } from './ReportSchedulesPanel';

const schedule: ReportSchedule = {
  id: 's1', reportType: 'board_pack', schedule: 'monthly', deliveryHour: 9,
  recipients: ['cfo@x.co', 'board@x.co'], isEnabled: true,
  subjectKind: 'canvas_frame', subjectRef: 'sess-1:frame-1',
  lastRunAt: null, nextRunAt: '2026-11-01T09:00:00.000Z',
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
};

function state(over: Partial<ReportSchedulesState> = {}): ReportSchedulesState {
  return {
    schedules: [], loading: false, error: null,
    create: vi.fn(), update: vi.fn(async () => schedule), remove: vi.fn(async () => undefined),
    ...over,
  };
}

beforeEach(() => {
  confirmSpy.mockReset();
  hook.mockReset();
});

describe('ReportSchedulesPanel', () => {
  it('shows the loading state before the first read lands', () => {
    hook.mockReturnValue(state({ loading: true }));
    render(<ReportSchedulesPanel />);
    expect(screen.getByText('financeHub.reports.loading')).toBeInTheDocument();
  });

  it('shows the empty state when nothing is scheduled', () => {
    hook.mockReturnValue(state());
    render(<ReportSchedulesPanel />);
    expect(screen.getByText('financeHub.reports.empty')).toBeInTheDocument();
  });

  it('surfaces a failed read', () => {
    hook.mockReturnValue(state({ error: new Error('forbidden') }));
    render(<ReportSchedulesPanel />);
    expect(screen.getByRole('alert')).toHaveTextContent('forbidden');
  });

  it('renders each schedule with its type, cadence, recipients, subject and next run', () => {
    hook.mockReturnValue(state({ schedules: [schedule] }));
    render(<ReportSchedulesPanel />);
    expect(screen.getByText('financeHub.reports.type.board_pack')).toBeInTheDocument();
    expect(screen.getByText(/financeHub\.reports\.cadenceSummary financeHub\.reports\.cadence\.monthly 09/)).toBeInTheDocument();
    expect(screen.getByText(/financeHub\.reports\.recipientsCount 2/)).toBeInTheDocument();
    expect(screen.getByText(/financeHub\.reports\.subjectFrame/)).toBeInTheDocument();
    expect(screen.getByText(/financeHub\.reports\.nextRun at 2026-11-01/)).toBeInTheDocument();
  });

  it('pauses an active schedule through the hook', async () => {
    const update = vi.fn(async () => schedule);
    hook.mockReturnValue(state({ schedules: [schedule], update }));
    render(<ReportSchedulesPanel />);
    fireEvent.click(screen.getByText('financeHub.reports.pause'));
    await waitFor(() => expect(update).toHaveBeenCalledWith('s1', { isEnabled: false }));
  });

  it('deletes only after the destructive confirm says yes', async () => {
    const remove = vi.fn(async () => undefined);
    hook.mockReturnValue(state({ schedules: [schedule], remove }));
    render(<ReportSchedulesPanel />);

    confirmSpy.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByText('financeHub.reports.delete'));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1));
    expect(remove).not.toHaveBeenCalled();
    expect(confirmSpy.mock.calls[0][0]).toMatchObject({ destructive: true });

    confirmSpy.mockResolvedValueOnce(true);
    fireEvent.click(screen.getByText('financeHub.reports.delete'));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('s1'));
  });

  it('opens the create form in the slide-out on New', () => {
    hook.mockReturnValue(state({ schedules: [schedule] }));
    render(<ReportSchedulesPanel />);
    expect(screen.queryByTestId('slideout')).toBeNull();
    fireEvent.click(screen.getByText('financeHub.reports.new'));
    expect(screen.getByTestId('form')).toHaveTextContent('new');
  });

  it('opens the edit form for the chosen schedule', () => {
    hook.mockReturnValue(state({ schedules: [schedule] }));
    render(<ReportSchedulesPanel />);
    fireEvent.click(screen.getByText('financeHub.reports.edit'));
    expect(screen.getByTestId('form')).toHaveTextContent('s1');
  });
});
