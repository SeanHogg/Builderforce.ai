import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; kind: string; status: string }>,
  select: vi.fn(),
  fail: false,
}));

vi.mock('../../infrastructure/database/connection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../infrastructure/database/connection')>()),
  buildDatabase: vi.fn(() => ({
    select: (...args: unknown[]) => {
      mocks.select(...args);
      const chain = {
        from: () => chain,
        where: () => chain,
        limit: async () => {
          if (mocks.fail) throw new Error('db down');
          return mocks.rows;
        },
      };
      return chain;
    },
  })),
}));
vi.mock('../replay/replayCacheKeys', () => ({
  tenantSitesKey: vi.fn(async (_env: unknown, tenantId: number) => `replay:sites:v:test:t${tenantId}`),
}));
vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));

import type { Env } from '../../env';
import {
  REPLAY_LOADER_MARKER,
  hostedReplayLoaderTag,
  injectReplayLoader,
  withReplayLoader,
} from './siteReplayInjection';

const SITE_ID = '7b0a9c1e-0000-4000-8000-000000000001';
const env = {} as Env;
const html = (body: string, type = 'text/html; charset=utf-8') =>
  new Response(body, { status: 200, headers: { 'content-type': type, 'content-length': String(body.length) } });

beforeEach(() => {
  mocks.rows = [];
  mocks.fail = false;
  mocks.select.mockReset();
});

describe('withReplayLoader', () => {
  it('injects the loader with the hosted site id and the release token when the site is enabled', async () => {
    mocks.rows = [{ id: SITE_ID, kind: 'hosted', status: 'active' }];
    const res = await withReplayLoader(env, 7, 42, 'v20261013a', html('<html><body><p>app</p></body></html>'));
    const out = await res.text();
    expect(out).toContain('src="https://cdn.builderforce.ai/replay/v1/loader.js"');
    expect(out).toContain(`data-site="hosted:${SITE_ID}"`);
    expect(out).toContain('data-release="v20261013a"');
    expect(out).toMatch(/<\/script><\/body><\/html>$/);
    expect(res.headers.get('content-length')).toBeNull();
    expect(res.status).toBe(200);
  });

  it('is idempotent — a second pass over the same document adds nothing', async () => {
    mocks.rows = [{ id: SITE_ID, kind: 'hosted', status: 'active' }];
    const first = await (await withReplayLoader(env, 7, 42, 'v1', html('<body></body>'))).text();
    const second = await (await withReplayLoader(env, 7, 42, 'v1', html(first))).text();
    expect(second).toBe(first);
    expect(second.match(/replay\/v1\/loader\.js/g)).toHaveLength(1);
  });

  it('does not inject when recording is switched off', async () => {
    mocks.rows = [{ id: SITE_ID, kind: 'hosted', status: 'disabled' }];
    const body = '<body><p>app</p></body>';
    expect(await (await withReplayLoader(env, 7, 42, 'v1', html(body))).text()).toBe(body);
  });

  it('does not inject when the project has no hosted Insights site', async () => {
    const body = '<body><p>app</p></body>';
    expect(await (await withReplayLoader(env, 7, 42, 'v1', html(body))).text()).toBe(body);
  });

  it('never looks anything up for an asset', async () => {
    const asset = html('body{}', 'text/css');
    expect(await withReplayLoader(env, 7, 42, 'v1', asset)).toBe(asset);
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it('serves the page untouched when the lookup fails', async () => {
    mocks.fail = true;
    const body = '<body><p>app</p></body>';
    expect(await (await withReplayLoader(env, 7, 42, 'v1', html(body))).text()).toBe(body);
  });

  it('honours a configured CDN origin', async () => {
    mocks.rows = [{ id: SITE_ID, kind: 'hosted', status: 'active' }];
    const custom = { REPLAY_CDN_ORIGIN: 'https://cdn.example.test/' } as unknown as Env;
    const out = await (await withReplayLoader(custom, 7, 42, 'v1', html('<body></body>'))).text();
    expect(out).toContain('src="https://cdn.example.test/replay/v1/loader.js"');
  });
});

describe('injectReplayLoader', () => {
  const tag = hostedReplayLoaderTag({ siteId: SITE_ID, versionToken: 'v1' });

  it('marks the tag so it is recognised on a second pass', () => {
    expect(tag).toContain(`data-bf-marker="${REPLAY_LOADER_MARKER}"`);
  });

  it('leaves a page that already carries a hand-pasted loader alone', () => {
    const pasted = '<body><script async src="https://cdn.builderforce.ai/replay/v1/loader.js" data-site="bfr_x"></script></body>';
    expect(injectReplayLoader(pasted, tag)).toBe(pasted);
  });

  it('escapes the release token into the attribute', () => {
    expect(hostedReplayLoaderTag({ siteId: SITE_ID, versionToken: 'a"b<c' })).toContain('data-release="a&quot;b&lt;c"');
  });
});
