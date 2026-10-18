// @vitest-environment jsdom
/**
 * The founder's journey (PRD 33 §5.3.5): Run when a company exists, else Make /
 * Measure from the realization journey signal, else Idea from the active session —
 * all read from ONE cached summary (`GET /api/realizations/journey-summary`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { FounderJourneySummary } from './realizationApi';

const api = vi.hoisted(() => ({ journeySummary: vi.fn() }));

vi.mock('./AuthContext', () => ({ useAuth: () => ({ isAuthenticated: true, hasTenant: true }) }));
vi.mock('./realizationApi', () => ({ realizationApi: { journeySummary: api.journeySummary } }));

import { invalidateFounderJourney, journeyFromSummary, useFounderJourney } from './useFounderJourney';

const NONE: FounderJourneySummary = {
  ownsCompany: false,
  signal: { stage: null, realizationId: null },
  activeSessionId: null,
  activeSessionLatestProof: null,
};
const summary = (overrides: Partial<FounderJourneySummary>): FounderJourneySummary => ({ ...NONE, ...overrides });

async function settle() {
  const { result } = renderHook(() => useFounderJourney());
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result.current;
}

beforeEach(() => {
  // The journey is shared across mounts (module cache); each case reads afresh.
  invalidateFounderJourney();
  api.journeySummary.mockReset().mockResolvedValue(NONE);
});

describe('journeyFromSummary', () => {
  it('Run keeps precedence when the workspace owns a company, whatever the proofs say', () => {
    expect(journeyFromSummary(summary({ ownsCompany: true, signal: { stage: 'measure', realizationId: 'r1' } }))).toMatchObject({ stage: 'run', act: null });
  });

  it('Measure / Make from the newest proof signal', () => {
    expect(journeyFromSummary(summary({ signal: { stage: 'measure', realizationId: 'r1' } }))).toMatchObject({ stage: 'measure', activeRealizationId: 'r1', act: null });
    expect(journeyFromSummary(summary({ signal: { stage: 'make', realizationId: 'r2' } }))).toMatchObject({ stage: 'make', activeRealizationId: 'r2' });
  });

  it('falls back to Idea, with the act from the active session proof', () => {
    expect(journeyFromSummary(summary({ activeSessionId: 's1', activeSessionLatestProof: { verdict: 'met' } }))).toMatchObject({ stage: 'idea', act: 'build', activeSessionId: 's1' });
    expect(journeyFromSummary(summary({ activeSessionId: 's1', activeSessionLatestProof: { verdict: 'missed' } }))).toMatchObject({ act: 'prove' });
    expect(journeyFromSummary(summary({ activeSessionId: 's1' }))).toMatchObject({ stage: 'idea', act: 'read' });
  });

  it('a brand-new tenant has no stage', () => {
    expect(journeyFromSummary(NONE)).toMatchObject({ stage: null });
  });
});

describe('useFounderJourney', () => {
  it('places the workspace from the summary', async () => {
    api.journeySummary.mockResolvedValue(summary({ signal: { stage: 'make', realizationId: 'r2' } }));
    expect(await settle()).toMatchObject({ stage: 'make', activeRealizationId: 'r2' });
  });

  it('a failed summary read leaves the journey empty rather than loading forever', async () => {
    api.journeySummary.mockRejectedValue(new Error('offline'));
    expect(await settle()).toMatchObject({ stage: null, loading: false });
  });

  it('mounts on one page share ONE read', async () => {
    api.journeySummary.mockResolvedValue(summary({ signal: { stage: 'make', realizationId: 'r2' } }));
    const a = renderHook(() => useFounderJourney());
    const b = renderHook(() => useFounderJourney());
    await waitFor(() => expect(a.result.current.loading).toBe(false));
    await waitFor(() => expect(b.result.current.loading).toBe(false));
    expect(b.result.current).toMatchObject({ stage: 'make' });
    expect(api.journeySummary).toHaveBeenCalledTimes(1);
  });
});
