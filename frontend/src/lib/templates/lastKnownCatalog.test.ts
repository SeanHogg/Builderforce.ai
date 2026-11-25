// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiTransportError } from '@/lib/errors/transportFailure';
import { isCatalogUnavailable, listWithLastKnownGood } from './lastKnownCatalog';
import type { TemplateSummary } from './api';

const tpl = (key: string) => ({ key, name: key }) as unknown as TemplateSummary;

describe('listWithLastKnownGood', () => {
  beforeEach(() => window.localStorage.clear());

  it('persists a successful read and serves it when the network is gone', async () => {
    await listWithLastKnownGood('t1', async () => [tpl('a')]);
    const offline = await listWithLastKnownGood('t1', async () => {
      throw new ApiTransportError('offline', '/api/templates', 'GET');
    });
    expect(offline.map((t) => t.key)).toEqual(['a']);
  });

  it('serves the saved copy on a 5xx and on a database_unavailable 503', async () => {
    await listWithLastKnownGood('t1', async () => [tpl('a')]);
    for (const status of [500, 503]) {
      const out = await listWithLastKnownGood('t1', async () => {
        throw Object.assign(new Error('down'), { status, code: 'database_unavailable' });
      });
      expect(out).toHaveLength(1);
    }
  });

  it('never serves one workspace the other\'s copy', async () => {
    await listWithLastKnownGood('t1', async () => [tpl('a')]);
    await expect(listWithLastKnownGood('t2', async () => {
      throw new ApiTransportError('offline', '/api/templates', 'GET');
    })).rejects.toBeInstanceOf(ApiTransportError);
  });

  it('rethrows when nothing was saved, and rethrows non-outage errors', async () => {
    const down = new ApiTransportError('unreachable', '/api/templates', 'GET');
    await expect(listWithLastKnownGood('t1', async () => { throw down; })).rejects.toBe(down);
    await listWithLastKnownGood('t1', async () => [tpl('a')]);
    const forbidden = Object.assign(new Error('no'), { status: 403 });
    await expect(listWithLastKnownGood('t1', async () => { throw forbidden; })).rejects.toBe(forbidden);
  });

  it('classifies only unreachable/5xx as unavailable', () => {
    expect(isCatalogUnavailable({ status: 0 })).toBe(true);
    expect(isCatalogUnavailable({ status: 502 })).toBe(true);
    expect(isCatalogUnavailable({ status: 404 })).toBe(false);
    expect(isCatalogUnavailable(new Error('x'))).toBe(false);
  });
});
