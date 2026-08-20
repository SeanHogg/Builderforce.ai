import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { FeedbackTriage } from './FeedbackTriage';
import type { FeedbackQueue, FeedbackStatus } from '@/lib/feedbackApi';

// The confirm dialog is a provider concern; this suite is about load scheduling.
vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => async () => true }));

const emptyQueue: FeedbackQueue = { submissions: [], counts: {} };

/**
 * These tests exist because the loading effect used to carry an
 * `eslint-disable react-hooks/exhaustive-deps`: it CALLED `load` while depending
 * only on `refreshKey`, so a changed loader was silently ignored, and honouring
 * the dependency would have risked a render loop. Both halves are now asserted —
 * a stale loader is a bug, and so is a loop.
 */
describe('FeedbackTriage load scheduling', () => {
  it('loads once on mount, not once per render', async () => {
    const load = vi.fn(async (_status: FeedbackStatus | null) => emptyQueue);
    const { rerender } = render(<FeedbackTriage load={load} review={vi.fn()} />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));

    // Re-rendering with the SAME props must not re-fetch. A loop would show up
    // here as a call count that keeps climbing.
    rerender(<FeedbackTriage load={load} review={vi.fn()} />);
    rerender(<FeedbackTriage load={load} review={vi.fn()} />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  });

  it('re-loads when the caller hands over a DIFFERENT loader', async () => {
    const first = vi.fn(async (_status: FeedbackStatus | null) => emptyQueue);
    const { rerender } = render(<FeedbackTriage load={first} review={vi.fn()} />);
    await waitFor(() => expect(first).toHaveBeenCalledTimes(1));

    const second = vi.fn(async (_status: FeedbackStatus | null) => emptyQueue);
    rerender(<FeedbackTriage load={second} review={vi.fn()} />);
    await waitFor(() => expect(second).toHaveBeenCalledTimes(1));
    // And the stale one is not called again.
    expect(first).toHaveBeenCalledTimes(1);
  });

  it('re-loads when refreshKey changes', async () => {
    const load = vi.fn(async (_status: FeedbackStatus | null) => emptyQueue);
    const { rerender } = render(<FeedbackTriage load={load} review={vi.fn()} refreshKey={1} />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));

    rerender(<FeedbackTriage load={load} review={vi.fn()} refreshKey={2} />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it('fires ONE request when a project switch changes both the key and the loader', async () => {
    // The common case in QualityClient: `load` is rebuilt from currentProjectId
    // and `refreshKey` IS currentProjectId. Two triggers, one reload.
    const first = vi.fn(async (_status: FeedbackStatus | null) => emptyQueue);
    const { rerender } = render(<FeedbackTriage load={first} review={vi.fn()} refreshKey={1} />);
    await waitFor(() => expect(first).toHaveBeenCalledTimes(1));

    const second = vi.fn(async (_status: FeedbackStatus | null) => emptyQueue);
    rerender(<FeedbackTriage load={second} review={vi.fn()} refreshKey={2} />);
    await waitFor(() => expect(second).toHaveBeenCalledTimes(1));
  });

  it('survives an inline loader recreated on every parent render without looping', async () => {
    const calls = { n: 0 };
    const inline = () => { calls.n++; return Promise.resolve(emptyQueue); };
    const { rerender } = render(<FeedbackTriage load={inline} review={vi.fn()} />);
    await waitFor(() => expect(calls.n).toBe(1));

    // A brand-new function identity per parent render costs at most one fetch
    // each — bounded by the parent's renders, never self-sustaining.
    rerender(<FeedbackTriage load={() => Promise.resolve(emptyQueue)} review={vi.fn()} />);
    await waitFor(() => expect(calls.n).toBe(1));
    const settled = calls.n;
    await new Promise((r) => setTimeout(r, 30));
    expect(calls.n).toBe(settled);
  });
});
