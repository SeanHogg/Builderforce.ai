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

vi.mock('./LlmProxyService', async () => {
  const actual = await vi.importActual<typeof import('./LlmProxyService')>('./LlmProxyService');
  return {
    ...actual,
    llmProxyForPlan: vi.fn((_env: unknown, _plan: unknown, _premium: unknown, opts: Record<string, unknown>) => {
      built.push(opts);
      return {
        complete: vi.fn(async (body: { model: string }) => {
          dispatched.push(body.model);
          return {
            response: new Response(upstream.body, { status: upstream.status }),
            resolvedModel: body.model,
            resolvedVendor: 'openrouter',
            failovers: [],
          };
        }),
      };
    }),
  };
});

const { probeOpenRouterConnection } = await import('./byoCredentialHealth');

const env = {} as never;

beforeEach(() => {
  connections.length = 0;
  built.length = 0;
  dispatched.length = 0;
  for (const key of Object.keys(resolvedKeys)) delete resolvedKeys[key];
  upstream = { status: 200, body: '{"ok":true}' };
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
