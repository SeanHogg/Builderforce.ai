import { afterEach, describe, expect, it, vi } from 'vitest';
import { REPLAY_PATHS } from '@builderforce/interaction-contract';
import { invalidateClientCache } from '@/infrastructure/http/readThrough';

/**
 * The prescriptions half of the Insights client (S4e), reached through
 * `replayApi`: the right path, method and body for every route of
 * `replayPrescriptionRoutes.ts`; the list shared by the surfaces of one screen
 * and read again after any write; the sweep's 429 declared as an answer.
 */

const transport = vi.hoisted(() => ({ apiRequest: vi.fn(), apiRequestStream: vi.fn() }));
vi.mock('./apiClient', () => transport);

import { replayApi } from './replayApi';
import { subscribePrescriptionChanges } from './replayPrescriptionsApi';

afterEach(() => {
  transport.apiRequest.mockReset();
  invalidateClientCache('replay:');
});

function lastCall(): { url: URL; init: { method?: string; body?: string; expectedErrors?: number[] } | undefined } {
  const call = transport.apiRequest.mock.calls.at(-1)!;
  return { url: new URL(String(call[0]), 'https://api.example'), init: call[1] };
}

const phones = { all: [{ field: 'device' as const, op: 'eq' as const, value: 'phone' }] };

describe('replayApi — prescriptions (S4e)', () => {
  it('lists with area, status and the filter, once for every surface of the screen', async () => {
    transport.apiRequest.mockResolvedValue([]);
    await replayApi.listPrescriptions('site-1', { area: 'ux', status: 'proposed', filter: phones });
    const { url } = lastCall();
    expect(url.pathname).toBe(REPLAY_PATHS.prescriptions);
    expect(url.searchParams.get('site')).toBe('site-1');
    expect(url.searchParams.get('area')).toBe('ux');
    expect(url.searchParams.get('status')).toBe('proposed');
    expect(url.searchParams.get('f.device.eq')).toBe('phone');

    await replayApi.listPrescriptions('site-1', { area: 'ux', status: 'proposed', filter: phones });
    expect(transport.apiRequest).toHaveBeenCalledTimes(1);
  });

  it('reads one prescription by id', async () => {
    transport.apiRequest.mockResolvedValue({ id: 'rx-1' });
    await replayApi.getPrescription('site-1', 'rx-1');
    expect(lastCall().url.pathname).toBe('/api/replay/prescriptions/rx-1');
  });

  it('posts an action with its input, and a write makes every list read again', async () => {
    transport.apiRequest.mockResolvedValue([]);
    await replayApi.listPrescriptions('site-1');
    const listener = vi.fn();
    const unsubscribe = subscribePrescriptionChanges(listener);

    transport.apiRequest.mockResolvedValue({ prescription: { id: 'rx-1' } });
    await replayApi.actOnPrescription('site-1', 'rx-1', 'dismiss', { reason: 'Redesigned' });
    const { url, init } = lastCall();
    expect(url.pathname).toBe('/api/replay/prescriptions/rx-1/dismiss');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body ?? '{}')).toEqual({ reason: 'Redesigned' });
    expect(listener).toHaveBeenCalledTimes(1);

    transport.apiRequest.mockResolvedValue([]);
    await replayApi.listPrescriptions('site-1');
    expect(lastCall().url.pathname).toBe(REPLAY_PATHS.prescriptions);
    unsubscribe();
  });

  it('a follow-up preview writes nothing, so nobody reads again', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribePrescriptionChanges(listener);
    transport.apiRequest.mockResolvedValue({ prescription: { id: 'rx-1' }, followUp: { matched: [] } });
    await replayApi.actOnPrescription('site-1', 'rx-1', 'follow-up', { confirm: false });
    expect(lastCall().url.pathname).toBe('/api/replay/prescriptions/rx-1/follow-up');
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('sweeps with the hourly 429 declared as an answer, and reads the release report', async () => {
    transport.apiRequest.mockResolvedValue({ found: 1, created: 1, refreshed: 0, prescribed: 0 });
    await replayApi.sweepPrescriptions('site-1');
    expect(lastCall().url.pathname).toBe(REPLAY_PATHS.prescriptionSweep);
    expect(lastCall().init).toMatchObject({ method: 'POST', expectedErrors: [429] });

    transport.apiRequest.mockResolvedValue({ releaseKey: 'rel-1', prescriptions: [] });
    await replayApi.releaseReport('site-1', 'rel-1');
    expect(lastCall().url.pathname).toBe('/api/replay/releases/rel-1/report');
  });
});
