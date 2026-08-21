import { describe, it, expect } from 'vitest';
import {
  buildManagerDiagnosticsReport,
  classifyPass,
  managerFindings,
  parseActionDetail,
  passCountersFrom,
  repeatedActions,
  summarizePassLimits,
  summarizeSignoffs,
  summarizeBoardStaffing,
  MAX_CAUSE_WORDINGS,
  STALL_WINDOW_HEAD,
  STALL_WINDOW_TAIL,
  type ManagerDiagnosticsInput,
} from './managerDiagnostics';
import type {
  ManagerDailyDigest,
  ManagerAction,
  ManagerOverview,
  ManagerPassRecord,
  ManagerPolicy,
  ManagerRunTask,
  StallCensusResponse,
  StallRegister,
  StallWatchRow,
} from './builderforceApi';

/**
 * This report is what a user pastes when the board has rotted, so the failure mode that
 * matters is a report that LOOKS complete while omitting the one field that explains it:
 * which policy tier turned a capability off, whether the passes actually completed, what
 * a pass changed, or how long a remedy has been failing.
 *
 * The fixture is the real shape that motivated it (measured on one tenant): a pass card
 * open for seven days, three passes reaped without reporting completion, completed passes
 * reporting "scored 0 · assigned 0 · dispatched 0" against 300 unscored tickets, and an
 * activity feed repeating the same two refusals.
 */
const CAPTURED_AT = '2026-07-25T10:00:00.000Z';
const now = Date.parse(CAPTURED_AT);
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const policy: ManagerPolicy = {
  enabled: true,
  managerRef: null,
  managerKind: 'system',
  prMergePolicy: 'on_green',
  autoAssign: true,
  autoBusinessValue: true,
  autoPrioritize: true,
  autoSchedule: false,
  managerType: 'general',
  requireSignoffToComplete: true,
  allowAutoMerge: false,
  allowUnattendedCeremonies: false,
  allowAutoStaffLanes: false,
  allowAgentReassignment: false,
  agentReassignIdleHours: 48,
  agentReassignMaxPerSession: 3,
};

const runTasks: ManagerRunTask[] = [
  {
    id: 730, key: '1-UNTITLED-730', title: 'Backlog management pass', status: 'in_progress',
    summary: 'The AI Manager is grooming this backlog — scoring business value, ranking the work…',
    assignedUserId: null, assignedAgentRef: null, assignedAgentHostId: null,
    createdAt: iso(7 * DAY), completedAt: null,
  },
  {
    id: 701, key: '1-UNTITLED-701', title: 'Backlog management pass', status: 'done',
    summary: 'Backlog management pass complete. Scored 0 · ranked 300 · assigned 0 · PRs 0 · dispatched 0 · audited 40.',
    assignedUserId: null, assignedAgentRef: null, assignedAgentHostId: null,
    createdAt: iso(14 * DAY), completedAt: iso(14 * DAY - 4 * MIN),
  },
  {
    id: 379, key: '1-UNTITLED-379', title: 'Backlog management pass', status: 'blocked',
    summary: 'Closed before a newer backlog management pass started; the prior background run did not report completion.',
    assignedUserId: null, assignedAgentRef: null, assignedAgentHostId: null,
    createdAt: iso(15 * DAY), completedAt: null,
  },
  {
    id: 327, key: '1-UNTITLED-327', title: 'Backlog management pass', status: 'blocked',
    summary: 'Closed before a newer backlog management pass started; the prior background run did not report completion.',
    assignedUserId: null, assignedAgentRef: null, assignedAgentHostId: null,
    createdAt: iso(16 * DAY), completedAt: null,
  },
];

const actions: ManagerAction[] = [
  ...Array.from({ length: 5 }, (_, i): ManagerAction => ({
    id: `a${i}`, taskId: 100, ticketKey: '1-UNTITLED-100', ticketTitle: 'Produce a feature matrix',
    actionType: 'flag',
    summary: 'Could not update PR #40 from the latest base: merge conflicts',
    detail: '{"code":"conflict","recoveryStarted":false}',
    createdAt: iso(30 * MIN + i * MIN),
  })),
  {
    id: 'b1', taskId: 64, ticketKey: '1-UNTITLED-064', ticketTitle: 'Review memory package',
    actionType: 'merge_blocked',
    summary: 'Did not merge PR #36 — waiting on 10 of 10 required sign-offs',
    detail: '{"signoffGate":"outstanding_signoffs","requiredCount":10}',
    createdAt: iso(31 * MIN),
  },
];

const stallRow = (over: Partial<StallWatchRow> = {}): StallWatchRow => ({
  taskId: 1, title: 'A ticket that is not moving', status: 'in_review',
  cause: 'awaiting_signoff', remedy: 'drive_signoff', detail: 'Waiting on 10 of 10 sign-offs',
  attempts: 1, idleMs: 3 * DAY, firstSeenAt: iso(3 * DAY), lastSeenAt: iso(HOUR),
  lastAttemptAt: iso(HOUR), escalatedAt: null, ...over,
});

const stalls: StallRegister = {
  rows: [
    stallRow({ taskId: 100, attempts: 3, escalatedAt: iso(2 * HOUR), cause: 'pr_conflict', remedy: 'resolve_conflict' }),
    stallRow({ taskId: 64, attempts: 3 }),
    stallRow({ taskId: 12, attempts: 1, cause: 'unassigned', remedy: 'assign' }),
  ],
  escalated: 1,
  working: 2,
  byCause: [{ cause: 'awaiting_signoff', count: 2 }, { cause: 'pr_conflict', count: 1 }],
  maxAttempts: 3,
};

/**
 * The `manager_runs` rows behind the cards above.
 *
 * The counters used to be parsed out of the run card's PROSE summary, and this fixture
 * carried only the cards — so when migration 1082 moved the counters onto
 * `manager_runs.summary` (see `passCountersFrom`, which reads the RECORD), three
 * assertions here started asking for findings that can no longer be raised from prose.
 * The production reading is the right one: a card's sentence is written for a person and
 * a counter is data. The fixture now supplies both, which is what the running product
 * does.
 */
const passes: ManagerPassRecord[] = [
  {
    runTaskId: 701, ok: true, changed: true, shedStages: [],
    summary: { scored: 0, ranked: 300, assigned: 0, prsConducted: 0, prsMerged: 0, dispatched: 0, audited: 40 },
    at: iso(14 * DAY - 4 * MIN),
  },
];

const overview: ManagerOverview = {
  config: {
    managerRef: null, enabled: true, prMergePolicy: 'on_green',
    autoAssign: true, autoBusinessValue: true, autoPrioritize: true, autoSchedule: false,
    requireSignoffToComplete: true, allowAutoMerge: null,
    allowUnattendedCeremonies: null, allowAgentReassignment: null, allowAutoStaffLanes: null,
    agentReassignIdleHours: null, agentReassignMaxPerSession: null,
    managerType: 'general', lastRunAt: iso(22 * MIN),
  },
  policy,
  tenantPolicy: { ...policy, allowAutoMerge: false, autoSchedule: false },
  stats: {
    total: 300, unscored: 300, unranked: 0, undated: 300, unowned: 300,
    openPullRequests: 2, flagged: 40, lastRunAt: iso(22 * MIN),
  },
  backlog: [],
  actions,
  runTasks,
  passes,
  autonomy: { tokenBlocked: false, reason: null, effectivePlan: 'free' },
  managerTypes: [],
  directives: [{
    id: 'd1', projectId: 2, directive: 'Prioritise anything touching billing',
    status: 'active', createdBy: 'u1', source: 'coach', createdAt: iso(9 * DAY), expiresAt: null,
  }],
};

const input: ManagerDiagnosticsInput = { projectId: 2, overview, stalls };
const ctx = { capturedAt: CAPTURED_AT, uiVersion: '2026.7.110', apiVersion: '2026.7.140', sourceUrl: 'https://builderforce.ai/projects?tab=manager&sub=stuck' };
const report = buildManagerDiagnosticsReport(input, ctx);
const codes = (over: Partial<ManagerDiagnosticsInput> = {}) =>
  managerFindings({ ...input, ...over }, now).map((f) => f.code);

describe('buildManagerDiagnosticsReport — structure', () => {
  it('records the build versions and the surface it was captured from', () => {
    expect(report).toContain('uiVersion: 2026.7.110');
    expect(report).toContain('apiVersion: 2026.7.140');
    expect(report).toContain('capturedAt: 2026-07-25T10:00:00.000Z');
    expect(report).toContain('sub=stuck');
    expect(report).toContain('projectId: 2');
  });

  it('puts the environment AND the findings above every raw row', () => {
    // The ordering that survives a truncated paste: provenance, then the answer, then
    // the evidence. A report cut in half must still say which build and what is wrong.
    expect(report.indexOf('uiVersion:')).toBeLessThan(report.indexOf('-- Findings'));
    expect(report.indexOf('-- Findings')).toBeLessThan(report.indexOf('-- Stuck register'));
    expect(report.indexOf('-- Findings')).toBeLessThan(report.indexOf('-- Decision feed'));
  });

  it('appends re-parseable raw JSON', () => {
    const start = report.indexOf('-- Raw payload (JSON) --');
    const parsed = JSON.parse(report.slice(report.indexOf('{', start)));
    expect(parsed).toMatchObject({ projectId: 2 });
    expect(parsed.overview.stats.unscored).toBe(300);
  });
});

describe('buildManagerDiagnosticsReport — content', () => {
  it('shows every policy field with the TIER that produced it', () => {
    // Without the tiers, "auto-scheduling is off" leaves the reader unable to tell
    // whether to change this project or the workspace defaults.
    expect(report).toContain('autoSchedule: no   [project: no · workspace: no]');
    expect(report).toContain('allowAutoMerge: no   [project: inherit · workspace: no]');
  });

  it('does not mislabel a built-in default as an explicit workspace veto', () => {
    const withRawWorkspaceTier = buildManagerDiagnosticsReport({
      ...input,
      overview: { ...overview, tenantConfig: null },
    }, ctx);
    expect(withRawWorkspaceTier).toContain('allowAutoMerge: no   [project: inherit · workspace: inherit]');
    expect(withRawWorkspaceTier).toContain('allowAutoStaffLanes: no   [project: inherit · workspace: inherit]');
  });

  it('states backlog deficits as a SHARE of the backlog, not a bare count', () => {
    expect(report).toContain('unscored: 300 of 300 (100%)');
    expect(report).toContain('flagged (unmet role coverage): 40 of 300 (13%)');
  });

  it('classifies every management pass and parses its counters', () => {
    expect(report).toContain('1-UNTITLED-730  outcome=died');
    expect(report).toContain('1-UNTITLED-701  outcome=completed');
    expect(report).toContain('1-UNTITLED-379  outcome=ended_early');
    expect(report).toContain('counters: scored=0 ranked=300 assigned=0 prs=0 dispatched=0 audited=40');
  });

  it('rolls the decision feed up so a repeat reads as a loop, not as five decisions', () => {
    expect(report).toContain('5× flag: Could not update PR #40');
    expect(report).toContain('by type: flag=5 merge_blocked=1');
  });

  it('carries the stuck rows with cause, remedy, attempts and idle time', () => {
    expect(report).toContain('cause=awaiting_signoff  remedy=drive_signoff  attempts=3');
    expect(report).toContain('ESCALATED=');
    expect(report).toContain('awaiting_signoff: 2');
  });

  it('lists standing directives — a stale one is a real cause of odd behaviour', () => {
    expect(report).toContain('Standing coaching directives (1 active of 1)');
    expect(report).toContain('Prioritise anything touching billing');
  });

  it('says the register is UNAVAILABLE rather than rendering it as empty', () => {
    // An empty register reads as "nothing is stuck", which is the opposite of "unknown".
    const broken = buildManagerDiagnosticsReport(
      { ...input, stalls: null, stallsError: 'HTTP 500' }, ctx,
    );
    expect(broken).toContain('(unavailable: HTTP 500 — this is NOT the same as "nothing is stuck")');
    expect(broken).toContain('stall_register_unavailable');
  });

  it('never silently truncates a long register — the elision is counted', () => {
    const many = Array.from({ length: 400 }, (_, i) => stallRow({ taskId: i, title: `ticket-${i}` }));
    const big = buildManagerDiagnosticsReport({ ...input, stalls: { ...stalls, rows: many } }, ctx);
    expect(big).toContain('ticket-0');           // head kept
    expect(big).toContain('ticket-399');         // tail kept — what a naive cut loses
    expect(big).toContain(`… ${400 - STALL_WINDOW_HEAD - STALL_WINDOW_TAIL} stuck tickets elided`);
  });

  it('drops the raw rows from the JSON — never a computed block — when over budget', () => {
    const many = Array.from({ length: 900 }, (_, i) => stallRow({ taskId: i, detail: 'x'.repeat(200) }));
    const big = buildManagerDiagnosticsReport({ ...input, stalls: { ...stalls, rows: many } }, ctx);
    expect(big).toContain('rows elided: the full report would exceed');
    expect(big).toContain('-- Findings');
    expect(big).toContain('-- Backlog health');
    const parsed = JSON.parse(big.slice(big.indexOf('{', big.indexOf('-- Raw payload (JSON) --'))));
    expect(String(parsed.stalls.rows)).toContain('<elided: 900 stuck tickets');
  });
});

describe('managerFindings', () => {
  it('names a pass that died mid-flight, with its key and how long it has been open', () => {
    const f = managerFindings(input, now).find((x) => x.code === 'pass_never_completed');
    expect(f?.severity).toBe('critical');
    expect(f?.text).toContain('1-UNTITLED-730');
    expect(f?.text).toContain('7d 00h');
  });

  /**
   * ONLY A MANUAL RUN FILES A PASS CARD — the 5-minute cron path files none, by design
   * (288 board tickets per project per day otherwise). So the newest COMPLETED card can be
   * weeks old, and its counters describe the backlog as it was THEN.
   *
   * Measured on project 11 on 2026-07-27: `scored 0 · assigned 0` from a card dated
   * 2026-07-13 produced two CRITICAL "the pass is finishing and reporting success without
   * changing the backlog" findings — a verdict delivered on 14-day-old evidence, aimed at
   * a mechanism whose cron had run two minutes earlier.
   */
  const freshPass = (over: Partial<ManagerRunTask> = {}): ManagerRunTask => ({
    ...runTasks[1]!, id: 999, key: '1-UNTITLED-999',
    createdAt: iso(6 * MIN), completedAt: iso(5 * MIN), ...over,
  });

  it('names a pass that completes and changes NOTHING (the silent no-op)', () => {
    const recent = {
      ...input,
      overview: {
        ...overview,
        runTasks: [freshPass(), ...runTasks],
        // The record the FRESH card closed — same counters, five minutes old rather than
        // fourteen days, which is the entire difference between the two findings.
        passes: [{ ...passes[0]!, runTaskId: 999, at: iso(5 * MIN) }, ...passes],
      },
    };
    const f = managerFindings(recent, now).find((x) => x.code === 'ineffective_autoBusinessValue');
    expect(f?.severity).toBe('critical');
    expect(f?.text).toContain('reported scored 0');
    expect(f?.text).toContain('300 of 300 (100%)');
    // autoPrioritize reported 300 ranked and has no deficit → must NOT be accused.
    expect(codes(recent)).not.toContain('ineffective_autoPrioritize');
  });

  it('will NOT convict a capability on a stale card — it says the evidence is too old', () => {
    // The fixture's newest completed card is 14 days old.
    expect(codes()).not.toContain('ineffective_autoBusinessValue');
    const f = managerFindings(input, now).find((x) => x.code === 'unverified_autoBusinessValue');
    expect(f?.severity).toBe('warning');
    expect(f?.text).toContain('too old to judge it by');
    // The deficit is still surfaced — silence would be the opposite failure.
    expect(f?.text).toContain('300 of 300 (100%)');
  });

  it('separates "switched off" from "switched on and failing"', () => {
    // undated 300 with autoSchedule off is configuration, not a fault — and it must name
    // both tiers so the reader knows where to change it.
    const off = managerFindings(input, now).find((x) => x.code === 'policy_off_autoSchedule');
    expect(off?.severity).toBe('warning');
    expect(off?.text).toContain('project tier: no · workspace tier: no');
    expect(codes()).not.toContain('ineffective_autoSchedule');
  });

  it('reports reaped passes as a share of recent passes', () => {
    expect(codes()).toContain('passes_ending_early');
    const f = managerFindings(input, now).find((x) => x.code === 'passes_ending_early');
    expect(f?.text).toContain('2 of the last 4 pass cards (50%)');
  });

  /**
   * A reaped card means "the pass died" ONLY when nothing proves otherwise. The cron pass
   * files no card of its own but DOES reap whatever it finds open, so on a live project
   * every manual card eventually reads as `ended_early`. Reported as critical, that is a
   * false alarm aimed at a healthy mechanism — measured: 6 of 8 "passes ending early" on a
   * project whose scheduled sweep had run two minutes before the capture.
   */
  it('downgrades reaped cards to a warning when lastRunAt proves the cron is alive', () => {
    const f = managerFindings(input, now).find((x) => x.code === 'passes_ending_early');
    expect(f?.severity).toBe('warning');
    expect(f?.text).toContain('the scheduled sweep last ran');
    expect(f?.text).toContain('not passes dying');
  });

  it('keeps it CRITICAL when the cron is NOT proven alive — the real dying-pass signal', () => {
    const dead = { ...input, overview: { ...overview, stats: { ...overview.stats, lastRunAt: iso(9 * DAY) } } };
    const f = managerFindings(dead, now).find((x) => x.code === 'passes_ending_early');
    expect(f?.severity).toBe('critical');
    expect(f?.text).toContain('its scoring/assignment/dispatch work never happened');
  });

  it('names the tenant token block, because it silently freezes every cron sweep', () => {
    const blocked = codes({
      overview: { ...overview, autonomy: { tokenBlocked: true, reason: 'monthly_exhausted', effectivePlan: 'free' } },
    });
    expect(blocked).toContain('autonomy_token_blocked');
    expect(blocked[0]).toBe('autonomy_token_blocked');
  });

  it('flags a stale lastRunAt only when nothing else explains it', () => {
    const stale = { ...overview, stats: { ...overview.stats, lastRunAt: iso(4 * HOUR) } };
    expect(codes({ overview: stale })).toContain('last_run_stale');
    // Disabled or token-blocked already explains the silence — do not double-accuse.
    expect(codes({ overview: { ...stale, policy: { ...policy, enabled: false } } })).not.toContain('last_run_stale');
    expect(codes({
      overview: { ...stale, autonomy: { tokenBlocked: true, reason: 'daily_exhausted', effectivePlan: 'free' } },
    })).not.toContain('last_run_stale');
  });

  it('says so when the manager has never run at all', () => {
    const never = { ...overview, stats: { ...overview.stats, lastRunAt: null }, config: null };
    expect(codes({ overview: never })).toContain('never_run');
  });

  it('names the human handover and the livelock separately', () => {
    const found = codes();
    expect(found).toContain('escalations_pending'); // 1 escalated → a person must act
    expect(found).toContain('remedy_livelock');     // 1 row at the ceiling, not escalated
  });

  it('names merge and sign-off gates that hold finished work', () => {
    const found = codes();
    expect(found).toContain('merge_withheld');
    expect(found).toContain('signoff_gate');
    expect(found).toContain('coverage_flagged');
  });

  it('names a repeating decision as a loop', () => {
    const f = managerFindings(input, now).find((x) => x.code === 'decision_loop');
    expect(f?.text).toContain('5×');
    expect(f?.text).toContain('1-UNTITLED-100');
  });

  it('ranks critical findings above warnings and info', () => {
    const severities = managerFindings(input, now).map((f) => f.severity);
    expect(severities.indexOf('critical')).toBe(0);
    expect(severities.lastIndexOf('critical')).toBeLessThan(severities.indexOf('warning'));
    expect(severities.lastIndexOf('warning')).toBeLessThan(severities.indexOf('info'));
  });

  it('reports a healthy manager as no findings rather than inventing one', () => {
    const healthy = codes({
      overview: {
        ...overview,
        policy: { ...policy, autoSchedule: true, allowAutoMerge: true, requireSignoffToComplete: false },
        stats: { total: 12, unscored: 0, unranked: 0, undated: 0, unowned: 0, openPullRequests: 0, flagged: 0, lastRunAt: iso(3 * MIN) },
        runTasks: [runTasks[1]],
        actions: [actions[5]],
        directives: [],
      },
      stalls: { rows: [], escalated: 0, working: 0, byCause: [], maxAttempts: 3 },
    });
    // managerKind is still 'system' — that stays as an info note, not a fault.
    expect(healthy.filter((c) => c !== 'manager_unassigned')).toEqual([]);
  });
});

describe('passCountersFrom', () => {
  const pass = (summary: Record<string, unknown>, shedStages: string[] = []) => ({
    runTaskId: 1031, ok: true, changed: true, shedStages, summary, at: '2026-08-19T10:00:00Z',
  });

  it('projects the counters the server RECORDED, with prsConducted+prsMerged folded', () => {
    // Read from `manager_runs.summary` (migration 1082), not from the run card's prose.
    // The prose parse this replaced was a UI string used as a wire format: it degraded
    // silently on any rewording, and no query could answer "how many passes scored
    // anything this month?".
    expect(passCountersFrom(pass({
      scored: 3, ranked: 300, assigned: 2, prsConducted: 1, prsMerged: 0,
      dispatched: 0, audited: 40, flagged: 7,
    })))
      .toEqual({ scored: 3, ranked: 300, assigned: 2, prs: 1, dispatched: 0, audited: 40, flagged: 7 });
  });

  it('returns null for a missing pass, rather than a misleading zero', () => {
    // "The pass was not recorded" must stay distinguishable from "it did nothing".
    expect(passCountersFrom(null)).toBeNull();
    expect(passCountersFrom(undefined)).toBeNull();
  });

  it('reports zero counters as zero — the load-bearing "completed and changed nothing"', () => {
    expect(passCountersFrom(pass({ scored: 0, ranked: 0, assigned: 0 })))
      .toEqual({ scored: 0, ranked: 0, assigned: 0 });
  });

  it('reads the stages a TRUNCATED pass deferred from shedStages', () => {
    // The pass budget's whole point: a bounded pass that says so beats a silent one.
    const parsed = passCountersFrom(pass({ prsConducted: 20, prsMerged: 0 }, ['pr_merge', 'triage']));
    expect(parsed?.deferred).toEqual(['pr_merge', 'triage']);
    expect(parsed?.prs).toBe(20);
  });

  it('leaves `deferred` absent on a pass that reached every stage', () => {
    expect(passCountersFrom(pass({ scored: 3 }))?.deferred).toBeUndefined();
  });
});

/**
 * The truncated-pass fact crosses a real boundary — the server decides which stages it
 * shed and the client renders them — so it is asserted against the SHAPE the server
 * records (`manager_runs.shed_stages`, migration 1082) rather than a sentence. The prose
 * contract this replaced was the defect: a UI string doubling as a wire format.
 */
describe('the truncated-pass contract with the server', () => {
  const pass = (shedStages: string[]) => ({
    runTaskId: 1031, ok: true, changed: true, shedStages,
    summary: { scored: 3, ranked: 300, assigned: 1, prsConducted: 0, prsMerged: 0, dispatched: 2, audited: 40, flagged: 5 },
    at: '2026-08-19T10:00:00Z',
  });

  it('reads back the stages a budget-limited pass shed', () => {
    expect(passCountersFrom(pass(['pr_conduct', 'audit', 'triage']))?.deferred)
      .toEqual(['pr_conduct', 'audit', 'triage']);
  });

  it('reports NO deferral for a complete pass, so the two remain distinguishable', () => {
    expect(passCountersFrom(pass([]))?.deferred).toBeUndefined();
  });
});

/**
 * TODAY's THROUGHPUT — the block that measures MOVEMENT.
 *
 * Every other section of this report describes state, and state cannot distinguish a
 * large-but-healthy backlog from a stopped one. These tests hold the two properties that
 * make the block trustworthy: a zero is only ever reported against yesterday's number
 * (so "quiet" and "dead" stay distinguishable), and a FAILED fetch never becomes a zero
 * — inventing "nothing shipped" out of a network error would be the most alarming and
 * most unfounded line in the report.
 */
const digest = (over: Partial<ManagerDailyDigest['team']> & {
  decisionsToday?: number;
  passes?: number;
  escalations?: number;
} = {}): ManagerDailyDigest => ({
  projectId: 2,
  dayStart: '2026-07-25T00:00:00.000Z',
  dayEnd: '2026-07-26T00:00:00.000Z',
  manager: {
    passes: over.passes ?? 2,
    decisions: { today: over.decisionsToday ?? 12, yesterday: 40 },
    byType: [{ actionType: 'prioritize', count: 9 }, { actionType: 'assign', count: 3 }],
    lastRunAt: iso(22 * MIN),
  },
  team: {
    shipped: { today: 2, yesterday: 3 },
    opened: { today: 5, yesterday: 4 },
    laneMoves: { forward: 6, backward: 1, byHuman: 2, byAgent: 4, bySystem: 0 },
    runs: { completed: 7, failed: 1 },
    prs: { merged: { today: 1, yesterday: 2 }, opened: 3 },
    contributors: [{ id: 'cloud_agent:a1', kind: 'cloud_agent', name: 'Ada', shipped: 2, runs: 7, moves: 0 }],
    ...over,
  },
  shipped: [{
    id: 9, key: 'ENG-9', title: 'Fix the login redirect', completedAt: iso(2 * HOUR),
    ownerName: 'Ada', ownerKind: 'cloud_agent', businessValue: 71,
  }],
  needsAttention: { escalatedToday: 0, openEscalations: over.escalations ?? 0, items: [] },
  computedAt: CAPTURED_AT,
});

const QUIET_TEAM: Partial<ManagerDailyDigest['team']> = {
  shipped: { today: 0, yesterday: 0 },
  laneMoves: { forward: 0, backward: 0, byHuman: 0, byAgent: 0, bySystem: 0 },
  runs: { completed: 0, failed: 0 },
  prs: { merged: { today: 0, yesterday: 0 }, opened: 0 },
};

describe('today’s throughput in the diagnostics report', () => {
  it('prints movement ABOVE state — the backlog is unreadable until you know if it moves', () => {
    const r = buildManagerDiagnosticsReport({ ...input, digest: digest() }, ctx);
    expect(r.indexOf('-- Today (throughput')).toBeLessThan(r.indexOf('-- Backlog health'));
  });

  it('states every headline number against yesterday, so a zero is legible', () => {
    const r = buildManagerDiagnosticsReport({ ...input, digest: digest() }, ctx);
    expect(r).toContain('tickets finished: 2   [yesterday: 3]');
    expect(r).toContain('pull requests merged: 1   [yesterday: 2]');
    expect(r).toContain('decisions journalled: 12   [yesterday: 40]');
  });

  it('splits lane movement by human vs agent and names what finished', () => {
    const r = buildManagerDiagnosticsReport({ ...input, digest: digest() }, ctx);
    expect(r).toContain('by people: 2 · by agents: 4');
    expect(r).toContain('ENG-9');
    expect(r).toContain('owner=Ada');
  });

  it('never sums a contributor’s three counts into a score', () => {
    const r = buildManagerDiagnosticsReport({ ...input, digest: digest() }, ctx);
    expect(r).toContain('Ada (cloud_agent): finished=2 runs=7 moves=0');
  });

  it('says the digest was UNAVAILABLE rather than rendering it as a zero', () => {
    const r = buildManagerDiagnosticsReport(
      { ...input, digest: null, digestError: 'network error' }, ctx,
    );
    expect(r).toContain('unavailable: network error');
    expect(r).toContain('NOT the same as "nothing got done"');
    expect(codes({ digest: null, digestError: 'network error' })).toContain('digest_unavailable');
    // …and specifically NOT the catastrophic finding a zeroed digest would produce.
    expect(codes({ digest: null })).not.toContain('no_throughput_two_days');
  });
});

describe('managerFindings — throughput', () => {
  it('escalates to CRITICAL only when yesterday was empty too', () => {
    expect(codes({ digest: digest(QUIET_TEAM) })).toContain('no_throughput_two_days');
    // Same empty day, but yesterday produced — a stopped morning, not a stopped loop.
    const yesterdayWorked = digest({
      ...QUIET_TEAM,
      shipped: { today: 0, yesterday: 4 },
      prs: { merged: { today: 0, yesterday: 2 }, opened: 0 },
    });
    const c = codes({ digest: yesterdayWorked });
    expect(c).toContain('no_throughput_today');
    expect(c).not.toContain('no_throughput_two_days');
  });

  it('separates "work is moving but nothing lands" from "nothing is happening"', () => {
    const movingNotLanding = digest({
      shipped: { today: 0, yesterday: 4 },
      prs: { merged: { today: 0, yesterday: 2 }, opened: 3 },
    });
    const c = codes({ digest: movingNotLanding });
    expect(c).toContain('throughput_dropped');
    expect(c).not.toContain('no_throughput_today');
  });

  it('calls out a day where every run that finished FAILED', () => {
    expect(codes({ digest: digest({ runs: { completed: 0, failed: 4 } }) }))
      .toContain('all_runs_failed_today');
  });

  it('reports the manager’s OWN idleness separately from the team’s', () => {
    // The fixture backlog carries 300 unscored/undated/unowned tickets and managing is on.
    expect(codes({ digest: digest({ decisionsToday: 0 }) })).toContain('manager_idle_today');
    expect(codes({ digest: digest() })).not.toContain('manager_idle_today');
  });

  it('flags a board that only PEOPLE are moving — autonomy contributing nothing', () => {
    const humanOnly = digest({ laneMoves: { forward: 5, backward: 0, byHuman: 5, byAgent: 0, bySystem: 0 } });
    expect(codes({ digest: humanOnly })).toContain('movement_all_human');
    expect(codes({ digest: digest() })).not.toContain('movement_all_human');
  });

  it('lists what is waiting on a person right now', () => {
    expect(codes({ digest: digest({ escalations: 3 }) })).toContain('escalations_today');
  });
});
