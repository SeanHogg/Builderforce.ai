import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReportSchedule } from '@/lib/reports/reportSchedulesApi';

/**
 * The form follows the API's contract: create posts every field (and a board
 * pack's frame), edit sends only the three fields PATCH takes, and nothing
 * submits without a recipient — or, for a board pack, without a frame.
 */
vi.mock('@/components/Select', () => ({
  Select: (props: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...props} />,
}));
vi.mock('./BoardPackFramePicker', () => ({
  BoardPackFramePicker: ({ onSession, onFrame }: { onSession: (id: string) => void; onFrame: (ref: string) => void }) => (
    <button type="button" onClick={() => { onSession('sess-1'); onFrame('sess-1:frame-1'); }}>pick-frame</button>
  ),
}));

import { ReportScheduleForm } from './ReportScheduleForm';

const schedule: ReportSchedule = {
  id: 's1', reportType: 'standup', schedule: 'daily', deliveryHour: 7,
  recipients: ['lead@x.co'], isEnabled: true, subjectKind: null, subjectRef: null,
  lastRunAt: null, nextRunAt: null, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
};

const recipients = () => screen.getByLabelText('financeHub.reports.field.recipients');
const submitButton = (key: string) => screen.getByRole('button', { name: `financeHub.reports.${key}` });

describe('ReportScheduleForm', () => {
  it('will not create without a recipient', () => {
    render(<ReportScheduleForm schedule={null} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(submitButton('create')).toBeDisabled();
    expect(screen.getByText('financeHub.reports.needRecipients')).toBeInTheDocument();
  });

  it('names an entry that is not an address and blocks the submit', () => {
    render(<ReportScheduleForm schedule={null} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(recipients(), { target: { value: 'ok@x.co, nope' } });
    expect(screen.getByText(/financeHub\.reports\.recipientsInvalid nope/)).toBeInTheDocument();
    expect(submitButton('create')).toBeDisabled();
  });

  it('creates a computed report with the chosen cadence and parsed recipients', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<ReportScheduleForm schedule={null} onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('financeHub.reports.field.cadence'), { target: { value: 'monthly' } });
    fireEvent.change(screen.getByLabelText('financeHub.reports.field.hour'), { target: { value: '14' } });
    fireEvent.change(recipients(), { target: { value: 'CFO@x.co\nboard@x.co' } });
    fireEvent.click(submitButton('create'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      kind: 'create',
      input: { reportType: 'executive_summary', schedule: 'monthly', deliveryHour: 14, recipients: ['cfo@x.co', 'board@x.co'] },
    }));
  });

  it('requires a frame for a board pack and posts the subject the picker returned', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<ReportScheduleForm schedule={null} onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('financeHub.reports.field.type'), { target: { value: 'board_pack' } });
    fireEvent.change(recipients(), { target: { value: 'board@x.co' } });
    expect(screen.getByText('financeHub.reports.needFrame')).toBeInTheDocument();
    expect(submitButton('create')).toBeDisabled();

    fireEvent.click(screen.getByText('pick-frame'));
    fireEvent.click(submitButton('create'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      kind: 'create',
      input: {
        reportType: 'board_pack', schedule: 'weekly', deliveryHour: 8, recipients: ['board@x.co'],
        subjectKind: 'canvas_frame', subjectRef: 'sess-1:frame-1',
      },
    }));
  });

  it('edits only what PATCH takes, with type and cadence locked', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<ReportScheduleForm schedule={schedule} onSubmit={onSubmit} onCancel={vi.fn()} />);
    expect(screen.getByLabelText('financeHub.reports.field.type')).toBeDisabled();
    expect(screen.getByLabelText('financeHub.reports.field.cadence')).toBeDisabled();
    expect(recipients()).toHaveValue('lead@x.co');

    fireEvent.change(recipients(), { target: { value: 'lead@x.co, cto@x.co' } });
    fireEvent.click(screen.getByLabelText('financeHub.reports.field.enabled'));
    fireEvent.click(submitButton('save'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      kind: 'update', id: 's1', patch: { deliveryHour: 7, recipients: ['lead@x.co', 'cto@x.co'], isEnabled: false },
    }));
  });

  it('keeps the form open and shows the failure when the save is refused', async () => {
    const onSubmit = vi.fn(async () => { throw new Error('That frame is not on a board this workspace can read'); });
    render(<ReportScheduleForm schedule={schedule} onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.click(submitButton('save'));
    expect(await screen.findByRole('alert')).toHaveTextContent('That frame is not on a board');
  });
});
