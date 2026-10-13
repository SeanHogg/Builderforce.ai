// @vitest-environment jsdom
/**
 * The founder's journey (PRD 33 §5.3.5): Run when a company exists, else Make /
 * Measure from the realization journey signal, else Idea from the active session.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  companies: vi.fn(),
  journeySignal: vi.fn(),
  sessions: vi.fn(),
  realizations: vi.fn(),
}));

vi.mock('./AuthContext', () => ({ useAuth: () => ({ isAuthenticated: true, hasTenant: true }) }));
vi.mock('./investorApi', () => ({ investorApi: { companies: { list: api.companies } } }));
vi.mock('./builderforceApi', () => ({
  creationSessionsApi: { list: api.sessions },
  realizationApi: { journeySignal: api.journeySignal, list: api.realizations },
}));

import { useFounderJourney } from './useFounderJourney';

async function settle() {
  const { result } = renderHook(() => useFounderJourney());
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result.current;
}

beforeEach(() => {
  api.companies.mockReset().mockResolvedValue([]);
  api.journeySignal.mockReset().mockResolvedValue({ stage: null, realizationId: null });
  api.sessions.mockReset().mockResolvedValue({ sessions: [] });
  api.realizations.mockReset().mockResolvedValue([]);
});

describe('useFounderJourney', () => {
  it('Run keeps precedence when the workspace owns a company, whatever the proofs say', async () => {
    api.companies.mockResolvedValue([{ isPortfolio: false }]);
    api.journeySignal.mockResolvedValue({ stage: 'measure', realizationId: 'r1' });
    expect(await settle()).toMatchObject({ stage: 'run', act: null });
  });

  it('Measure when the newest proof has visitors', async () => {
    api.journeySignal.mockResolvedValue({ stage: 'measure', realizationId: 'r1' });
    expect(await settle()).toMatchObject({ stage: 'measure', activeRealizationId: 'r1', act: null });
  });

  it('Make while the newest proof is being made', async () => {
    api.journeySignal.mockResolvedValue({ stage: 'make', realizationId: 'r2' });
    expect(await settle()).toMatchObject({ stage: 'make', activeRealizationId: 'r2' });
  });

  it('falls back to Idea, with the act from the active session, when there is no proof signal', async () => {
    api.sessions.mockResolvedValue({ sessions: [{ id: 's1' }] });
    api.realizations.mockResolvedValue([{ verdict: 'met' }]);
    expect(await settle()).toMatchObject({ stage: 'idea', act: 'build', activeSessionId: 's1' });
  });

  it('a failed signal read never blocks the journey', async () => {
    api.journeySignal.mockRejectedValue(new Error('offline'));
    api.sessions.mockResolvedValue({ sessions: [{ id: 's1' }] });
    expect(await settle()).toMatchObject({ stage: 'idea', act: 'read' });
  });

  it('a brand-new tenant has no stage', async () => {
    expect(await settle()).toMatchObject({ stage: null });
  });
});
