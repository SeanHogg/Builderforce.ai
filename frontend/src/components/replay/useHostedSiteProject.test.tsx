import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { replaySitesApi } from '@/lib/replaySitesApi';
import { useHostedSiteProject } from './useHostedSiteProject';

/** The project behind a hosted Insights site; never the previous site's project after a switch. */

// `recordedFailure` posts to the ingest; here it just resolves to its fallback (its own test is `lib/reportError.test.ts`).
const recorded = vi.hoisted(() => ({ reasons: [] as string[] }));
vi.mock('@/lib/reportError', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/reportError')>()),
  recordedFailure: (what: string, fallback: unknown) => () => { recorded.reasons.push(what); return fallback; },
}));

afterEach(() => { vi.restoreAllMocks(); recorded.reasons.length = 0; });

describe('useHostedSiteProject', () => {
  it('names the project of a hosted site and nothing for an external one', async () => {
    const get = vi.spyOn(replaySitesApi, 'get')
      .mockResolvedValueOnce({ kind: 'hosted', projectId: 42 } as never)
      .mockResolvedValueOnce({ kind: 'external', projectId: null } as never);
    const { result, rerender } = renderHook(({ id }) => useHostedSiteProject(id), { initialProps: { id: 'site-a' } });
    await waitFor(() => expect(result.current).toBe(42));
    rerender({ id: 'site-b' });
    await waitFor(() => expect(get).toHaveBeenCalledWith('site-b'));
    await waitFor(() => expect(result.current).toBeNull());
  });

  it('reads null the moment the site changes, before the new site answers', async () => {
    vi.spyOn(replaySitesApi, 'get')
      .mockResolvedValueOnce({ kind: 'hosted', projectId: 42 } as never)
      .mockImplementationOnce(() => new Promise(() => undefined));
    const { result, rerender } = renderHook(({ id }) => useHostedSiteProject(id), { initialProps: { id: 'site-a' } });
    await waitFor(() => expect(result.current).toBe(42));
    rerender({ id: 'site-b' });
    expect(result.current).toBeNull();
  });

  it('is null when the read fails', async () => {
    vi.spyOn(replaySitesApi, 'get').mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useHostedSiteProject('site-a'));
    await waitFor(() => expect(recorded.reasons).toEqual(['Reading the Insights site']));
    expect(result.current).toBeNull();
  });
});
