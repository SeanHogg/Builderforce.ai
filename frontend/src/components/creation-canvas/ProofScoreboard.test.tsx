import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ProofEvaluationDto, ProofMeasure } from '@builderforce/interaction-contract';
import { realizationApi, type Realization } from '@/lib/builderforceApi';
import { scoreboardStatus } from './proofScoreboardModel';

/**
 * PRD 33 §5.3 — the proof scoreboard: the kill condition in words, sample and
 * success progress, the status pill, the non-converting watch link, the cited
 * "why it missed", an early call that REQUIRES a reason, and "Read again" once graded.
 */

vi.mock('@/components/SlideOutPanel', () => ({
  SlideOutPanel: ({ open, title, children }: { open: boolean; title?: React.ReactNode; children: React.ReactNode }) =>
    (open ? <div role="dialog" aria-label={String(title)}>{children}</div> : null),
}));

const { ProofScoreboard } = await import('./ProofScoreboard');

const SITE = '11111111-1111-4111-8111-111111111111';
const MEASURE: ProofMeasure = {
  sample: { filter: { all: [{ field: 'tag', op: 'neq', value: 'source=direct' }] }, min: 500 },
  success: { kind: 'smartEvent', ref: 'sign up' },
  threshold: { op: '>=', value: 25, unit: 'count' },
  windowDays: 14,
};
const DAY = 86_400_000;

function evaluation(over: Partial<ProofEvaluationDto> = {}): ProofEvaluationDto {
  const start = Date.now() - 7 * DAY;
  return {
    realizationId: 'r1',
    siteId: SITE,
    measure: MEASURE,
    sampleN: 300,
    sampleMin: 500,
    sampleReached: false,
    successN: 15,
    value: 15,
    threshold: MEASURE.threshold,
    status: 'collecting',
    windowStartedAt: new Date(start).toISOString(),
    windowEndsAt: new Date(start + 14 * DAY).toISOString(),
    releaseKeys: [],
    evidenceRecordingIds: [],
    patterns: [],
    ...over,
  };
}

const proof = (over: Partial<Realization> = {}) => ({
  id: 'r1',
  verdict: null,
  sessionId: 's1',
  spec: { goal: 'Answer order questions' },
  measure: MEASURE,
  ...over,
}) as unknown as Realization;

beforeEach(() => {
  vi.spyOn(realizationApi, 'measure').mockResolvedValue(evaluation());
  vi.spyOn(realizationApi, 'callEarly').mockResolvedValue(proof({ verdict: 'missed' }));
});
afterEach(() => { vi.restoreAllMocks(); });

describe('ProofScoreboard', () => {
  it('renders nothing — and reads nothing — for a proof with no measure', () => {
    const { container } = render(<ProofScoreboard realization={proof({ measure: null })} />);
    expect(container).toBeEmptyDOMElement();
    expect(realizationApi.measure).not.toHaveBeenCalled();
  });

  it('states the kill condition, both progress bars and the days left', async () => {
    render(<ProofScoreboard realization={proof()} />);
    expect(await screen.findByText(/creationCanvas\.proof\.killAtLeast sign up 25 500 14/)).toBeInTheDocument();
    const bars = screen.getAllByRole('progressbar');
    expect(bars.map((b) => b.getAttribute('aria-valuenow'))).toEqual(['60', '60']);
    expect(screen.getByText(/creationCanvas\.proof\.daysLeft 7/)).toBeInTheDocument();
    // 300 of 500 at half-time projects 600 visits; 15 signups project 30 ≥ 25.
    expect(screen.getByText('creationCanvas.proof.status.onTrack')).toHaveAttribute('data-status', 'onTrack');
  });

  it('links "Watch the visitors who didn\'t" to the Insights issues panel over the non-converting sample', async () => {
    render(<ProofScoreboard realization={proof()} />);
    const link = await screen.findByRole('link', { name: 'creationCanvas.proof.watch' });
    const href = new URL(link.getAttribute('href')!, 'https://x.test');
    expect(href.pathname).toBe('/apps/insights');
    expect(href.searchParams.get('site')).toBe(SITE);
    expect(href.searchParams.get('panel')).toBe('issues');
    expect(href.searchParams.get('f.smartEvent.neq')).toBe('sign up');
    expect(href.searchParams.get('f.tag.neq')).toBe('source=direct');
  });

  it('a missed proof shows the cited patterns and "Read again with what we learned"', async () => {
    vi.mocked(realizationApi.measure).mockResolvedValue(evaluation({
      status: 'missed',
      patterns: [{ text: 'Visitors left at the price', examples: [{ recordingId: 'rec-1', atMs: 10 }] }],
    }));
    render(<ProofScoreboard realization={proof({ verdict: 'missed' })} />);
    expect(await screen.findByText('Visitors left at the price')).toBeInTheDocument();
    expect(screen.getByText('creationCanvas.proof.status.missed')).toBeInTheDocument();
    const again = screen.getByRole('link', { name: 'creationCanvas.proof.readAgain' });
    expect(again.getAttribute('href')).toMatch(/^\/realize\?prior=r1&idea=Answer\+order\+questions&session=s1$/);
    expect(screen.queryByRole('button', { name: 'creationCanvas.proof.callEarly' })).toBeNull();
  });

  it('"Call it early…" requires a written reason, then grades and reports the change', async () => {
    const onChange = vi.fn();
    render(<ProofScoreboard realization={proof()} onRealizationChange={onChange} />);
    fireEvent.click(await screen.findByRole('button', { name: 'creationCanvas.proof.callEarly' }));
    const submit = screen.getByRole('button', { name: 'creationCanvas.proof.callEarlySubmit' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('creationCanvas.proof.reasonLabel'), { target: { value: 'The channel is exhausted.' } });
    fireEvent.click(submit);
    await waitFor(() => expect(realizationApi.callEarly).toHaveBeenCalledWith('r1', 'The channel is exhausted.'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ verdict: 'missed' })));
  });
});

describe('scoreboardStatus', () => {
  const now = new Date('2026-03-08T00:00:00Z');
  const window = { windowStartedAt: '2026-03-01T00:00:00Z', windowEndsAt: '2026-03-15T00:00:00Z' };
  it('says at risk when the pace will not reach the threshold', () => {
    expect(scoreboardStatus({ ...evaluation(), ...window, value: 5 }, null, now)).toBe('atRisk');
  });
  it('stays collecting in the first tenth of the window', () => {
    expect(scoreboardStatus({ ...evaluation(), ...window, value: 0 }, null, new Date('2026-03-01T12:00:00Z'))).toBe('collecting');
  });
  it('a recorded grade wins over the projection', () => {
    expect(scoreboardStatus({ ...evaluation(), ...window }, 'met', now)).toBe('met');
  });
});
