/**
 * The investor seam's milestone read: window rule, tiling across sends, truncation,
 * board/work-item dedupe, the render section, and the flag's validation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const boardRows = vi.hoisted(() => ({ current: [] as unknown[], lastQuery: null as unknown }));
vi.mock('../delivery/boardMilestones', () => ({
  listBoardMilestonesSince: vi.fn(async (_db: unknown, query: unknown) => { boardRows.lastQuery = query; return boardRows.current; }),
}));

import {
  DEFAULT_MILESTONE_LOOKBACK_DAYS,
  MAX_MILESTONES,
  inMilestoneWindow,
  listShippedMilestones,
  mergeMilestones,
  pendingInvestorMilestones,
  resolveMilestoneWindowStart,
  type BoardMilestoneRow,
  type InvestorMilestone,
  type WorkItemMilestone,
} from './investorMilestones';
import { renderInvestorUpdate } from './investorUpdateDelivery';
import { buildBoardPackReport, defaultBoardPackPeriod, periodForSchedule, resolveBoardPackPeriod, type BoardPack } from '../finance/boardPackReport';
import { UpdateTaskBody } from '../../presentation/routes/taskRoutes.schemas';

const NOW = new Date('2026-11-08T12:00:00.000Z');
const iso = (ms: number): string => new Date(ms).toISOString();

const workItem = (id: string, reachedAt: string): WorkItemMilestone =>
  ({ source: 'work_item', id, key: `BF-${id}`, title: `Item ${id}`, reachedAt, projectId: 1 });
const boardRow = (over: Partial<BoardMilestoneRow> & { reachedAt: string }): BoardMilestoneRow =>
  ({ boardId: 'b1', boardName: 'Platform', milestone: 'Board milestone', earnedPoints: 3, ...over });

/** Every bound string parameter reachable through a drizzle SQL object's chunks. */
function paramStrings(node: unknown, out: string[] = [], depth = 0): string[] {
  if (!node || typeof node !== 'object' || depth > 12) return out;
  const record = node as { queryChunks?: unknown[]; value?: unknown; constructor?: { name?: string } };
  if (record.constructor?.name === 'Param' && typeof record.value === 'string') out.push(record.value);
  if (Array.isArray(record.queryChunks)) for (const chunk of record.queryChunks) paramStrings(chunk, out, depth + 1);
  return out;
}

/** A db whose awaited selects resolve to queued row sets, in call order. */
function queuedDb(...results: unknown[][]) {
  const queue = [...results];
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'from', 'orderBy', 'limit', 'where']) chain[method] = () => chain;
  chain.then = (resolve: (rows: unknown[]) => unknown) => resolve(queue.shift() ?? []);
  return chain as never;
}

describe('window rule [since, until)', () => {
  const window = { since: new Date('2026-10-01T00:00:00.000Z'), until: new Date('2026-11-01T00:00:00.000Z') };

  it('includes a row exactly at since, once, and excludes a row exactly at until', () => {
    const merged = mergeMilestones(
      [workItem('1', window.since.toISOString()), workItem('2', window.until.toISOString())],
      [boardRow({ reachedAt: window.since.toISOString(), taskId: '9' }), boardRow({ reachedAt: window.until.toISOString(), taskId: '10' })],
      window,
    );
    expect(merged.milestones.map((m) => `${m.source}:${m.id}`).sort()).toEqual(['board:9', 'work_item:1']);
    expect(inMilestoneWindow(window.until, window)).toBe(false);
    expect(inMilestoneWindow(window.since, window)).toBe(true);
  });

  it('is empty, without touching the database, for an empty or inverted window', async () => {
    const db = new Proxy({}, { get: () => { throw new Error('db must not be read'); } });
    await expect(listShippedMilestones(db as never, { tenantId: 1, since: NOW, until: NOW })).resolves.toEqual({ milestones: [], moreCount: 0 });
    await expect(listShippedMilestones(db as never, { tenantId: 1, since: new Date(NOW.getTime() + 1), until: NOW })).resolves.toEqual({ milestones: [], moreCount: 0 });
  });

  it('starts at the previous window end, or a fixed lookback when none was ever sent', () => {
    const last = new Date('2026-10-01T00:00:00.000Z');
    expect(resolveMilestoneWindowStart(last, NOW)).toBe(last);
    expect(NOW.getTime() - resolveMilestoneWindowStart(null, NOW).getTime()).toBe(DEFAULT_MILESTONE_LOOKBACK_DAYS * 86_400_000);
  });
});

describe('consecutive sends tile', () => {
  it('puts a milestone that lands mid-send, and one exactly on the boundary, in exactly one update', () => {
    const start = new Date('2026-10-01T00:00:00.000Z');
    const firstEnd = new Date('2026-10-15T00:00:00.000Z'); // captured at the START of send one
    const secondEnd = new Date('2026-11-01T00:00:00.000Z');
    const items = [
      workItem('before', iso(firstEnd.getTime() - 1)),
      workItem('boundary', iso(firstEnd.getTime())),
      workItem('midSend', iso(firstEnd.getTime() + 5_000)), // landed while send one was running
    ];
    const first = mergeMilestones(items, [], { since: start, until: firstEnd }).milestones.map((m) => m.id);
    const second = mergeMilestones(items, [], { since: firstEnd, until: secondEnd }).milestones.map((m) => m.id);
    expect(first).toEqual(['before']);
    expect(second.sort()).toEqual(['boundary', 'midSend']);
    expect([...first, ...second].sort()).toEqual(['before', 'boundary', 'midSend']);
  });
});

describe('truncation', () => {
  it('keeps the newest 50, newest first, and reports how many more there were', () => {
    const window = { since: new Date('2026-01-01T00:00:00.000Z'), until: NOW };
    const base = new Date('2026-06-01T00:00:00.000Z').getTime();
    const items = Array.from({ length: 60 }, (_, i) => workItem(String(i), iso(base + i * 60_000)));
    const merged = mergeMilestones(items, [], window);
    expect(merged.milestones).toHaveLength(MAX_MILESTONES);
    expect(merged.moreCount).toBe(10);
    expect(merged.milestones[0]!.id).toBe('59');
    expect(merged.milestones.at(-1)!.id).toBe('10');
  });
});

describe('work item / board dedupe', () => {
  const window = { since: new Date('2026-10-01T00:00:00.000Z'), until: new Date('2026-11-01T00:00:00.000Z') };

  it('shows a task that is both flagged and a completed epic once, as the work item', () => {
    const merged = mergeMilestones([workItem('7', '2026-10-20T00:00:00.000Z')], [boardRow({ reachedAt: '2026-10-20T00:00:00.000Z', taskId: '7' })], window, new Set(['7']));
    expect(merged.milestones).toHaveLength(1);
    expect(merged.milestones[0]).toMatchObject({ source: 'work_item', id: '7' });
  });

  it('ids board entries by taskId, then releaseId, then board+name', () => {
    const merged = mergeMilestones([], [
      boardRow({ reachedAt: '2026-10-21T00:00:00.000Z', taskId: '8' }),
      boardRow({ reachedAt: '2026-10-22T00:00:00.000Z', releaseId: 'rel-1' }),
      boardRow({ reachedAt: '2026-10-23T00:00:00.000Z', milestone: 'Loose' }),
    ], window);
    expect(merged.milestones.map((m) => m.id)).toEqual(['b1:Loose', 'rel-1', '8']);
  });

  describe('listShippedMilestones', () => {
    beforeEach(() => { boardRows.current = []; boardRows.lastQuery = null; });

    it('drops a board entry whose epic is archived, and one whose epic is flagged', async () => {
      boardRows.current = [
        boardRow({ reachedAt: '2026-10-20T00:00:00.000Z', taskId: '11', milestone: 'Archived epic' }),
        boardRow({ reachedAt: '2026-10-21T00:00:00.000Z', taskId: '12', milestone: 'Flagged epic' }),
        boardRow({ reachedAt: '2026-10-22T00:00:00.000Z', taskId: '13', milestone: 'Plain epic' }),
      ];
      const db = queuedDb(
        [], // flagged work items in the window
        [{ id: 11, archived: true, flagged: false }, { id: 12, archived: false, flagged: true }, { id: 13, archived: false, flagged: false }],
      );
      const result = await listShippedMilestones(db, { tenantId: 5, ...window });
      expect(result.milestones.map((m) => m.title)).toEqual(['Plain epic']);
      expect(result.moreCount).toBe(0);
    });

    it('asks the board source from the window start', async () => {
      await listShippedMilestones(queuedDb([], []), { tenantId: 5, ...window });
      expect(boardRows.lastQuery).toMatchObject({ tenantId: 5, since: window.since });
    });
  });
});

describe('pendingInvestorMilestones', () => {
  it('returns the window as ISO and an empty list when nothing shipped', async () => {
    boardRows.current = [];
    const result = await pendingInvestorMilestones(queuedDb([{ at: null }], [], []), 1, NOW);
    expect(result.milestones).toEqual([]);
    expect(result.moreCount).toBe(0);
    expect(result.until).toBe(NOW.toISOString());
    expect(NOW.getTime() - new Date(result.since).getTime()).toBe(DEFAULT_MILESTONE_LOOKBACK_DAYS * 86_400_000);
  });
});

describe('board pack window', () => {
  it('defaults, with no schedule, to a labelled 30 days ending at the pack time', () => {
    const period = defaultBoardPackPeriod(NOW);
    expect(period).toMatchObject({ until: NOW, basis: 'default_30d' });
    expect(NOW.getTime() - period.since.getTime()).toBe(30 * 86_400_000);
  });

  it('gives two schedules on one frame each their own period, resolved by schedule id', async () => {
    const weeklyLast = new Date('2026-11-01T08:00:00.000Z');
    const monthlyLast = new Date('2026-10-08T08:00:00.000Z');
    const rows: Record<string, unknown[]> = {
      'sched-weekly': [{ schedule: 'weekly', lastRunAt: weeklyLast }],
      'sched-monthly': [{ schedule: 'monthly', lastRunAt: monthlyLast }],
    };
    let matched: unknown[] = [];
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'from', 'limit']) chain[method] = () => chain;
    chain.where = (clause: unknown) => {
      const ids = paramStrings(clause);
      matched = rows[ids.find((id) => id in rows) ?? ''] ?? [];
      return chain;
    };
    chain.then = (resolve: (r: unknown[]) => unknown) => resolve(matched);
    const weekly = await resolveBoardPackPeriod(chain as never, 5, 'sched-weekly', NOW);
    const monthly = await resolveBoardPackPeriod(chain as never, 5, 'sched-monthly', NOW);
    expect(weekly.since).toBe(weeklyLast);
    expect(monthly.since).toBe(monthlyLast);
  });

  it('labels an ad hoc run with no schedule id as the 30-day default', async () => {
    const period = await resolveBoardPackPeriod(new Proxy({}, { get: () => { throw new Error('no read'); } }) as never, 5, undefined, NOW);
    expect(period.basis).toBe('default_30d');
  });

  it('goes back one calendar month on a monthly first run, clamped to the month end', () => {
    const since = (iso: string) => periodForSchedule('monthly', null, new Date(iso)).since.toISOString();
    expect(since('2026-03-31T09:30:00.000Z')).toBe('2026-02-28T09:30:00.000Z');
    expect(since('2028-03-31T09:30:00.000Z')).toBe('2028-02-29T09:30:00.000Z');
    expect(since('2026-01-15T00:00:00.000Z')).toBe('2025-12-15T00:00:00.000Z');
    expect(since('2026-05-31T00:00:00.000Z')).toBe('2026-04-30T00:00:00.000Z');
  });

  it('keeps daily at one day and weekly at seven', () => {
    expect(NOW.getTime() - periodForSchedule('daily', null, NOW).since.getTime()).toBe(86_400_000);
    expect(NOW.getTime() - periodForSchedule('weekly', null, NOW).since.getTime()).toBe(7 * 86_400_000);
  });

  it('treats a future lastRunAt, or one equal to now, as never having run', () => {
    const future = periodForSchedule('weekly', new Date(NOW.getTime() + 1000), NOW);
    expect(future.basis).toBe('cadence');
    expect(NOW.getTime() - future.since.getTime()).toBe(7 * 86_400_000);
    const equal = periodForSchedule('weekly', new Date(NOW.getTime()), NOW);
    expect(equal.basis).toBe('cadence');
    expect(equal.since.getTime()).toBeLessThan(equal.until.getTime());
  });

  it('falls back to 30 days for an unknown cadence', () => {
    const period = periodForSchedule('fortnightly', null, NOW);
    expect(period.basis).toBe('cadence');
    expect(NOW.getTime() - period.since.getTime()).toBe(30 * 86_400_000);
  });

  it('runs from the schedule\'s last delivery, or one cadence back before its first', () => {
    const last = new Date('2026-11-01T08:00:00.000Z');
    expect(periodForSchedule('weekly', last, NOW)).toEqual({ since: last, until: NOW, basis: 'last_run' });
    const first = periodForSchedule('weekly', null, NOW);
    expect(first.basis).toBe('cadence');
    expect(NOW.getTime() - first.since.getTime()).toBe(7 * 86_400_000);
  });

  it('builds a pack whose milestones are read over the schedule\'s own period', async () => {
    const last = new Date('2026-11-01T08:00:00.000Z');
    boardRows.current = [];
    const frame = { id: 'f1', kind: 'frame', canvasData: { title: 'Board', children: ['k1'] } };
    const kpi = { id: 'k1', kind: 'kpi', canvasData: { title: 'ARR', value: 10 } };
    const db = queuedDb(
      [{ schedule: 'weekly', lastRunAt: last }], // the schedule delivering this frame
      [{ id: 's1', title: 'Session' }],
      [frame, kpi],
      [{ id: 3, key: 'BF-3', title: 'Shipped', projectId: 1, completedAt: new Date('2026-11-05T00:00:00.000Z') }],
    );
    const result = await buildBoardPackReport(db, 5, 'canvas_frame', 's1:f1', NOW, 'sched-1');
    const pack = result!.report as unknown as BoardPack;
    expect(boardRows.lastQuery).toMatchObject({ tenantId: 5, since: last, until: NOW });
    expect(pack.milestonesPeriod).toEqual({ since: last.toISOString(), until: NOW.toISOString(), basis: 'last_run' });
    expect(pack.milestones.map((m) => m.id)).toEqual(['3']);
  });
});

describe('investor update render', () => {
  const content = { title: 'October update' };
  const milestones: InvestorMilestone[] = [
    { source: 'work_item', id: '7', key: 'BF-7', title: 'SSO <GA>', reachedAt: '2026-10-20T00:00:00.000Z', projectId: 1 },
    { source: 'board', id: 'b1:Q4 launch', title: 'Q4 launch', reachedAt: '2026-10-25T00:00:00.000Z', boardId: 'b1', boardName: 'Platform', earnedPoints: 12 },
  ];

  it('lists shipped milestones, escaped, with the board that earned a board milestone', () => {
    const { html } = renderInvestorUpdate(content, milestones);
    expect(html).toContain('Milestones shipped');
    expect(html).toContain('SSO &lt;GA&gt;');
    expect(html).toContain('Q4 launch (Platform)');
  });

  it('says how many more there were', () => {
    expect(renderInvestorUpdate(content, milestones, 4).html).toContain('and 4 more');
    expect(renderInvestorUpdate(content, milestones, 0).html).not.toContain('more');
  });

  it('omits the section when nothing shipped', () => {
    expect(renderInvestorUpdate(content, []).html).not.toContain('Milestones shipped');
    expect(renderInvestorUpdate(content).html).not.toContain('Milestones shipped');
  });
});

describe('investor milestone flag validation', () => {
  it('accepts a boolean to set or clear', () => {
    expect(UpdateTaskBody.parse({ investorMilestone: true }).investorMilestone).toBe(true);
    expect(UpdateTaskBody.parse({ investorMilestone: false }).investorMilestone).toBe(false);
  });

  it('rejects null and non-booleans', () => {
    expect(UpdateTaskBody.safeParse({ investorMilestone: null }).success).toBe(false);
    expect(UpdateTaskBody.safeParse({ investorMilestone: 'yes' }).success).toBe(false);
  });
});
