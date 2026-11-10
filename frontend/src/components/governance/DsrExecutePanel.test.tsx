import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { DsrExecutePanel } from './DsrExecutePanel';
import { executeDsr, planDsr, type DsrPlan } from '@/lib/governanceDevsecopsApi';

/**
 * Executing a data subject request can erase data for good. Pinned: an erase is confirmed first,
 * naming the subject, and nothing runs on cancel; switching to another request clears the previous
 * plan (its `verified` must not enable Run) and a late answer for the old request is dropped.
 */
vi.mock('@/lib/governanceDevsecopsApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/governanceDevsecopsApi')>()),
  planDsr: vi.fn(),
  executeDsr: vi.fn(),
  verifyDsrIdentity: vi.fn(),
  markDsrDelivered: vi.fn(),
  fetchDsrExport: vi.fn(),
}));
const confirmSpy = vi.hoisted(() => vi.fn());
vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => confirmSpy }));
vi.mock('@/components/RoleGate', () => ({ RoleGate: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/components/SlideOutPanel', () => ({
  SlideOutPanel: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
}));

const plan = vi.mocked(planDsr);
const execute = vi.mocked(executeDsr);

const erasePlan: DsrPlan = { disposition: 'suppress_and_erase', verified: true, status: 'pending' };
const executed = {
  status: 'completed' as const, disposition: 'suppress_and_erase' as const, suppressionAdded: true,
  exported: {}, erased: { contacts: 1 }, outstanding: [], exportUrl: null, deliveredAt: null, note: null,
};

beforeEach(() => {
  plan.mockReset();
  execute.mockReset();
  confirmSpy.mockReset();
});

const panel = (requestId: string) => (
  <DsrExecutePanel requestId={requestId} subject="ada@example.com" open onClose={() => {}} onDone={() => {}} />
);

describe('DsrExecutePanel', () => {
  it('regression: an erase is confirmed first, naming the subject, and does not run on cancel', async () => {
    plan.mockResolvedValue(erasePlan);
    confirmSpy.mockResolvedValueOnce(false);
    render(panel('r1'));
    const run = await screen.findByText('governance.dsrExecute.run');
    await act(async () => { fireEvent.click(run); });
    expect(confirmSpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('ada@example.com'),
      confirmLabel: 'governance.dsrExecute.confirmErase.confirmLabel',
    }));
    expect(execute).not.toHaveBeenCalled();

    confirmSpy.mockResolvedValueOnce(true);
    execute.mockResolvedValueOnce({ result: executed } as never);
    await act(async () => { fireEvent.click(screen.getByText('governance.dsrExecute.run')); });
    expect(execute).toHaveBeenCalledWith('r1');
  });

  it('regression: a double-click on Run opens ONE confirmation and executes once', async () => {
    plan.mockResolvedValue(erasePlan);
    let answer: (ok: boolean) => void = () => {};
    confirmSpy.mockImplementation(() => new Promise<boolean>((resolve) => { answer = resolve; }));
    execute.mockResolvedValue({ result: executed } as never);
    render(panel('r1'));
    const run = await screen.findByText('governance.dsrExecute.run');
    await act(async () => { fireEvent.click(run); fireEvent.click(run); });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    await act(async () => { answer(true); });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does not ask to confirm a non-destructive disposition', async () => {
    plan.mockResolvedValue({ disposition: 'export', verified: true, status: 'pending' });
    execute.mockResolvedValueOnce({ result: { ...executed, disposition: 'export' } } as never);
    render(panel('r1'));
    const run = await screen.findByText('governance.dsrExecute.run');
    await act(async () => { fireEvent.click(run); });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledWith('r1');
  });

  it('regression: switching request clears the old plan and drops a late answer for it', async () => {
    let answerR1: (p: DsrPlan) => void = () => {};
    let answerR2: (p: DsrPlan) => void = () => {};
    plan.mockImplementation((id: string) => new Promise<DsrPlan>((resolve) => {
      if (id === 'r1') answerR1 = resolve; else answerR2 = resolve;
    }));
    const { rerender } = render(panel('r1'));
    rerender(panel('r2'));
    // r1's slow answer (verified) lands after the switch: it must not be shown for r2.
    await act(async () => { answerR1(erasePlan); });
    expect(screen.queryByText('governance.dsrExecute.run')).toBeNull();

    await act(async () => { answerR2({ disposition: 'suppress_and_erase', verified: false, status: 'pending' }); });
    const run = await screen.findByText('governance.dsrExecute.run');
    expect((run as HTMLButtonElement).disabled).toBe(true);
  });

  it('clears a loaded plan as soon as the request changes', async () => {
    plan.mockResolvedValueOnce(erasePlan);
    const { rerender } = render(panel('r1'));
    await screen.findByText('governance.dsrExecute.identityVerified');
    plan.mockReturnValueOnce(new Promise(() => {}));
    rerender(panel('r2'));
    await waitFor(() => expect(screen.queryByText('governance.dsrExecute.identityVerified')).toBeNull());
    expect(screen.queryByText('governance.dsrExecute.run')).toBeNull();
  });
});
