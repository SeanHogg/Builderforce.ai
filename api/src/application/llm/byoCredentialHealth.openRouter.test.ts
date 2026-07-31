/**
 * `probeOpenRouterConnection` — the Test-connection button behind Settings ▸ Integrations ▸
 * OpenRouter.
 *
 * These cases pin the three decisions that make the verdict TRUSTWORTHY rather than merely
 * green. Each one is a way a passing test could have lied about a registration:
 *   • the probe must be seeded with ONLY the connection under test, or a cascade could
 *     satisfy it from a different registration and report a broken one healthy;
 *   • a keyed connection must dispatch on ITS OWN key, not the managed one;
 *   • when the tenant's key cannot be applied to any of the connection's models (a
 *     higher-priority registration already claims them all), the honest answer is
 *     `key_unresolved`, not a green tick earned on Builderforce's key.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenRouterConnection } from './openRouterConnectionService';

const connections: OpenRouterConnection[] = [];
const resolvedKeys: Record<string, string> = {};

vi.mock('./openRouterConnectionService', async () => {
  const actual = await vi.importActual<typeof import('./openRouterConnectionService')>('./openRouterConnectionService');
  return {
    ...actual,
    listOpenRouterConnections: vi.fn(async () => connections),
    resolveOpenRouterConnectionKeys: vi.fn(async () => resolvedKeys),
  };
});

/** Every proxy the probe builds, so a case can assert what it was seeded with. */
const built: Array<Record<string, unknown>> = [];
/** The next upstream response the fake proxy returns. */
let upstream: { status: number; body: string } = { status: 200, body: '{"ok":true}' };
/** Models `.complete()` was asked to dispatch. */
const dispatched: string[] = [];
/** Hook to change `upstream` between attempts — how a transient failure is modelled. */
let onDispatch: ((attempt: number) => void) | null = null;
/** The per-attempt status/detail the gateway reports in `failovers[0]`, which is where the
 *  REAL upstream status lives when the envelope is a rolled-up cascade summary. */
let failoverStatus: number | null = null;
let failoverDetail: string | null = null;

vi.mock('./LlmProxyService', async () => {
  const actual = await vi.importActual<typeof import('./LlmProxyService')>('./LlmProxyService');
  return {
    ...actual,
    llmProxyForPlan: vi.fn((_env: unknown, _plan: unknown, _premium: unknown, opts: Record<string, unknown>) => {
      built.push(opts);
      return {
        complete: vi.fn(async (body: { model: string }) => {
          dispatched.push(body.model);
          onDispatch?.(dispatched.length);
          const failed = upstream.status >= 400;
          return {
            response: new Response(upstream.body, { status: upstream.status }),
            resolvedModel: body.model,
            resolvedVendor: 'openrouter',
            failovers: failed
              ? [{
                  model: body.model,
                  vendor: 'openrouter',
                  code: failoverStatus ?? upstream.status,
                  ...(failoverDetail ? { detail: failoverDetail } : {}),
                }]
              : [],
          };
        }),
      };
    }),
  };
});

const { probeOpenRouterConnection } = await import('./byoCredentialHealth');
const { loadConnectionAuthAlert, _resetMemoryProviderAuthAlerts } = await import('./providerAuthAlerts');

const env = {} as never;

beforeEach(() => {
  connections.length = 0;
  built.length = 0;
  dispatched.length = 0;
  for (const key of Object.keys(resolvedKeys)) delete resolvedKeys[key];
  upstream = { status: 200, body: '{"ok":true}' };
  onDispatch = null;
  failoverStatus = null;
  failoverDetail = null;
  _resetMemoryProviderAuthAlerts();
});

describe('probeOpenRouterConnection', () => {
  it('dispatches only the connection under test, on its own key, and reports ready', async () => {
    connections.push(
      { id: 1, label: 'Cheap coders', models: ['moonshotai/kimi-k3'], hasKey: true, priority: 0 },
      { id: 2, label: 'Frontier', models: ['openai/gpt-4.1'], hasKey: false, priority: 1 },
    );
    resolvedKeys['moonshotai/kimi-k3'] = 'sk-or-tenant';

    const result = await probeOpenRouterConnection(env, 7, 1);

    expect(result).toMatchObject({ connectionId: 1, ok: true, status: 'ready', model: 'moonshotai/kimi-k3', ownKey: true });
    expect(dispatched).toEqual(['openrouter/moonshotai/kimi-k3']);
    // Seeded with connection 1 alone — connection 2 must not be reachable from this probe.
    expect(built[0]!.openRouterConnections).toEqual([connections[0]]);
    expect(built[0]!.openRouterModelKeys).toEqual({ 'moonshotai/kimi-k3': 'sk-or-tenant' });
  });

  it('leads with a model the connection\'s own key serves rather than the first listed', async () => {
    connections.push({
      id: 3, label: 'Mixed', models: ['openai/gpt-4.1', 'moonshotai/kimi-k3'], hasKey: true, priority: 0,
    });
    // `openai/gpt-4.1` is claimed by a higher-priority registration, so only the second id
    // carries this connection's key.
    resolvedKeys['moonshotai/kimi-k3'] = 'sk-or-tenant';

    const result = await probeOpenRouterConnection(env, 7, 3);

    expect(result).toMatchObject({ ok: true, model: 'moonshotai/kimi-k3', ownKey: true });
    expect(dispatched).toEqual(['openrouter/moonshotai/kimi-k3']);
  });

  it('refuses to verify a keyed connection on the managed key', async () => {
    connections.push({ id: 4, label: 'Shadowed', models: ['openai/gpt-4.1'], hasKey: true, priority: 5 });
    // Nothing resolved for this connection's ids — the key no longer decrypts, or a
    // higher-priority connection claims every one of them.

    const result = await probeOpenRouterConnection(env, 7, 4);

    expect(result).toMatchObject({ ok: false, status: 'key_unresolved', ownKey: true });
    expect(dispatched).toEqual([]);
    expect(built).toEqual([]);
  });

  it('probes a managed-key connection with no tenant key map', async () => {
    connections.push({ id: 5, label: 'Managed', models: ['openai/gpt-4.1'], hasKey: false, priority: null });

    const result = await probeOpenRouterConnection(env, 7, 5);

    expect(result).toMatchObject({ ok: true, status: 'ready', ownKey: false });
    expect(built[0]!.openRouterModelKeys).toBeUndefined();
  });

  it('surfaces the upstream failure text instead of a bare failed', async () => {
    connections.push({ id: 6, label: 'Broken', models: ['openai/gpt-4.1'], hasKey: false, priority: null });
    upstream = { status: 401, body: JSON.stringify({ error: { message: 'No auth credentials found' } }) };

    const result = await probeOpenRouterConnection(env, 7, 6);

    expect(result).toMatchObject({ ok: false, status: 'failed', upstreamStatus: 401 });
    expect(result.error).toContain('No auth credentials found');
  });

  it('does NOT re-send a rejected credential — one 401 is the whole answer', async () => {
    connections.push({ id: 20, label: 'Rejected', models: ['openai/gpt-4.1'], hasKey: false, priority: null });
    upstream = { status: 401, body: 'invalid api key' };

    await probeOpenRouterConnection(env, 7, 20);

    // Retrying would spend the owner's money twice to learn the same thing.
    expect(dispatched).toHaveLength(1);
  });

  it('retries a transient upstream failure once and reports READY when it clears', async () => {
    // The live case: the key worked, OpenRouter routed it, and Moonshot returned 502. One
    // flaky response must not be reported as a broken connection.
    connections.push({ id: 21, label: 'Flaky', models: ['moonshotai/kimi-k3'], hasKey: false, priority: null });
    upstream = { status: 502, body: 'provider error' };
    onDispatch = (n) => { if (n === 2) upstream = { status: 200, body: '{"ok":true}' }; };

    const result = await probeOpenRouterConnection(env, 7, 21);

    expect(dispatched).toHaveLength(2);
    expect(result).toMatchObject({ ok: true, status: 'ready' });
  });

  it('calls a persistent 502 an UPSTREAM error, not a failed connection', async () => {
    connections.push({ id: 22, label: 'Down', models: ['moonshotai/kimi-k3'], hasKey: true, priority: null });
    resolvedKeys['moonshotai/kimi-k3'] = 'sk-or-tenant';
    upstream = { status: 502, body: 'provider error' };

    const result = await probeOpenRouterConnection(env, 7, 22);

    expect(dispatched).toHaveLength(2);
    // The credential was ACCEPTED. Nothing here is the owner's to fix, so no alert is
    // recorded and the card must not go red.
    expect(result).toMatchObject({ ok: false, status: 'upstream_error', upstreamStatus: 502, ownKey: true });
    expect(result.alert).toBeUndefined();
    await expect(loadConnectionAuthAlert(env, 7, 22)).resolves.toBeNull();
  });

  it('reports the provider status, not the gateway cascade envelope', async () => {
    connections.push({ id: 23, label: 'Enveloped', models: ['moonshotai/kimi-k3'], hasKey: false, priority: null });
    // What the gateway actually returns for an exhausted strict pin: a 429 envelope whose
    // prose names our routing internals, wrapping the real 502 in the attempt.
    upstream = { status: 429, body: JSON.stringify({ error: { message: 'AI vendor cascade exhausted (1 attempts: openrouter/openrouter/moonshotai/kimi-k3=502)' } }) };
    failoverStatus = 502;
    failoverDetail = 'Provider returned error';

    const result = await probeOpenRouterConnection(env, 7, 23);

    expect(result.upstreamStatus).toBe(502);
    expect(result.error).toBe('Provider returned error');
    // The doubled internal ref is exactly what an operator should never be shown.
    expect(result.error).not.toContain('openrouter/openrouter');
    expect(result.error).not.toContain('cascade exhausted');
  });

  it('persists a rejected registration so the card stops claiming it is fine', async () => {
    connections.push({ id: 10, label: 'Revoked', models: ['openai/gpt-4.1'], hasKey: true, priority: 0 });
    resolvedKeys['openai/gpt-4.1'] = 'sk-or-revoked';
    upstream = { status: 401, body: JSON.stringify({ error: { message: 'invalid api key' } }) };

    const result = await probeOpenRouterConnection(env, 7, 10);

    expect(result.alert).toMatchObject({ connectionId: 10, reason: 'rejected', status: 401, vendor: 'openrouter' });
    await expect(loadConnectionAuthAlert(env, 7, 10)).resolves.toMatchObject({ connectionId: 10, reason: 'rejected' });
  });

  it('clears a stale alert when the registration starts working again', async () => {
    connections.push({ id: 11, label: 'Recovering', models: ['openai/gpt-4.1'], hasKey: false, priority: 0 });
    upstream = { status: 403, body: 'forbidden' };
    await probeOpenRouterConnection(env, 7, 11);
    await expect(loadConnectionAuthAlert(env, 7, 11)).resolves.not.toBeNull();

    upstream = { status: 200, body: '{"ok":true}' };
    await probeOpenRouterConnection(env, 7, 11);
    await expect(loadConnectionAuthAlert(env, 7, 11)).resolves.toBeNull();
  });

  it('leaves the prior verdict alone on a transient failure instead of flapping the card', async () => {
    connections.push({ id: 12, label: 'Blip', models: ['openai/gpt-4.1'], hasKey: false, priority: 0 });
    upstream = { status: 503, body: 'upstream unavailable' };

    const result = await probeOpenRouterConnection(env, 7, 12);

    expect(result.ok).toBe(false);
    expect(result.alert).toBeUndefined();
    await expect(loadConnectionAuthAlert(env, 7, 12)).resolves.toBeNull();
  });

  it('alerts on an unusable saved key even though nothing was sent upstream', async () => {
    connections.push({ id: 13, label: 'Shadowed', models: ['openai/gpt-4.1'], hasKey: true, priority: 9 });

    const result = await probeOpenRouterConnection(env, 7, 13);

    expect(result).toMatchObject({ status: 'key_unresolved' });
    await expect(loadConnectionAuthAlert(env, 7, 13)).resolves.toMatchObject({ reason: 'unresolved', status: 0 });
  });

  it('reports a missing or foreign connection as not_found without dispatching', async () => {
    const result = await probeOpenRouterConnection(env, 7, 99);
    expect(result).toMatchObject({ ok: false, status: 'not_found' });
    expect(built).toEqual([]);
  });

  it('reports a connection with no models as untestable', async () => {
    connections.push({ id: 8, label: 'Empty', models: [], hasKey: false, priority: null });
    const result = await probeOpenRouterConnection(env, 7, 8);
    expect(result).toMatchObject({ ok: false, status: 'no_test_model' });
    expect(built).toEqual([]);
  });
});
