import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// REAL catalog copy, not the key passthrough in `setup.ts`: this file asserts on the
// sentences a manager actually reads ("Baseline v4 · 210 facts", "Approve"), so a
// resolver that echoed keys back would pass while the app said something else.
vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

import { ApiRequestError } from '@/lib/apiClient';

const api = vi.hoisted(() => ({
  getLearningPipeline: vi.fn(),
  captureLearningBaseline: vi.fn(),
  reviewLearningCandidate: vi.fn(),
  transferLearningCandidate: vi.fn(),
}));

// The four learning helpers only. Spread the real module so the console's other
// exports survive — the surface shares `@/lib/projectEvermindApi` with the whole
// Evermind header, and blanking the module used to break unrelated suites.
vi.mock('@/lib/projectEvermindApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/projectEvermindApi')>()),
  ...api,
}));

import { EvermindLearningReview } from './EvermindLearningReview';
import type { LearningPipelineReport } from '@/lib/projectEvermindApi';

const CANDIDATE = {
  id: 7,
  statement: 'Retries use exponential backoff with a 30s ceiling.',
  factKey: 'retries.backoff',
  contradicts: false,
  baselineContent: null,
  createdAt: '2026-10-18T00:00:00.000Z',
};

/** A report as the API returns it. Every field the component reads is spelled out. */
const report = (over: Partial<LearningPipelineReport> = {}): LearningPipelineReport => ({
  baseline: { headVersion: 4, factCount: 210, capturedAt: '2026-10-17T09:00:00.000Z' },
  pending: [CANDIDATE],
  metrics: {
    runs: 12,
    produced: 6,
    candidates: 5,
    extractionRate: 80,
    contradictionRate: 5,
    reviewHours: 6,
    transferUplift: 15,
  },
  ...over,
});

beforeEach(() => {
  api.getLearningPipeline.mockReset();
  api.captureLearningBaseline.mockReset();
  api.reviewLearningCandidate.mockReset();
  api.transferLearningCandidate.mockReset();
  api.getLearningPipeline.mockResolvedValue(report());
  api.captureLearningBaseline.mockResolvedValue({ factCount: 210, headVersion: 4, capturedAt: '2026-10-18T00:00:00.000Z' });
  api.reviewLearningCandidate.mockResolvedValue({ id: CANDIDATE.id, status: 'approved' });
  api.transferLearningCandidate.mockResolvedValue({ ok: true, id: CANDIDATE.id });
});

describe('the Evermind learning pipeline report', () => {
  it('renders the baseline and the four key-result numbers the API returned', async () => {
    render(<EvermindLearningReview projectId={11} />);

    // Baseline — `pipelineBaseline` interpolates headVersion + factCount.
    expect(await screen.findByText(/Baseline v4 · 210 facts/i)).toBeTruthy();
    // Metrics — extraction %, contradiction %, review hours, then the uplift after the separator.
    expect(screen.getByText(/80% extracted · 5% contradict · review 6h/i)).toBeTruthy();
    expect(screen.getByText(/transfer 15%/i)).toBeTruthy();
    // The panel itself is labelled, so the surface is reachable without the copy.
    expect(screen.getByRole('region', { name: /Learning pipeline/i })).toBeTruthy();
  });

  it('says so plainly when there is no baseline and no bench pair yet', async () => {
    api.getLearningPipeline.mockResolvedValue(report({
      baseline: null,
      metrics: { ...report().metrics, reviewHours: null, transferUplift: null },
    }));
    render(<EvermindLearningReview projectId={11} />);

    expect(await screen.findByText(/No baseline yet/i)).toBeTruthy();
    expect(screen.getByText(/no bench pair yet/i)).toBeTruthy();
    // `pipelineReviewNone` is an em dash, so the metrics line reads "review —".
    expect(screen.getByText(/review —/i)).toBeTruthy();
  });

  it('lists each pending candidate and flags the one that contradicts the baseline', async () => {
    api.getLearningPipeline.mockResolvedValue(report({
      pending: [
        CANDIDATE,
        { ...CANDIDATE, id: 8, statement: 'Retries cap at 60s, not 30s.', contradicts: true },
      ],
    }));
    render(<EvermindLearningReview projectId={11} />);

    expect(await screen.findByText('Retries use exponential backoff with a 30s ceiling.')).toBeTruthy();
    expect(screen.getByText('Retries cap at 60s, not 30s.')).toBeTruthy();
    // Only the contradicting row carries the warning.
    const warns = screen.getAllByText(/Contradicts baseline/i);
    expect(warns).toHaveLength(1);
    // And the empty state is NOT drawn over a populated list.
    expect(screen.queryByText(/No learnings waiting for review/i)).toBeNull();
  });

  it('shows the empty state instead of buttons when nothing is waiting', async () => {
    api.getLearningPipeline.mockResolvedValue(report({ pending: [] }));
    render(<EvermindLearningReview projectId={11} />);

    expect(await screen.findByText(/No learnings waiting for review/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Approve$/i })).toBeNull();
  });
});

describe('reviewing a candidate', () => {
  it('approves the pressed candidate with the project, its id and the approved verdict', async () => {
    render(<EvermindLearningReview projectId={11} />);
    await screen.findByText(CANDIDATE.statement);

    fireEvent.click(screen.getByRole('button', { name: /^Approve$/i }));

    await waitFor(() => expect(api.reviewLearningCandidate).toHaveBeenCalledWith(11, 7, 'approved'));
    // Rejection is the same call with a different verdict — a swapped argument here
    // would approve what the manager rejected.
    expect(api.transferLearningCandidate).not.toHaveBeenCalled();
    // The panel reloads so a verdict is reflected without a page reload.
    await waitFor(() => expect(api.getLearningPipeline.mock.calls.length).toBeGreaterThan(1));
  });

  it('rejects the pressed candidate with the rejected verdict', async () => {
    render(<EvermindLearningReview projectId={11} />);
    await screen.findByText(CANDIDATE.statement);

    fireEvent.click(screen.getByRole('button', { name: /^Reject$/i }));

    await waitFor(() => expect(api.reviewLearningCandidate).toHaveBeenCalledWith(11, 7, 'rejected'));
  });

  it('verdicts the candidate that was actually pressed, in a list of several', async () => {
    api.getLearningPipeline.mockResolvedValue(report({
      pending: [
        CANDIDATE,
        { ...CANDIDATE, id: 9, statement: 'Deploys require two approvals.' },
      ],
    }));
    render(<EvermindLearningReview projectId={11} />);
    await screen.findByText(CANDIDATE.statement);

    const row = screen.getByText('Deploys require two approvals.').closest('li');
    expect(row).not.toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: /^Approve$/i })[1]!);

    await waitFor(() => expect(api.reviewLearningCandidate).toHaveBeenCalledWith(11, 9, 'approved'));
    expect(api.reviewLearningCandidate).not.toHaveBeenCalledWith(11, 7, 'approved');
  });

  it('transfers a candidate through its own client call, not a verdict', async () => {
    render(<EvermindLearningReview projectId={11} />);
    await screen.findByText(CANDIDATE.statement);

    fireEvent.click(screen.getByRole('button', { name: /^Transfer$/i }));

    await waitFor(() => expect(api.transferLearningCandidate).toHaveBeenCalledWith(11, 7));
    expect(api.reviewLearningCandidate).not.toHaveBeenCalled();
  });

  it('shows a failed review instead of swallowing it', async () => {
    api.reviewLearningCandidate.mockRejectedValue(new ApiRequestError('Verdict rejected by policy', 422));
    render(<EvermindLearningReview projectId={11} />);
    await screen.findByText(CANDIDATE.statement);

    fireEvent.click(screen.getByRole('button', { name: /^Approve$/i }));

    expect(await screen.findByText('Verdict rejected by policy')).toBeTruthy();
    // The failure is reported WITHOUT throwing away the list the manager was reading.
    expect(screen.getByText(CANDIDATE.statement)).toBeTruthy();
  });
});

describe('when the report will not load', () => {
  it('surfaces a failed fetch as copy instead of a blank or crashed tree', async () => {
    api.getLearningPipeline.mockRejectedValue(new ApiRequestError('Pipeline service unavailable', 503));
    render(<EvermindLearningReview projectId={11} />);

    // The repo's check:error-fallbacks discipline: the reader is TOLD.
    expect(await screen.findByText('Pipeline service unavailable')).toBeTruthy();
    // Still a rendered panel, not a bare message — the title and the capture action survive.
    expect(screen.getByRole('region', { name: /Learning pipeline/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Capture baseline/i })).toBeTruthy();
    // And no candidate controls are invented for a report that never arrived.
    expect(screen.queryByRole('button', { name: /^Approve$/i })).toBeNull();
  });

  it('shows the message of a rejection that is not an ApiRequestError', async () => {
    api.getLearningPipeline.mockRejectedValue(new Error('boom'));
    render(<EvermindLearningReview projectId={11} />);

    // `err.message` is preferred over `t('error')`, so "boom" is what is shown —
    // asserted here so a change to that precedence is deliberate rather than silent.
    expect(await screen.findByText('boom')).toBeTruthy();
  });

  it('stays silent for a 403 rather than telling a non-manager it is broken', async () => {
    api.getLearningPipeline.mockRejectedValue(new ApiRequestError('Not a manager', 403));
    const { container } = render(<EvermindLearningReview projectId={11} />);

    // Nothing rendered and nothing thrown — but only AFTER the rejection settles.
    await waitFor(() => expect(api.getLearningPipeline).toHaveBeenCalledWith(11));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container.innerHTML).toBe('');
    // The contrast case is the assertion: the SAME rejection at 503 renders this
    // copy (the test above), so an empty tree here is the 403 branch doing its
    // job — not a fetch that has not settled yet.
    expect(screen.queryByText('Not a manager')).toBeNull();
  });

  it('retries a failed load when the project changes, and the retry can succeed', async () => {
    api.getLearningPipeline
      .mockRejectedValueOnce(new ApiRequestError('Pipeline service unavailable', 503))
      .mockResolvedValueOnce(report());
    const { rerender } = render(<EvermindLearningReview projectId={11} />);
    expect(await screen.findByText('Pipeline service unavailable')).toBeTruthy();

    rerender(<EvermindLearningReview projectId={12} />);

    expect(await screen.findByText(CANDIDATE.statement)).toBeTruthy();
    expect(api.getLearningPipeline).toHaveBeenLastCalledWith(12);
  });
});

describe('no project', () => {
  it('no-ops: no fetch, no panel, no crash', async () => {
    const { container } = render(<EvermindLearningReview projectId={null} />);

    expect(container.innerHTML).toBe('');
    // Give the effect a tick — an unguarded `reload()` would have fired by now.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.getLearningPipeline).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe('');
  });

  it('fetches again when a project is supplied after the null render', async () => {
    const { rerender, container } = render(<EvermindLearningReview projectId={null} />);
    expect(api.getLearningPipeline).not.toHaveBeenCalled();

    rerender(<EvermindLearningReview projectId={11} />);

    expect(await screen.findByText(CANDIDATE.statement)).toBeTruthy();
    expect(container.innerHTML).not.toBe('');
  });
});