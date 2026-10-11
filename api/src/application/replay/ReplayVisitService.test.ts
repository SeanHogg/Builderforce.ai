import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import {
  parseReplaySiteId,
  ReplayVisitService,
  REPLAY_VISIT_LIST_LIMIT,
  toAdminReplayVisit,
} from './ReplayVisitService';

describe('parseReplaySiteId', () => {
  it('accepts opaque recorder keys', () => {
    expect(parseReplaySiteId('site_abc-1')).toBe('site_abc-1');
    expect(parseReplaySiteId('  a:b.c  ')).toBe('a:b.c');
  });

  it('rejects empty or punctuation that is not a recorder id', () => {
    expect(parseReplaySiteId('')).toBeNull();
    expect(parseReplaySiteId('   ')).toBeNull();
    expect(parseReplaySiteId('a/b')).toBeNull();
    expect(parseReplaySiteId('x'.repeat(65))).toBeNull();
  });
});

describe('toAdminReplayVisit', () => {
  it('serialises dates to ISO and keeps VisitRow counters', () => {
    const started = new Date('2026-10-11T12:00:00.000Z');
    const last = new Date('2026-10-11T12:01:30.000Z');
    expect(
      toAdminReplayVisit({
        visitId: 'v1',
        siteId: 's1',
        startedAt: started,
        lastEventAt: last,
        endedAt: last,
        durationMs: 90_000,
        activeMs: 80_000,
        entryPath: '/pricing',
        exitPath: '/checkout',
        pageCount: 3,
        clickCount: 12,
        rageCount: 0,
        deadCount: 1,
        errorCount: 0,
        quickbackCount: 0,
        excessiveScrollCount: 2,
        converted: true,
        chunkCount: 4,
      }),
    ).toEqual({
      visitId: 'v1',
      siteId: 's1',
      startedAt: '2026-10-11T12:00:00.000Z',
      lastEventAt: '2026-10-11T12:01:30.000Z',
      endedAt: '2026-10-11T12:01:30.000Z',
      durationMs: 90_000,
      activeMs: 80_000,
      entryPath: '/pricing',
      exitPath: '/checkout',
      pageCount: 3,
      clickCount: 12,
      rageCount: 0,
      deadCount: 1,
      errorCount: 0,
      quickbackCount: 0,
      excessiveScrollCount: 2,
      converted: true,
      chunkCount: 4,
    });
  });

  it('maps a null endedAt through', () => {
    expect(
      toAdminReplayVisit({
        visitId: 'open',
        siteId: 's1',
        startedAt: '2026-10-11T12:00:00.000Z',
        lastEventAt: '2026-10-11T12:00:01.000Z',
        endedAt: null,
        durationMs: 1000,
        activeMs: 1000,
        entryPath: '/',
        exitPath: '/',
        pageCount: 1,
        clickCount: 0,
        rageCount: 0,
        deadCount: 0,
        errorCount: 0,
        quickbackCount: 0,
        excessiveScrollCount: 0,
        converted: false,
        chunkCount: 1,
      }).endedAt,
    ).toBeNull();
  });
});

function fakeDb(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { db: { select } as unknown as Db, where, limit };
}

describe('ReplayVisitService.listVisits', () => {
  it('maps rows and caps the page', async () => {
    const started = new Date('2026-10-11T12:00:00.000Z');
    const last = new Date('2026-10-11T12:01:00.000Z');
    const { db, limit } = fakeDb([
      {
        visitId: 'v1',
        siteId: 's1',
        tenantId: 7,
        startedAt: started,
        lastEventAt: last,
        endedAt: null,
        durationMs: 60_000,
        activeMs: 50_000,
        entryPath: '/',
        exitPath: '/done',
        pageCount: 2,
        clickCount: 4,
        rageCount: 0,
        deadCount: 0,
        errorCount: 0,
        quickbackCount: 0,
        excessiveScrollCount: 0,
        converted: false,
        chunkCount: 1,
      },
    ]);
    const visits = await new ReplayVisitService(db).listVisits();
    expect(limit).toHaveBeenCalledWith(REPLAY_VISIT_LIST_LIMIT);
    expect(visits).toEqual([
      {
        visitId: 'v1',
        siteId: 's1',
        startedAt: '2026-10-11T12:00:00.000Z',
        lastEventAt: '2026-10-11T12:01:00.000Z',
        endedAt: null,
        durationMs: 60_000,
        activeMs: 50_000,
        entryPath: '/',
        exitPath: '/done',
        pageCount: 2,
        clickCount: 4,
        rageCount: 0,
        deadCount: 0,
        errorCount: 0,
        quickbackCount: 0,
        excessiveScrollCount: 0,
        converted: false,
        chunkCount: 1,
      },
    ]);
  });

  it('filters by site when a key is supplied', async () => {
    const { db, where } = fakeDb([]);
    await new ReplayVisitService(db).listVisits('site-9');
    expect(where).toHaveBeenCalled();
  });
});
