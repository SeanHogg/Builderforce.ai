import { describe, expect, it, vi } from 'vitest';
import { PREVIEW_CONTROL_STOP_PATH } from '../runtime/previewSessions';
import {
  managedAgentHostContainerRuntime,
  managedHostInstanceName,
} from './managedAgentHostRuntime';

describe('managedHostInstanceName', () => {
  it('is stable per request id', () => {
    expect(managedHostInstanceName(9)).toBe('managed-host:9');
  });
});

describe('managedAgentHostContainerRuntime', () => {
  it('fails start when AGENT_CONTAINER is unbound', async () => {
    const runtime = managedAgentHostContainerRuntime({});
    await expect(runtime.start({ requestId: 1, tenantId: 7, region: 'us-east' })).resolves.toEqual({
      ok: false,
      reason: 'AGENT_CONTAINER binding is not configured',
    });
  });

  it('starts by probing /health on the named Durable Object', async () => {
    const fetch = vi.fn(async () => new Response('ok', { status: 200 }));
    const get = vi.fn(() => ({ fetch }));
    const idFromName = vi.fn((name: string) => ({ name }));
    const runtime = managedAgentHostContainerRuntime({
      AGENT_CONTAINER: { get, idFromName } as never,
    });
    await expect(runtime.start({ requestId: 4, tenantId: 7, region: 'us-east' })).resolves.toEqual({ ok: true });
    expect(idFromName).toHaveBeenCalledWith('managed-host:4');
    expect(fetch).toHaveBeenCalled();
  });

  it('reports an unhealthy container instead of inventing a host', async () => {
    const fetch = vi.fn(async () => new Response('down', { status: 503 }));
    const runtime = managedAgentHostContainerRuntime({
      AGENT_CONTAINER: {
        get: () => ({ fetch }),
        idFromName: (name: string) => ({ name }),
      } as never,
    });
    await expect(runtime.start({ requestId: 4, tenantId: 7, region: 'us-east' })).resolves.toEqual({
      ok: false,
      reason: 'managed host container health check failed',
    });
  });

  it('stops via the existing preview-control stop path', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    const runtime = managedAgentHostContainerRuntime({
      AGENT_CONTAINER: {
        get: () => ({ fetch }),
        idFromName: (name: string) => ({ name }),
      } as never,
    });
    await runtime.stop({ requestId: 4 });
    const req = fetch.mock.calls[0]?.[0] as Request;
    expect(new URL(req.url).pathname).toBe(PREVIEW_CONTROL_STOP_PATH);
    expect(req.method).toBe('POST');
  });
});
