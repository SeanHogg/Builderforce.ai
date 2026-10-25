import { describe, expect, it } from 'vitest';
import {
  ProviderConnectError,
  completePasteConnect,
  connectionHealth,
  listProviderConnections,
  testProviderConnection,
  type GatewayRequest,
} from './index.js';

function answering(status: number, body: unknown): GatewayRequest & { calls: Array<{ path: string; init: unknown }> } {
  const calls: Array<{ path: string; init: unknown }> = [];
  const fn = (async (path: string, init?: unknown) => {
    calls.push({ path, init });
    return { status, body };
  }) as GatewayRequest & { calls: Array<{ path: string; init: unknown }> };
  fn.calls = calls;
  return fn;
}

describe('listProviderConnections', () => {
  it('reads each connected provider with its brand name, health and whether it can reconnect from chat', async () => {
    const rows = await listProviderConnections(answering(200, {
      details: [
        { provider: 'xai', authType: 'oauth', priority: 1, authAlert: { reason: 'capacity', status: 403 } },
        { provider: 'google', authType: 'api_key', priority: 2 },
        { provider: 'anthropic', authType: 'api_key', priority: null, authAlert: { reason: 'rejected', status: 401 } },
      ],
    }));
    expect(rows).toEqual([
      { provider: 'xai', label: 'xAI (Grok)', authType: 'oauth', health: 'capacity', reconnectable: true },
      { provider: 'google', label: 'Google (Gemini)', authType: 'api_key', health: 'ok', reconnectable: false },
      // A pasted key is replaced in settings, not reconnected — even for a provider with a subscription flow.
      { provider: 'anthropic', label: 'Anthropic (Claude)', authType: 'api_key', health: 'rejected', reconnectable: false },
    ]);
  });

  it('answers null for a person who may not manage connections', async () => {
    expect(await listProviderConnections(answering(403, { error: 'forbidden' }))).toBeNull();
  });

  it('throws on any other refusal', async () => {
    await expect(listProviderConnections(answering(500, { error: 'boom' }))).rejects.toThrow('boom');
  });
});

describe('connectionHealth', () => {
  it('maps the gateway alert reasons, and treats an unknown reason as not working', () => {
    expect(connectionHealth(undefined)).toBe('ok');
    expect(connectionHealth({ reason: 'not_entitled' })).toBe('not_entitled');
    expect(connectionHealth({ reason: 'unresolved' })).toBe('unresolved');
    expect(connectionHealth({ reason: 'something_new' })).toBe('rejected');
  });
});

describe('testProviderConnection', () => {
  it('reads a passing probe', async () => {
    const request = answering(200, { ok: true, status: 'ok', model: 'grok-4.7' });
    expect(await testProviderConnection(request, 'xai')).toEqual({ ok: true, health: 'ok', message: null });
    expect(request.calls[0]).toEqual({ path: '/llm/provider-keys/xai/test', init: { method: 'POST' } });
  });

  it('leaves the standing verdict alone when the probe persisted none', async () => {
    const result = await testProviderConnection(answering(200, { ok: false, status: 'local_egress_required', error: 'reachable only from your machine' }), 'kimi');
    expect(result).toEqual({ ok: false, health: null, message: 'reachable only from your machine' });
  });

  it('carries the verdict the probe persisted and the gateway sentence', async () => {
    const result = await testProviderConnection(answering(200, {
      ok: false, error: 'xai connection test paused: usage allowance depleted', authAlert: { reason: 'capacity', status: 403 },
    }), 'xai');
    expect(result).toEqual({ ok: false, health: 'capacity', message: 'xai connection test paused: usage allowance depleted' });
  });
});

describe('completePasteConnect', () => {
  it('posts the code with the state the start returned', async () => {
    const request = answering(200, { ok: true, provider: 'xai', authType: 'oauth' });
    await completePasteConnect(request, 'xai', 'abc#s1', 's1');
    expect(request.calls[0]).toEqual({ path: '/llm/provider-keys/xai/oauth/complete', init: { method: 'POST', json: { code: 'abc#s1', state: 's1' } } });
  });

  it('a spent code or a lost session is `expired` — start again', async () => {
    for (const code of ['oauth_code_spent', 'oauth_state_expired']) {
      const error = await completePasteConnect(answering(400, { code, error: 'start again' }), 'xai', 'x', 's').catch((e) => e);
      expect(error).toBeInstanceOf(ProviderConnectError);
      expect(error.reason).toBe('expired');
      expect(error.detail).toBe('start again');
    }
  });

  it('anything else is `failed`, with the gateway sentence', async () => {
    const error = await completePasteConnect(answering(502, { error: 'xAI token endpoint down' }), 'xai', 'x', 's').catch((e) => e);
    expect(error.reason).toBe('failed');
    expect(error.detail).toBe('xAI token endpoint down');
  });
});
