/**
 * A ticket raised from a replay moment is measured on the release that ships the
 * fix (PRD 33 §5.3.4): computed on read from the route rollups, `waiting` until the
 * newer release has REPLAY_EFFECT_MIN_VISITS sessions on the route.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatReplayMomentTrailer, type ReplayMoment } from '@builderforce/interaction-contract';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { ForbiddenError } from '../../domain/shared/errors';

const SITE = '11111111-1111-4111-8111-111111111111';
const mocks = vi.hoisted(() => ({ getSiteForTenant: vi.fn() }));
vi.mock('./replaySites', () => ({ getSiteForTenant: mocks.getSiteForTenant }));

const { effectFor, foldTicketEffect, REPLAY_EFFECT_MIN_VISITS } = await import('./ticketEffect');

const env = {} as Env;
const moment: ReplayMoment = {
  siteId: SITE,
  recordingId: '22222222-2222-4222-8222-222222222222',
  atMs: 12_000,
  releaseKey: 'rel-a',
  metric: 'frustrated',
  route: '/pricing',
};
const releases = [
  { releaseKey: 'rel-0', firstSeenAt: new Date('2026-09-01') },
  { releaseKey: 'rel-a', firstSeenAt: new Date('2026-10-01') },
  { releaseKey: 'rel-b', firstSeenAt: new Date('2026-10-08') },
];

beforeEach(() => {
  mocks.getSiteForTenant.mockReset().mockResolvedValue({ id: SITE, tenantId: 1 });
});

describe('foldTicketEffect', () => {
  it('waits while no newer release has shipped', () => {
    const effect = foldTicketEffect(5, moment, releases.slice(0, 2), [{ releaseKey: 'rel-a', sessions: 400, hits: 40 }]);
    expect(effect).toMatchObject({ status: 'waiting', after: null, delta: null, before: { sessions: 400, rate: 0.1 } });
  });

  it('waits while the newer release has fewer than the minimum visits on the route', () => {
    const effect = foldTicketEffect(5, moment, releases, [
      { releaseKey: 'rel-a', sessions: 400, hits: 40 },
      { releaseKey: 'rel-b', sessions: REPLAY_EFFECT_MIN_VISITS - 1, hits: 1 },
    ]);
    expect(effect.status).toBe('waiting');
    expect(effect.after).toMatchObject({ releaseKey: 'rel-b', sessions: REPLAY_EFFECT_MIN_VISITS - 1 });
    expect(effect.delta).toBeNull();
  });

  it('reports before / after / delta once the newer release has enough visits', () => {
    const effect = foldTicketEffect(5, moment, releases, [
      { releaseKey: 'rel-a', sessions: 400, hits: 40 },
      { releaseKey: 'rel-b', sessions: 200, hits: 4 },
    ]);
    expect(effect).toMatchObject({ status: 'measured', metric: 'frustrated', route: '/pricing', minVisits: 200 });
    expect(effect.before.rate).toBeCloseTo(0.1);
    expect(effect.after!.rate).toBeCloseTo(0.02);
    expect(effect.delta).toBeCloseTo(-0.08);
  });
});

describe('effectFor', () => {
  const description = `Rage click on Buy.\n\n${formatReplayMomentTrailer(moment)}`;

  it('is null for a ticket not raised from a replay moment', async () => {
    const db = fakeDb([[{ id: 5, description: 'An ordinary ticket' }]]);
    expect(await effectFor(env, db as unknown as Db, { tenantId: 1, taskId: 5 })).toBeNull();
    expect(mocks.getSiteForTenant).not.toHaveBeenCalled();
  });

  it('404s a task outside the workspace', async () => {
    const db = fakeDb([[]]);
    await expect(effectFor(env, db as unknown as Db, { tenantId: 1, taskId: 5 })).rejects.toThrow(/not found/);
  });

  it('refuses a moment naming another workspace\'s site', async () => {
    mocks.getSiteForTenant.mockRejectedValue(new ForbiddenError('That Insights site is not in this workspace'));
    const db = fakeDb([[{ id: 6, description }]]);
    await expect(effectFor(env, db as unknown as Db, { tenantId: 1, taskId: 6 })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('reads releases then the route rollups for the moment\'s release and the newest since', async () => {
    const db = fakeDb([
      [{ id: 7, description }],
      releases,
      [{ releaseKey: 'rel-a', sessions: 400, hits: 40 }, { releaseKey: 'rel-b', sessions: 250, hits: 5 }],
    ]);
    const effect = await effectFor(env, db as unknown as Db, { tenantId: 1, taskId: 7 });
    expect(effect).toMatchObject({ taskId: 7, status: 'measured', before: { releaseKey: 'rel-a' }, after: { releaseKey: 'rel-b', sessions: 250 } });
    expect(db.calls.map((c) => c.kind)).toEqual(['select', 'select', 'select']);
    expect(db.calls[2]!.chain).toContain('groupBy');
  });
});
