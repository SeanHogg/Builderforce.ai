/**
 * The hosted-site A/B split (PRD 33 §5.1.4 "Test it"): a sticky `bf_ab_<testId>`
 * cookie, assignment by allocation, the preview arm served from its own release,
 * ONE exposure per assignment, and the live release whenever anything is missing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  selects: 0,
  replaySiteId: 'site-1' as string | null,
  recordExposure: vi.fn(async () => {}),
}));

vi.mock('../../infrastructure/database/connection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../infrastructure/database/connection')>()),
  buildDatabase: vi.fn(() => ({
    select: () => {
      mocks.selects += 1;
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.innerJoin = () => chain;
      chain.where = async () => mocks.rows;
      return chain;
    },
  })),
}));
vi.mock('../replay/replayCacheKeys', () => ({
  tenantSitesKey: vi.fn(async (_env: unknown, tenantId: number) => `replay:sites:v:test:t${tenantId}`),
}));
vi.mock('./siteReplayInjection', () => ({ enabledHostedReplaySiteId: vi.fn(async () => mocks.replaySiteId) }));
vi.mock('../marketing/experimentation', () => ({ recordExposure: mocks.recordExposure }));
vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));

import type { Env } from '../../env';
import { __clearL1CacheForTests } from '../../infrastructure/cache/readThroughCache';
import { recordSplitExposure, resolveSiteSplit, withSplitCookie } from './siteAbSplit';
import type { SiteRecord } from './siteHosting';

const env = {} as Env;
const site: SiteRecord = {
  siteId: 1, projectId: 42, tenantId: 7, r2Prefix: 'sites/app/live/', status: 'active',
  versionToken: 'live', indexDocument: 'index.html', landingObjectId: null,
};
const RUNNING = [
  { testId: 12, variantId: 101, key: 'live', trafficPercent: '50.00', payload: { siteId: 'site-1', prescriptionId: 'p1', success: { smartEvent: null } } },
  { testId: 12, variantId: 102, key: 'preview', trafficPercent: '50.00', payload: { siteId: 'site-1', prescriptionId: 'p1', versionToken: 'prev', r2Prefix: 'sites/app/prev/' } },
];
const req = (cookie?: string) => new Request('https://app.builderforce.ai/', { headers: cookie ? { cookie } : {} });

beforeEach(() => {
  __clearL1CacheForTests();
  mocks.rows = RUNNING;
  mocks.selects = 0;
  mocks.replaySiteId = 'site-1';
  mocks.recordExposure.mockClear();
});

describe('resolveSiteSplit', () => {
  it('assigns a page view by allocation and serves the preview arm from its own release', async () => {
    const preview = await resolveSiteSplit(env, site, req(), { mayAssign: true, roll: () => 75 });
    expect(preview).toMatchObject({ testId: 12, assigned: true, label: 'ab12:preview' });
    expect(preview!.served).toMatchObject({ r2Prefix: 'sites/app/prev/', versionToken: 'prev', tenantId: 7 });
    const live = await resolveSiteSplit(env, site, req(), { mayAssign: true, roll: () => 10 });
    expect(live).toMatchObject({ assigned: true, label: 'ab12:live' });
    expect(live!.served).toBe(site);
  });

  it('is sticky: the cookie wins over the roll and is not re-assigned', async () => {
    const decision = await resolveSiteSplit(env, site, req('a=1; bf_ab_12=preview'), { mayAssign: true, roll: () => 1 });
    expect(decision).toMatchObject({ assigned: false, label: 'ab12:preview' });
  });

  it('reads the __Host- cookie, still honours the legacy name, and prefers __Host- when both are present', async () => {
    expect(await resolveSiteSplit(env, site, req('__Host-bf_ab_12=preview'), { mayAssign: false, roll: () => 1 }))
      .toMatchObject({ assigned: false, label: 'ab12:preview' });
    expect(await resolveSiteSplit(env, site, req('bf_ab_12=live'), { mayAssign: false, roll: () => 99 }))
      .toMatchObject({ assigned: false, label: 'ab12:live' });
    // A tossed `Domain=builderforce.ai` legacy cookie cannot override the host's own arm.
    expect(await resolveSiteSplit(env, site, req('bf_ab_12=live; __Host-bf_ab_12=preview'), { mayAssign: false, roll: () => 1 }))
      .toMatchObject({ assigned: false, label: 'ab12:preview' });
  });

  it('never assigns on an asset request, and serves live when nothing is running or recording is off', async () => {
    expect(await resolveSiteSplit(env, site, req(), { mayAssign: false, roll: () => 75 })).toBeNull();
    expect(mocks.selects).toBe(0); // the hot path costs no lookup
    mocks.rows = [];
    expect(await resolveSiteSplit(env, site, req(), { mayAssign: true })).toBeNull();
    __clearL1CacheForTests();
    mocks.rows = RUNNING;
    mocks.replaySiteId = null;
    expect(await resolveSiteSplit(env, site, req(), { mayAssign: true })).toBeNull();
  });
});

describe('withSplitCookie and the exposure', () => {
  it('sets the sticky cookie on an assignment, keeps the response private, and counts one exposure', async () => {
    const decision = (await resolveSiteSplit(env, site, req(), { mayAssign: true, roll: () => 75 }))!;
    const res = withSplitCookie(new Response('<html></html>', { headers: { 'Cache-Control': 'public, max-age=60' } }), decision);
    expect(res.headers.get('Set-Cookie')).toMatch(/^__Host-bf_ab_12=preview; Path=\/; Secure; Max-Age=\d+; SameSite=Lax$/);
    expect(res.headers.get('Set-Cookie')).not.toMatch(/Domain=/i);
    expect(res.headers.get('Cache-Control')).toContain('private');
    expect(res.headers.get('Vary')).toContain('Cookie');
    await recordSplitExposure(env, 7, decision);
    expect(mocks.recordExposure).toHaveBeenCalledWith(expect.anything(), 7, 102);
  });

  it('counts nothing for a returning visitor', async () => {
    const decision = (await resolveSiteSplit(env, site, req('__Host-bf_ab_12=live'), { mayAssign: true }))!;
    await recordSplitExposure(env, 7, decision);
    expect(mocks.recordExposure).not.toHaveBeenCalled();
    expect(withSplitCookie(new Response('x'), decision).headers.get('Set-Cookie')).toBeNull();
  });

  it('upgrades a returning visitor still on the legacy cookie name to __Host- (no exposure counted)', async () => {
    const decision = (await resolveSiteSplit(env, site, req('bf_ab_12=live'), { mayAssign: true }))!;
    await recordSplitExposure(env, 7, decision);
    expect(mocks.recordExposure).not.toHaveBeenCalled();
    expect(decision.upgradeCookies).toEqual([
      expect.stringMatching(/^__Host-bf_ab_12=live; Path=\/; Secure; SameSite=Lax; Max-Age=\d+$/),
      'bf_ab_12=; Path=/; Secure; SameSite=Lax; Max-Age=0',
    ]);
    expect(withSplitCookie(new Response('x'), decision).headers.get('Set-Cookie')).toBe(decision.upgradeCookies.join(', '));
    // A cookie that names no arm of this test is a fresh assignment, never an upgrade.
    const stranger = (await resolveSiteSplit(env, site, req('bf_ab_12=nope'), { mayAssign: true, roll: () => 75 }))!;
    expect(stranger).toMatchObject({ assigned: true, upgradeCookies: [] });
  });
});
