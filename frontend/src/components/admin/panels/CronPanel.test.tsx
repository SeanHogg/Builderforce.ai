import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CronPanel from './CronPanel';
import { adminApi, type AdminCronRunResult, type AdminCronState } from '@/lib/adminApi';

/**
 * The panel exists so an operator can answer "did the scheduled sweep run, and what
 * did it do?" without `wrangler tail` and without waiting out the KV work-gate. So
 * the states worth pinning are: the gate's decision is legible (including that an
 * IDLE gate is not the same as "nothing pending"), forcing a sweep that spends
 * tokens is confirmed first, and a sweep that outlives the response deadline reads
 * as still-running rather than failed.
 *
 * Copy is the passthrough key under the global next-intl mock (src/test/setup.ts).
 */

const confirmSpy = vi.fn();
vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => confirmSpy }));

const state = (over: Partial<AdminCronState['gate']> = {}): AdminCronState => ({
  now: '2026-07-26T12:00:00.000Z',
  gate: {
    wouldRun: true,
    reason: 'floor',
    floorDue: true,
    floorIntervalMs: 1_800_000,
    floorIntervalOverridden: false,
    lastFloorSweepAt: '2026-07-26T11:20:00.000Z',
    nextFloorDueAt: '2026-07-26T11:50:00.000Z',
    kvBound: true,
    ...over,
  },
  cadences: [
    { cadence: 'frequent', cron: null, sweeps: 2 },
    { cadence: 'daily', cron: '0 9 * * *', sweeps: 1 },
  ],
  sweeps: [
    { key: 'manager', cadence: 'frequent', description: 'AI Manager pass.', dispatches: true, available: true },
    { key: 'exec-reaper', cadence: 'frequent', description: 'Fail stranded executions.', dispatches: false, available: true },
    { key: 'demo-reseed', cadence: 'daily', description: 'Reseed demo tenants.', dispatches: false, available: false },
  ],
});

const runResult = (over: Partial<AdminCronRunResult> = {}): AdminCronRunResult => ({
  target: 'exec-reaper',
  kind: 'sweep',
  ranAt: '2026-07-26T12:00:01.000Z',
  totalMs: 812,
  dispatchesReserved: 0,
  results: [{ key: 'exec-reaper', cadence: 'frequent', ok: true, ms: 810, summary: 'failed=2' }],
  ...over,
});

describe('CronPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    confirmSpy.mockReset();
    vi.spyOn(adminApi, 'cronState').mockResolvedValue(state());
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('lists the registered sweeps under their cadence with the gate decision', async () => {
    render(<CronPanel />);
    expect(await screen.findByText('manager')).toBeInTheDocument();
    expect(screen.getByText('exec-reaper')).toBeInTheDocument();
    // The frequent group has no cron expression of its own — it is the work-gated tick.
    expect(screen.getByText('admin.cron.cadence.everyFiveMinutes')).toBeInTheDocument();
    expect(screen.getByText('0 9 * * *')).toBeInTheDocument();
    expect(screen.getByText('admin.cron.gate.wouldRun')).toBeInTheDocument();
    // A sweep the environment disables is labelled rather than silently missing.
    expect(screen.getByText('admin.cron.badge.unavailable')).toBeInTheDocument();
  });

  /**
   * The non-obvious failure this panel was built for: an idle gate reads as healthy
   * but means "nothing signalled", and a board of stalled tickets never signals.
   */
  it('explains an idle gate instead of just reporting it', async () => {
    vi.spyOn(adminApi, 'cronState').mockResolvedValue(state({ wouldRun: false, reason: 'idle', floorDue: false }));
    render(<CronPanel />);
    expect(await screen.findByText('admin.cron.gate.wouldSkip')).toBeInTheDocument();
    expect(screen.getByText('admin.cron.gate.explainIdle')).toBeInTheDocument();
  });

  it('runs a non-dispatching sweep without a confirmation and shows its summary', async () => {
    const run = vi.spyOn(adminApi, 'cronRun').mockResolvedValue(runResult());
    render(<CronPanel />);
    await screen.findByText('exec-reaper');
    const row = screen.getByText('exec-reaper').closest('tr')!;
    await act(async () => { fireEvent.click(row.querySelector('button')!); });
    await waitFor(() => expect(run).toHaveBeenCalledWith('exec-reaper'));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(await screen.findByText('failed=2')).toBeInTheDocument();
  });

  /** A forced sweep that dispatches spends tokens across every tenant — never on one click. */
  it('confirms before forcing a sweep that starts agent runs, and honours a decline', async () => {
    const run = vi.spyOn(adminApi, 'cronRun').mockResolvedValue(runResult());
    confirmSpy.mockResolvedValue(false);
    render(<CronPanel />);
    await screen.findByText('manager');
    const row = screen.getByText('manager').closest('tr')!;
    await act(async () => { fireEvent.click(row.querySelector('button')!); });
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(run).not.toHaveBeenCalled();
  });

  it('runs the dispatching sweep once confirmed', async () => {
    const run = vi.spyOn(adminApi, 'cronRun').mockResolvedValue(runResult({
      target: 'manager',
      dispatchesReserved: 3,
      results: [{ key: 'manager', cadence: 'frequent', ok: true, ms: 4_100, summary: 'managed=2 dispatched=3' }],
    }));
    confirmSpy.mockResolvedValue(true);
    render(<CronPanel />);
    await screen.findByText('manager');
    const row = screen.getByText('manager').closest('tr')!;
    await act(async () => { fireEvent.click(row.querySelector('button')!); });
    await waitFor(() => expect(run).toHaveBeenCalledWith('manager'));
    expect(await screen.findByText('managed=2 dispatched=3')).toBeInTheDocument();
  });

  /** timedOut is "still running", NOT a failure — the request answered, the sweep didn't. */
  it('reports a deadline overrun as still-running rather than failed', async () => {
    vi.spyOn(adminApi, 'cronRun').mockResolvedValue(runResult({
      results: [{ key: 'exec-reaper', cadence: 'frequent', ok: true, ms: 20_000, summary: null, timedOut: true }],
    }));
    render(<CronPanel />);
    await screen.findByText('exec-reaper');
    const row = screen.getByText('exec-reaper').closest('tr')!;
    await act(async () => { fireEvent.click(row.querySelector('button')!); });
    expect(await screen.findByText(/admin\.cron\.outcome\.timedOut 20000/)).toBeInTheDocument();
  });

  it('surfaces a failed sweep with its error', async () => {
    vi.spyOn(adminApi, 'cronRun').mockResolvedValue(runResult({
      results: [{ key: 'exec-reaper', cadence: 'frequent', ok: false, ms: 90, summary: null, error: 'neon unreachable' }],
    }));
    render(<CronPanel />);
    await screen.findByText('exec-reaper');
    const row = screen.getByText('exec-reaper').closest('tr')!;
    await act(async () => { fireEvent.click(row.querySelector('button')!); });
    expect(await screen.findByText(/neon unreachable/)).toBeInTheDocument();
  });

  /** Signalling is the ONLY way to exercise the gate — the force-run bypasses it. */
  it('arms the work-gate signal for the next real tick', async () => {
    const signal = vi.spyOn(adminApi, 'cronSignal').mockResolvedValue({ ok: true, gate: { wouldRun: true, reason: 'signal' } });
    render(<CronPanel />);
    const signalBtn = await screen.findByText('admin.cron.actions.signal');
    await act(async () => { fireEvent.click(signalBtn); });
    await waitFor(() => expect(signal).toHaveBeenCalled());
    expect(await screen.findByText('admin.cron.gate.signalled')).toBeInTheDocument();
  });

  it('disables signalling when KV is unbound, because the gate already fails open', async () => {
    vi.spyOn(adminApi, 'cronState').mockResolvedValue(state({ kvBound: false }));
    render(<CronPanel />);
    const button = await screen.findByText('admin.cron.actions.signal');
    expect(button.closest('button')).toBeDisabled();
    expect(screen.getAllByText('admin.cron.gate.kvUnbound').length).toBeGreaterThan(0);
  });
});
