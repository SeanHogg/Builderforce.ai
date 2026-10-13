import { afterEach, describe, expect, it, vi } from 'vitest';
import { REPLAY_PATHS } from '@builderforce/interaction-contract';

/**
 * The analysis half of the Insights client (S4c), reached through `replayApi`:
 * the right path and method for every route of `replayAnalysisRoutes.ts`, the
 * ONE filter encoded by the contract on reads, and the AI summaries' 429/503
 * declared as answers the caller shows in place.
 */

const transport = vi.hoisted(() => ({ apiRequest: vi.fn(), apiRequestStream: vi.fn() }));
vi.mock('./apiClient', () => transport);

import { replayApi } from './replayApi';

afterEach(() => {
  transport.apiRequest.mockReset();
});

function lastCall(): { url: URL; init: { method?: string; body?: string; expectedErrors?: number[] } | undefined } {
  const call = transport.apiRequest.mock.calls.at(-1)!;
  return { url: new URL(String(call[0]), 'https://api.example'), init: call[1] };
}

const phones = { all: [{ field: 'device' as const, op: 'eq' as const, value: 'phone' }] };
const funnelInput = {
  name: 'Checkout',
  steps: [
    { stepKind: 'page' as const, match: '/pricing', matchMode: 'equals' as const },
    { stepKind: 'event' as const, match: 'purchase', matchMode: 'equals' as const },
  ],
};

describe('replayApi — analysis (S4c)', () => {
  it('reads the overview with the window and the filter', async () => {
    transport.apiRequest.mockResolvedValue({});
    await replayApi.getOverview('site-1', { days: 7, filter: phones });
    const { url } = lastCall();
    expect(url.pathname).toBe(REPLAY_PATHS.overview);
    expect(url.searchParams.get('site')).toBe('site-1');
    expect(url.searchParams.get('days')).toBe('7');
    expect(url.searchParams.get('f.device.eq')).toBe('phone');
  });

  it('narrows filter options to one field when asked', async () => {
    transport.apiRequest.mockResolvedValue([]);
    await replayApi.filterOptions('site-1', { field: 'browser' });
    expect(lastCall().url.searchParams.get('field')).toBe('browser');
    await replayApi.filterOptions('site-1', { days: 30 });
    expect(lastCall().url.searchParams.has('field')).toBe(false);
  });

  it('writes segments with POST, PATCH and DELETE', async () => {
    transport.apiRequest.mockResolvedValue({});
    await replayApi.createSegment('site-1', { name: 'Phones', filter: phones });
    expect(lastCall().url.pathname).toBe(REPLAY_PATHS.segments);
    expect(lastCall().init?.method).toBe('POST');
    expect(JSON.parse(lastCall().init?.body ?? '{}')).toEqual({ name: 'Phones', filter: phones });
    await replayApi.updateSegment('site-1', 'seg-1', { name: 'Mobile' });
    expect(lastCall().url.pathname).toBe('/api/replay/segments/seg-1');
    expect(lastCall().init?.method).toBe('PATCH');
    await replayApi.deleteSegment('site-1', 'seg-1');
    expect(lastCall().init?.method).toBe('DELETE');
  });

  it('replaces a funnel with PUT and evaluates it with the filter', async () => {
    transport.apiRequest.mockResolvedValue({});
    await replayApi.updateFunnel('site-1', 'fun-1', funnelInput);
    expect(lastCall().url.pathname).toBe('/api/replay/funnels/fun-1');
    expect(lastCall().init?.method).toBe('PUT');
    await replayApi.evaluateFunnel('site-1', 'fun-1', { days: 30, filter: phones });
    expect(lastCall().url.pathname).toBe('/api/replay/funnels/fun-1/evaluate');
    expect(lastCall().url.searchParams.get('f.device.eq')).toBe('phone');
  });

  it('previews a smart event by POST with the window, tolerating a rejected rule', async () => {
    transport.apiRequest.mockResolvedValue({ count: 3 });
    await expect(replayApi.previewSmartEvent('site-1', { ruleKind: 'click', match: 'a.cta', matchMode: 'equals' }, { days: 30 })).resolves.toEqual({ count: 3 });
    const { url, init } = lastCall();
    expect(url.pathname).toBe(REPLAY_PATHS.smartEventPreview);
    expect(url.searchParams.get('days')).toBe('30');
    expect(init?.method).toBe('POST');
    expect(init?.expectedErrors).toEqual([400]);
  });

  it('declares the summaries’ limit and ungrounded answers as expected', async () => {
    transport.apiRequest.mockResolvedValue({});
    await replayApi.summarizeRecording('site-1', 'rec-1');
    expect(lastCall().url.pathname).toBe('/api/replay/recordings/rec-1/summary');
    expect(lastCall().init?.expectedErrors).toEqual([429, 503]);
    expect(JSON.parse(lastCall().init?.body ?? '{}')).toEqual({ regenerate: false });
    await replayApi.summarizeSegment('site-1', { days: 7, filter: phones });
    expect(lastCall().url.pathname).toBe(REPLAY_PATHS.segmentSummary);
    expect(JSON.parse(lastCall().init?.body ?? '{}')).toEqual({ days: 7, filter: phones });
  });

  it('reads the flow with the filter', async () => {
    transport.apiRequest.mockResolvedValue({ nodes: [], edges: [], totals: {} });
    await replayApi.flow('site-1', { days: 7, filter: phones });
    expect(lastCall().url.pathname).toBe(REPLAY_PATHS.flow);
    expect(lastCall().url.searchParams.get('f.device.eq')).toBe('phone');
  });
});
