import { describe, it, expect, afterEach } from 'vitest';
import {
  computeDailyDigest, dayWindow, rankContributors, summarizeDecisions, isQuietDay,
  type ContributorTally, type DailyDigest,
} from './dailyDigest';
import { buildDatabase } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/**
 * The digest's verdict-bearing logic is pure, so it is tested without a database:
 * the day boundary (the part most likely to be silently wrong for most of the world),
 * the contributor merge, the decision fold, and the quiet-day predicate the surface
 * branches on.
 */

describe('dayWindow', () => {
  it('cuts the day on the READER’s midnight, not UTC’s', () => {
    // 2026-07-27T01:00Z is already 11:00 on the 27th in UTC+10 — the same clock day,
    // but its midnight is 2026-07-26T14:00Z.
    const w = dayWindow(new Date('2026-07-27T01:00:00Z'), 10 * 60);
    expect(w.start.toISOString()).toBe('2026-07-26T14:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-07-27T14:00:00.000Z');
    expect(w.prevStart.toISOString()).toBe('2026-07-25T14:00:00.000Z');
  });

  it('cuts on the previous UTC day for a western offset', () => {
    // 03:00Z on the 27th is still 22:00 on the 26th in UTC-5 — the reader's day began
    // at 2026-07-26T05:00Z, so their morning is NOT counted as a new day yet.
    const w = dayWindow(new Date('2026-07-27T03:00:00Z'), -5 * 60);
    expect(w.start.toISOString()).toBe('2026-07-26T05:00:00.000Z');
  });

  it('is exactly 24h wide and contiguous with the comparison window', () => {
    const w = dayWindow(new Date('2026-07-27T09:30:00Z'), 330); // UTC+5:30
    expect(w.end.getTime() - w.start.getTime()).toBe(86_400_000);
    expect(w.start.getTime() - w.prevStart.getTime()).toBe(86_400_000);
  });

  it('falls back to UTC on a nonsense offset rather than inventing a window', () => {
    for (const bad of [Number.NaN, 99_999, -99_999]) {
      const w = dayWindow(new Date('2026-07-27T09:30:00Z'), bad);
      expect(w.start.toISOString()).toBe('2026-07-27T00:00:00.000Z');
    }
  });
});

describe('rankContributors', () => {
  const t = (ref: string, shipped: number, runs: number, moves: number): ContributorTally =>
    ({ kind: 'cloud_agent', ref, shipped, runs, moves });

  it('ranks by shipped, then runs, then moves — never a summed score', () => {
    const ranked = rankContributors([
      t('a', 1, 0, 0),
      t('b', 0, 40, 0),   // a big run count must NOT outrank one finished ticket
      t('c', 1, 5, 0),
    ]);
    expect(ranked.map((r) => r.ref)).toEqual(['c', 'a', 'b']);
  });

  it('drops actors who contributed nothing today', () => {
    expect(rankContributors([t('idle', 0, 0, 0), t('busy', 0, 1, 0)]).map((r) => r.ref))
      .toEqual(['busy']);
  });

  it('caps the list so name resolution stays bounded', () => {
    const many = Array.from({ length: 50 }, (_, i) => t(`agent-${i}`, i, 0, 0));
    expect(rankContributors(many)).toHaveLength(6);
    expect(rankContributors(many, 2)).toHaveLength(2);
  });
});

describe('summarizeDecisions', () => {
  it('folds duplicates, ranks by count, and drops empty classes', () => {
    expect(summarizeDecisions([
      { actionType: 'assign', count: 2 },
      { actionType: 'prioritize', count: 9 },
      { actionType: 'assign', count: 3 },
      { actionType: 'merge_pr', count: 0 },
    ])).toEqual([
      { actionType: 'prioritize', count: 9 },
      { actionType: 'assign', count: 5 },
    ]);
  });

  it('passes an unknown action type through rather than dropping it', () => {
    // A decision class added by a later manager pass must be counted the day it ships,
    // not the day this module learns its name.
    expect(summarizeDecisions([{ actionType: 'some_future_decision', count: 4 }]))
      .toEqual([{ actionType: 'some_future_decision', count: 4 }]);
  });
});

describe('isQuietDay', () => {
  const digest = (patch: Partial<DailyDigest['team']> & { decisions?: number } = {}): DailyDigest => ({
    projectId: 1,
    dayStart: '2026-07-27T00:00:00.000Z',
    dayEnd: '2026-07-28T00:00:00.000Z',
    manager: {
      passes: 0,
      decisions: { today: patch.decisions ?? 0, yesterday: 0 },
      byType: [],
      lastRunAt: null,
    },
    team: {
      shipped: { today: 0, yesterday: 0 },
      opened: { today: 0, yesterday: 0 },
      laneMoves: { forward: 0, backward: 0, byHuman: 0, byAgent: 0 },
      runs: { completed: 0, failed: 0 },
      prs: { merged: { today: 0, yesterday: 0 }, opened: 0 },
      contributors: [],
      ...patch,
    },
    shipped: [],
    needsAttention: { escalatedToday: 0, openEscalations: 0, items: [] },
    computedAt: '2026-07-27T09:00:00.000Z',
  });

  it('is quiet when nothing moved', () => {
    expect(isQuietDay(digest())).toBe(true);
  });

  it('is NOT quiet when only the manager acted', () => {
    // The manager grooming a backlog is an accomplishment even on a day the team
    // shipped nothing — reporting it as "nothing happened" would be a lie about work
    // that is journalled and visible on the Activity tab.
    expect(isQuietDay(digest({ decisions: 12 }))).toBe(false);
  });

  it('is NOT quiet when work moved but nothing finished', () => {
    expect(isQuietDay(digest({ laneMoves: { forward: 3, backward: 0, byHuman: 3, byAgent: 0 } }))).toBe(false);
    expect(isQuietDay(digest({ runs: { completed: 0, failed: 2 } }))).toBe(false);
  });
});

/**
 * The queries themselves, rendered without a database.
 *
 * The neon HTTP driver posts every statement as JSON over global fetch, so stubbing
 * fetch captures the exact SQL and its bound parameters. This guards the failure this
 * module already hit once: a Date interpolated bare into a `sql` template carries NO
 * column encoder, so it reaches the driver as a raw JS Date and the day boundary stops
 * meaning what the rest of the schema means by a timestamp. Asserting the window
 * arrives as BOUND ISO parameters is the cheapest way to keep that fixed.
 */
describe('computeDailyDigest SQL', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  async function renderQueries() {
    const sent: Array<{ query: string; params: unknown[] }> = [];
    globalThis.fetch = (async (_url: unknown, init: { body?: string } = {}) => {
      const body = JSON.parse(init.body ?? '{}') as { query: string; params: unknown[] };
      sent.push(body);
      return new Response(JSON.stringify({ command: 'SELECT', rowCount: 0, rows: [], fields: [] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const db = buildDatabase({ NEON_DATABASE_URL: 'postgresql://u:p@example.neon.tech/db' } as Env);
    const result = await computeDailyDigest(db, {
      tenantId: 1,
      projectId: 42,
      // UTC-5, mid-morning — a window whose boundaries are NOT UTC midnight, so a
      // dropped offset would show up in the bound parameters.
      window: dayWindow(new Date('2026-07-27T14:00:00Z'), -300),
      lastRunAt: null,
    });
    return { sent, result };
  }

  it('sends every aggregate, with the day boundary as bound parameters', async () => {
    const { sent } = await renderQueries();
    expect(sent).toHaveLength(10);

    const all = sent.map((s) => s.query).join('\n');
    // The counting form the digest is built on — a bare `count(*)` here would mean the
    // trend chips are measuring the whole table rather than the day.
    expect(all).toContain('filter (where');
    // Never a literal date in the statement text: the window must be parameterised.
    expect(all).not.toMatch(/\d{4}-\d{2}-\d{2}T/);

    const params = sent.flatMap((s) => s.params.map(String));
    expect(params).toContain('2026-07-27T05:00:00.000Z');  // this reader's midnight
    expect(params).toContain('2026-07-28T05:00:00.000Z');  // …and their next one
    expect(params).toContain('2026-07-26T05:00:00.000Z');  // the comparison window
  });

  it('degrades to an empty-but-shaped digest when every query returns nothing', async () => {
    const { result } = await renderQueries();
    expect(result.digest.team.shipped).toEqual({ today: 0, yesterday: 0 });
    expect(result.digest.manager.decisions).toEqual({ today: 0, yesterday: 0 });
    expect(result.digest.shipped).toEqual([]);
    expect(result.tallies).toEqual([]);
    expect(isQuietDay(result.digest)).toBe(true);
  });
});
