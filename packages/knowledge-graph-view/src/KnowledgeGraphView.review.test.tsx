// @vitest-environment jsdom
/** The review chip end to end (PRD 38 §4.3): estimate, running, Stop, Done → Continue, and Live after it. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { KnowledgeGraphView } from './KnowledgeGraphView';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from './labels';
import { FIXTURE_PLAN, FIXTURE_REPORT, docsFixture, fixtureSource } from './testing';
import type { KnowledgeReviewEvent, ReviewControl, ReviewEstimate, ReviewRequest } from './types';

vi.mock('./scene/GraphScene', () => ({ default: () => null }));

interface ScriptOptions {
  estimate?: ReviewEstimate;
  unjudged?: number;
}

/** A review the test steps through: plan → (Confirm) → progress → waits for `finish()` or Stop → done. */
function scripted(opts: ScriptOptions = {}) {
  const run = { signal: null as AbortSignal | null, finish: (() => undefined) as () => void, requests: [] as ReviewRequest[] };
  const unsubscribe = vi.fn();
  const subscribeLive = vi.fn((_rootId: string, _cb: unknown) => unsubscribe);
  const review = (req: ReviewRequest, ctl: ReviewControl): AsyncGenerator<KnowledgeReviewEvent> => {
    run.requests.push(req);
    run.signal = ctl.signal;
    return (async function* (): AsyncGenerator<KnowledgeReviewEvent> {
      const plan = { ...FIXTURE_PLAN };
      yield opts.estimate ? { type: 'plan', plan, estimate: opts.estimate } : { type: 'plan', plan };
      if (!(await ctl.confirm(plan, opts.estimate))) { yield { type: 'cancelled' }; return; }
      yield { type: 'progress', progress: { phase: 'judge', done: 2, total: 5, path: 'policy/termination.md' } };
      await new Promise<void>((resolve) => {
        run.finish = resolve;
        ctl.signal.addEventListener('abort', () => resolve());
      });
      if (ctl.signal.aborted) return;
      yield { type: 'done', rootId: plan.rootId, report: { ...FIXTURE_REPORT, unjudged: opts.unjudged ?? 0 } };
    })();
  };
  const source = Object.assign(fixtureSource([docsFixture()]), { review, subscribeLive });
  return { source, run, subscribeLive, unsubscribe };
}

async function startReview(source: ReturnType<typeof scripted>['source']) {
  render(<div style={{ height: 600 }}><KnowledgeGraphView source={source} /></div>);
  await screen.findByTestId('kg-list');
  fireEvent.click(screen.getByRole('button', { name: L.reviewFolder }));
}

describe('review confirm chip', () => {
  it('shows ≈ calls and ≈ cost when the host priced the pass, and no pending note', async () => {
    const { source } = scripted({ estimate: { modelCalls: 4, costUsd: 0.08 } });
    await startReview(source);
    expect(await screen.findByText(/^≈ 4 model calls · ≈ .*0[.,]08/)).toBeTruthy();
    expect(screen.queryByText(L.reviewPlanCostPending)).toBeNull();
  });

  it('shows ≈ calls and the localized "cost shown after routing" note when it did not', async () => {
    const { source } = scripted({ estimate: { modelCalls: 4 } });
    await startReview(source);
    expect(await screen.findByText('≈ 4 model calls')).toBeTruthy();
    expect(screen.getByText(L.reviewPlanCostPending)).toBeTruthy();
  });

  it('shows ≈ calls and the local note, no price, when the pass runs on the person’s local model', async () => {
    const { source } = scripted({ estimate: { modelCalls: 4, costUsd: 0, local: true } });
    await startReview(source);
    expect(await screen.findByText('≈ 4 model calls')).toBeTruthy();
    expect(screen.getByText(L.reviewPlanCostLocal)).toBeTruthy();
    expect(screen.queryByText(L.reviewPlanCostPending)).toBeNull();
  });

  it('names packs in words, not ids', async () => {
    const { source } = scripted();
    await startReview(source);
    expect(await screen.findByText('Documents: 3 files')).toBeTruthy();
    expect(screen.queryByText('docs: 3 files')).toBeNull();
  });
});

describe('review run', () => {
  it('shows phase, n of m, a bar and the file while running, and Stop aborts it', async () => {
    const { source, run } = scripted();
    await startReview(source);
    fireEvent.click(await screen.findByRole('button', { name: L.reviewConfirm }));

    expect(await screen.findByText('Judging · 2 of 5')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('40');
    expect(screen.getByText('policy/termination.md')).toBeTruthy();
    expect(run.signal!.aborted).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: L.reviewStop }));
    expect(run.signal!.aborted).toBe(true);
    expect(await screen.findByText(L.reviewAborted)).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('ends on Done with what was written, and offers no Continue when nothing is left', async () => {
    const { source, run } = scripted({ unjudged: 0 });
    await startReview(source);
    fireEvent.click(await screen.findByRole('button', { name: L.reviewConfirm }));
    await screen.findByText('Judging · 2 of 5');
    run.finish();
    expect(await screen.findByText(L.reviewDoneTitle)).toBeTruthy();
    expect(screen.getByText('2 files read · 4 sections judged · 3 facts written')).toBeTruthy();
    expect(screen.queryByRole('button', { name: L.reviewContinue })).toBeNull();
  });

  it('offers Continue when sections were left unjudged, and Continue reviews the same root again', async () => {
    const { source, run } = scripted({ unjudged: 3 });
    await startReview(source);
    fireEvent.click(await screen.findByRole('button', { name: L.reviewConfirm }));
    await screen.findByText('Judging · 2 of 5');
    run.finish();
    expect(await screen.findByText('3 sections were left for later by the budget.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: L.reviewContinue }));
    await waitFor(() => expect(run.requests).toHaveLength(2));
    expect(run.requests[1]).toEqual({ rootId: 'docs' });
  });
});

describe('Live after a review', () => {
  it('subscribes to the open root, and again once a review of it finishes (its directory is now watchable)', async () => {
    const { source, run, subscribeLive, unsubscribe } = scripted();
    await startReview(source);
    await waitFor(() => expect(subscribeLive).toHaveBeenCalledTimes(1));
    expect(subscribeLive.mock.calls[0]![0]).toBe('docs');

    fireEvent.click(await screen.findByRole('button', { name: L.reviewConfirm }));
    await screen.findByText('Judging · 2 of 5');
    run.finish();
    await screen.findByText(L.reviewDoneTitle);

    await waitFor(() => expect(subscribeLive).toHaveBeenCalledTimes(2));
    expect(subscribeLive.mock.calls[1]![0]).toBe('docs');
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
