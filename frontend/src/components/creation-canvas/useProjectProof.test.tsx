import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { realizationApi, type Realization } from '@/lib/realizationApi';
import { useProjectProof } from './useProjectProof';

/**
 * The project's live proof: the newest BUILT realization that carries a visitor
 * measure, chosen by the server; another project's answer is never shown.
 */

// `recordedFailure` posts to the ingest; here it just resolves to its fallback (its own test is `lib/reportError.test.ts`).
const recorded = vi.hoisted(() => ({ reasons: [] as string[] }));
vi.mock('@/lib/reportError', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/reportError')>()),
  recordedFailure: (what: string, fallback: unknown) => () => { recorded.reasons.push(what); return fallback; },
}));

const MEASURE = { metric: 'conversions', successAt: 10, killAt: 0, sampleMin: 100 };
const proof = (over: Partial<Realization>): Realization => ({ id: 'r', projectId: 7, status: 'built', measure: MEASURE, title: 't', ...over } as unknown as Realization);

afterEach(() => { vi.restoreAllMocks(); recorded.reasons.length = 0; });

describe('useProjectProof', () => {
  it('shows the live proof the server picked for this project, asking for this project only', async () => {
    const ask = vi.spyOn(realizationApi, 'liveProofForProject').mockResolvedValue(proof({ id: 'live' }));
    const { result } = renderHook(() => useProjectProof(7));
    await waitFor(() => expect(result.current[0]?.id).toBe('live'));
    expect(ask).toHaveBeenCalledWith(7);
  });

  it('is null when the project has no live proof', async () => {
    const ask = vi.spyOn(realizationApi, 'liveProofForProject').mockResolvedValue(null);
    const { result } = renderHook(() => useProjectProof(7));
    await waitFor(() => expect(ask).toHaveBeenCalled());
    expect(result.current[0]).toBeNull();
  });

  it('is null for an unknown project and never reads', () => {
    const list = vi.spyOn(realizationApi, 'liveProofForProject');
    const { result } = renderHook(() => useProjectProof(null));
    expect(result.current[0]).toBeNull();
    expect(list).not.toHaveBeenCalled();
  });

  it('shows nothing for a new project until its own read lands', async () => {
    vi.spyOn(realizationApi, 'liveProofForProject')
      .mockResolvedValueOnce(proof({ id: 'seven' }))
      .mockImplementationOnce(() => new Promise(() => undefined));
    const { result, rerender } = renderHook(({ id }) => useProjectProof(id), { initialProps: { id: 7 } });
    await waitFor(() => expect(result.current[0]?.id).toBe('seven'));
    rerender({ id: 8 });
    expect(result.current[0]).toBeNull();
  });

  it('is null, and the failure is recorded, when the read fails', async () => {
    vi.spyOn(realizationApi, 'liveProofForProject').mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useProjectProof(7));
    await waitFor(() => expect(recorded.reasons).toEqual(['Reading the project proof']));
    expect(result.current[0]).toBeNull();
  });
});
