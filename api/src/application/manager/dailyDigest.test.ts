import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, afterEach } from 'vitest';
import {
  computeDailyDigest, contributorKind, dayWindow, rankContributors, summarizeDecisions, isQuietDay,
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

describe('contributorKind', () => {
  it('credits every actor kind the transition log can name', () => {
    // Lane moves used to credit humans only, because an agent's hop carried no
    // identity. Now the log names the mover, so an agent's advances reach the
    // leaderboard instead of being inferred from its run count.
    expect(contributorKind('human')).toBe('human');
    expect(contributorKind('hire')).toBe('hire');
    expect(contributorKind('cloud_agent')).toBe('cloud_agent');
    expect(contributorKind('host_agent')).toBe('host_agent');
  });

  it('credits nobody for identity-less automation', () => {
    // 'system' is a cron or a webhook — real work with no member to point at. A
    // "System" row on the leaderboard would be a contributor nobody can act on.
    expect(contributorKind('system')).toBeNull();
    expect(contributorKind(null)).toBeNull();
    expect(contributorKind('something_new')).toBeNull();
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

/**
 * WHO GETS CREDITED FOR FINISHING A TICKET.
 *
 * Reported from the live Manager surface (project 11, 2026-07-28): every member of the
 * "Who moved work today" list read `0 finished`, beside honest run counts — Bob Developer
 * at 4,404 runs and 0 finished. On that day the zero was also TRUE (nothing reached a
 * done lane at all), but the attribution underneath it was wrong and would have kept
 * reading 0 once tickets did start finishing.
 *
 * The `shipped` column was grouped by the TICKET'S ASSIGNEE
 * (`tasks.assigned_user_id / assigned_agent_ref / assigned_agent_host_id`). On a
 * LIFECYCLE-MANAGED board the assignee is the Coordinator, never the executor — an
 * invariant this codebase states in `evaluateAutoRun`, `stallTriage` and
 * `systemicDiagnosis`, each warning that assigning an owner does not make anyone able to
 * work the ticket. So every completion on such a board credited one Coordinator row and
 * every agent that did the work showed zero.
 *
 * The other two columns never had this problem: `runs` attributes to
 * `executions.cloud_agent_ref` and `moves` to `task_status_transitions.actor_ref`. The
 * fix makes `shipped` read the same transition stamp, so all three columns answer "who
 * did this" the same way.
 */
describe('contributor `shipped` attribution', () => {
  const source = readFileSync(
    fileURLToPath(new URL('./dailyDigest.ts', import.meta.url).href),
    'utf8',
  );

  it('credits the actor of the terminal hop, not the ticket assignee', () => {
    // The assignee columns must no longer appear in the ownership rollup at all.
    expect(source).not.toMatch(/\.groupBy\(tasks\.assignedUserId, tasks\.assignedAgentRef/);
    expect(source).toMatch(/\.groupBy\(taskStatusTransitions\.actorKind, taskStatusTransitions\.actorRef\)/);
  });

  it('counts each finished ticket once, however many terminal hops it made', () => {
    // A ticket can enter a done lane, be reopened and re-finish inside one day. Without
    // the distinct it would inflate its actor's credit on every re-entry.
    expect(source).toMatch(/count\(distinct \$\{taskStatusTransitions\.taskId\}\)/);
  });

  it('excludes backward hops — a redo is not a finish', () => {
    expect(source).toMatch(/isNull\(taskStatusTransitions\.isBackward\)/);
    expect(source).toMatch(/eq\(taskStatusTransitions\.isBackward, false\)/);
  });

  it('derives "terminal" from the shared status set, not a second hand-written list', () => {
    // A board that renames its done lane must not silently stop crediting anyone.
    expect(source).toMatch(/notInArray\(taskStatusTransitions\.toStatus, NON_TERMINAL_TASK_STATUSES\)/);
  });

  it('routes the credit through the SAME actor-kind mapping the lane moves use', () => {
    // One answer to "is this an actor I can credit?" across all three columns; an
    // identity-less 'system' stamp credits nobody rather than inventing a member.
    expect(contributorKind('cloud_agent')).toBe('cloud_agent');
    expect(contributorKind('human')).toBe('human');
    expect(contributorKind('system')).toBeNull();
    expect(contributorKind(null)).toBeNull();
    expect(source).toMatch(/const kind = contributorKind\(o\.actorKind\);/);
  });
});

/**
 * The SAMPLED "Finished today" list carried the same defect as the contributor column —
 * it captioned each row with the ticket's assignee, i.e. the Coordinator on a
 * lifecycle-managed board. Fixed by preferring the terminal-hop actor, with the assignee
 * kept as the fallback so an UNMANAGED board (where the assignee really is the person who
 * did it) does not lose its caption.
 */
describe('shipped sample owner caption', () => {
  const source = readFileSync(
    fileURLToPath(new URL('./dailyDigest.ts', import.meta.url).href),
    'utf8',
  );

  it('prefers the finisher and falls back to the assignee', () => {
    expect(source).toMatch(/const finisher = contributorKind\(r\.finisherKind\);/);
    expect(source).toMatch(/\(finisher && r\.finisherRef\)\s*\?\s*r\.finisherRef/);
    // The fallback chain must survive — removing it would blank the owner column on
    // every non-managed board.
    expect(source).toMatch(/r\.assignedUserId \?\? r\.assignedAgentRef/);
  });

  it('reads the finisher with a BOUNDED subquery, never a per-ticket round-trip', () => {
    // It runs against at most SHIPPED_SAMPLE rows and is expressed inside the same
    // statement; a loop of lookups here would be the N+1 the perf rules forbid.
    expect(source).toMatch(/order by t\.occurred_at desc limit 1/);
    expect(source.match(/order by t\.occurred_at desc limit 1/g)?.length).toBe(2);
  });

  it('binds the status list as explicit parameters, not a raw array literal', () => {
    // `<> all(${jsArray})` binds a JS array into raw SQL as an untyped parameter, which
    // is exactly the shape that silently matches nothing. Keep the expanded IN list.
    expect(source).not.toMatch(/<> all\(\$\{NON_TERMINAL_TASK_STATUSES\}\)/);
    expect(source).toMatch(/not in \(\$\{sql\.join\(NON_TERMINAL_TASK_STATUSES\.map/);
  });
});
