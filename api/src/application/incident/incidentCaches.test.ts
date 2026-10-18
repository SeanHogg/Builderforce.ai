import { describe, expect, it, vi } from 'vitest';

const { bumpCacheVersion } = vi.hoisted(() => ({ bumpCacheVersion: vi.fn(async () => undefined) }));
vi.mock('../../infrastructure/cache/readThroughCache', () => ({ bumpCacheVersion }));

import { bumpProdIncidentCaches } from './incidentCaches';
import { incidentVersionKey, prodIncidentVersionKeys, qualityVersionKey } from '../insights/versionKeys';

describe('prod_incidents cache invalidation', () => {
  it('names BOTH readers of the one incident table', () => {
    expect(prodIncidentVersionKeys(5)).toEqual([incidentVersionKey(5), qualityVersionKey(5)]);
  });

  it('bumps the incident list AND the board Quality lens on every write', async () => {
    const env = {} as never;
    await bumpProdIncidentCaches(env, 5);
    expect(bumpCacheVersion).toHaveBeenCalledTimes(2);
    expect(bumpCacheVersion).toHaveBeenCalledWith(env, incidentVersionKey(5));
    expect(bumpCacheVersion).toHaveBeenCalledWith(env, qualityVersionKey(5));
  });
});
