import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Platform personas have ONE reader with a scope: the developer API and agent
 * hosts read the cached `active` list; the admin console reads every row,
 * uncached. Writes must drop the active list so a host never keeps serving a
 * persona an admin just disabled.
 */

const getOrSetCached = vi.fn(async (_env: unknown, _key: string, load: () => unknown) => load());
const invalidateCached = vi.fn(async () => {});
vi.mock('../../infrastructure/cache/readThroughCache', () => ({ getOrSetCached, invalidateCached }));
const invalidateCapabilityCache = vi.fn(async () => {});
vi.mock('../artifact/capabilityContext', () => ({ invalidateCapabilityCache }));

const { listPlatformPersonas, platformPersonaView, deletePlatformPersona } = await import('./platformPersonaCatalog');

const env = {} as never;

/** A chainable stand-in that resolves to `rows` wherever the chain ends. */
function chain(rows: unknown[]) {
  const node: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'orderBy', 'delete']) node[m] = () => node;
  node.limit = async () => rows;
  node.returning = async () => rows;
  node.then = (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve);
  return node;
}

beforeEach(() => {
  getOrSetCached.mockClear();
  invalidateCached.mockClear();
  invalidateCapabilityCache.mockClear();
});

describe('listPlatformPersonas', () => {
  it('serves non-admin readers from the cached active list', async () => {
    await listPlatformPersonas(env, chain([]) as never, 'active');
    expect(getOrSetCached.mock.calls[0]?.[1]).toBe('platform-personas:active');
  });

  it('reads every row uncached for the admin scope', async () => {
    const rows = [{ id: 1 }];
    expect(await listPlatformPersonas(env, chain(rows) as never, 'admin')).toBe(rows);
    expect(getOrSetCached).not.toHaveBeenCalled();
  });
});

describe('deletePlatformPersona', () => {
  it('drops the active list and the cloud capability entry', async () => {
    expect(await deletePlatformPersona(env, chain([{ id: 3, slug: 'coach' }]) as never, 3)).toBe(true);
    expect(invalidateCached).toHaveBeenCalledWith(env, 'platform-personas:active');
    expect(invalidateCapabilityCache).toHaveBeenCalledWith(env, 'persona', 'coach');
  });

  it('reports a missing persona without invalidating anything', async () => {
    expect(await deletePlatformPersona(env, chain([]) as never, 3)).toBe(false);
    expect(invalidateCached).not.toHaveBeenCalled();
  });
});

describe('platformPersonaView', () => {
  it('decodes JSON columns and tolerates a corrupt one', () => {
    const view = platformPersonaView({
      id: 1, name: 'Coach', slug: 'coach', description: null, voice: null, perspective: null,
      decisionStyle: null, outputPrefix: null, capabilities: '["plan"]', tags: 'not json',
      psychometric: null, source: 'builtin', author: null, active: false,
      createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    expect(view).toMatchObject({ capabilities: ['plan'], tags: [], psychometric: null, active: false, createdAt: '2026-01-01T00:00:00.000Z' });
  });
});
