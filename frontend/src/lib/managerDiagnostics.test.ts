import { describe, it, expect } from 'vitest';
import {
  buildManagerDiagnosticsReport,
  classifyPass,
  managerFindings,
  parseActionDetail,
  parsePassCounters,
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

const overview: ManagerOverview = {
  config: {
    managerRef: null, enabled: true, prMergePolicy: 'on_green',
    autoAssign: true, autoBusinessValue: true, autoPrioritize: true, autoSchedule: false,
    requireSignoffToComplete: true, allowAutoMerge: null,
    allowUnattendedCeremonies: null, allowAgentReassignment: null,
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
    const recent = { ...input, overview: { ...overview, runTasks: [freshPass(), ...runTasks] } };
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

describe('parsePassCounters', () => {
  it('parses the counters the server writes into a completed pass summary', () => {
    expect(parsePassCounters('Backlog management pass complete. Scored 3 · ranked 300 · assigned 2 · PRs 1 · dispatched 0 · audited 40 (7 flagged).'))
      .toEqual({ scored: 3, ranked: 300, assigned: 2, prs: 1, dispatched: 0, audited: 40, flagged: 7 });
  });

  it('returns null for prose it does not recognise, rather than a misleading zero', () => {
    // A parse miss must be distinguishable from a genuine "it did nothing".
    expect(parsePassCounters('The AI Manager is grooming this backlog…')).toBeNull();
    expect(parsePassCounters(null)).toBeNull();
  });

  it('reads the stages a TRUNCATED pass deferred', () => {
    // The pass budget's whole point: a bounded pass that says so beats a silent one. The
    // pass was evicted mid-PR-loop for two weeks and read exactly like a clean pass.
    const parsed = parsePassCounters(
      'Backlog management pass complete. Scored 3 · ranked 0 · assigned 2 · PRs 20 · dispatched 0 · audited 0 · deferred: pr_merge, triage.',
    );
    expect(parsed?.deferred).toEqual(['pr_merge', 'triage']);
    expect(parsed?.prs).toBe(20);
  });

  it('leaves `deferred` absent on a pass that reached every stage', () => {
    expect(parsePassCounters('Backlog management pass complete. Scored 3 · ranked 1 · assigned 0 · PRs 0 · dispatched 0 · audited 0.')?.deferred)
      .toBeUndefined();
  });
});

describe('classifyPass', () => {
  it('treats an open card past the reap threshold as a DEAD pass, not a slow one', () => {
    expect(classifyPass(runTasks[0], now)).toBe('died');
    expect(classifyPass({ ...runTasks[0], createdAt: iso(2 * MIN) }, now)).toBe('running');
  });

  it('falls back to "running" when the clock is unknown rather than accusing the pass', () => {
    expect(classifyPass(runTasks[0], null)).toBe('running');
  });
});

describe('repeatedActions', () => {
  it('groups by decision, counts it, and orders the loudest first', () => {
    const [top] = repeatedActions(actions);
    expect(top.count).toBe(5);
    expect(top.actionType).toBe('flag');
    expect(top.tickets).toEqual(['1-UNTITLED-100']);
  });

  it('labels first/last by TIMESTAMP, not by arrival order in a newest-first feed', () => {
    const [top] = repeatedActions(actions);
    expect(Date.parse(top.firstAt)).toBeLessThan(Date.parse(top.lastAt));
  });
});

/**
 * The block that answers the question this report previously could not: the manager
 * says a ticket is awaiting sign-off, the ticket shows nobody assigned, and BOTH are
 * true — a required participation slot is a ROLE, not the ticket's owner. Unless the
 * report says who owes each outstanding slot, the reader is left with a contradiction
 * and no way to tell "an agent was asked and has not answered" from "nobody has ever
 * been on this ticket", which need opposite responses.
 */
const heldAction = (over: Partial<ManagerAction> = {}): ManagerAction => ({
  id: 'h1', taskId: 280, ticketKey: '1-UNTITLED-280', ticketTitle: 'Link to each item',
  actionType: 'flag',
  summary: 'Held "Link to each item" in review — Waiting on 3 of 3 required sign-offs.',
  detail: JSON.stringify({
    action: 'drive_signoff', signoffGate: 'outstanding_signoffs',
    requiredCount: 3, satisfiedCount: 0,
    unstaffedCount: 1, humanOwedCount: 1, dispatchableCount: 1,
    dispatchedTo: [],
    outstanding: [
      { roleKey: 'architect', roleName: 'Architect', state: 'assigned', assigneeKind: null, assigneeName: null },
      { roleKey: 'product-owner', roleName: 'Product Owner', state: 'assigned', assigneeKind: 'human', assigneeName: 'Sean' },
      { roleKey: 'developer', roleName: 'Developer', state: 'in_progress', assigneeKind: 'agent', assigneeName: 'Dev Agent' },
    ],
  }),
  createdAt: iso(5 * MIN),
  ...over,
});

describe('summarizeSignoffs', () => {
  it('splits the outstanding slots by who owes them', () => {
    const r = summarizeSignoffs([heldAction(), heldAction({ id: 'h2', taskId: 281 })]);
    expect(r).toMatchObject({
      heldTickets: 2, askedTickets: 0, requiredTotal: 6, satisfiedTotal: 0,
      unstaffed: 2, humanOwed: 2, dispatchable: 2, hasOwnership: true,
    });
    expect(r.unassignedRoles).toEqual([{ role: 'Architect', count: 2 }]);
    expect(r.waitingOnPeople).toEqual([{ who: 'Product Owner → Sean', count: 2 }]);
  });

  it('counts a ticket as ASKED only when a role was actually dispatched', () => {
    const asked = heldAction({
      detail: JSON.stringify({
        signoffGate: 'outstanding_signoffs', requiredCount: 3, satisfiedCount: 0,
        dispatchedTo: ['Architect'],
      }),
    });
    expect(summarizeSignoffs([asked]).askedTickets).toBe(1);
  });

  it('reports ownership as UNKNOWN for rows written before the manager journalled it', () => {
    // The zeros must not be readable as "nothing is unstaffed" — that false-clean
    // reading is exactly what this report exists to prevent.
    const old = heldAction({ detail: '{"signoffGate":"outstanding_signoffs","requiredCount":10,"satisfiedCount":0}' });
    const r = summarizeSignoffs([old]);
    expect(r.hasOwnership).toBe(false);
    expect(r.heldTickets).toBe(1);
    expect(r.unstaffed).toBe(0);
  });

  it('survives malformed or absent detail without throwing', () => {
    expect(summarizeSignoffs([heldAction({ detail: 'not json' }), heldAction({ detail: null })]).heldTickets).toBe(0);
    expect(parseActionDetail('[1,2]')).toBeNull();
  });
});

describe('summarizePassLimits', () => {
  const triage = (over: Record<string, unknown> = {}): ManagerAction => ({
    id: 't1', taskId: null, ticketKey: null, ticketTitle: null, actionType: 'triage',
    summary: 'Unstuck 0 of 12 stalled tickets this pass',
    detail: JSON.stringify({ stalled: 12, unstuck: 0, deferred: 5, dispatchCap: 3, ownsDispatch: false, ...over }),
    createdAt: iso(MIN),
  });

  it('reads the caps and dispatch ownership the passes journalled', () => {
    const coord: ManagerAction = {
      id: 'c1', taskId: null, ticketKey: null, ticketTitle: null, actionType: 'coordinate',
      summary: 'Coordinated 10 flagged tickets this pass',
      detail: '{"remediated":10,"deferred":5,"cap":10}',
      createdAt: iso(2 * MIN),
    };
    expect(summarizePassLimits([triage(), coord])).toEqual({
      triageDispatchCap: 3, remediationCap: 10, ownsDispatch: false,
      stalledSeen: 12, unstuck: 0, deferred: 5, remediationDeferred: 5,
    });
  });

  it('keeps the MOST RECENT answer from a newest-first feed', () => {
    expect(summarizePassLimits([triage({ dispatchCap: 3 }), triage({ dispatchCap: 99 })]).triageDispatchCap).toBe(3);
  });

  it('leaves an unreported limit null rather than inventing a default', () => {
    expect(summarizePassLimits([])).toMatchObject({ triageDispatchCap: null, ownsDispatch: null });
  });
});

describe('managerFindings — sign-off ownership and untried remedies', () => {
  const held = (extra: ManagerAction[]) => ({ ...input, overview: { ...overview, actions: extra } });

  it('names unstaffed sign-off roles as the reason a ticket shows no assignee', () => {
    const f = managerFindings(held([heldAction(), heldAction({ id: 'h2' })]), now)
      .find((x) => x.code === 'signoff_roles_unstaffed');
    expect(f?.severity).toBe('critical');
    expect(f?.text).toContain('Architect ×2');
    expect(f?.text).toContain('assignee column is empty');
  });

  it('names the person a sign-off is waiting on', () => {
    const f = managerFindings(held([heldAction()]), now).find((x) => x.code === 'signoff_owed_by_human');
    expect(f?.text).toContain('Product Owner → Sean');
  });

  it('says nothing about sign-offs when the policy does not require them', () => {
    const found = codes({
      overview: {
        ...overview,
        policy: { ...policy, requireSignoffToComplete: false },
        actions: [heldAction(), heldAction({ id: 'h2' })],
      },
    });
    expect(found.filter((c) => c.startsWith('signoff_'))).toEqual([]);
  });

  it('flags a gate that holds tickets and asks nobody', () => {
    const found = codes({ overview: { ...overview, actions: [heldAction(), heldAction({ id: 'h2' })] } });
    expect(found).toContain('signoff_never_asked');
    expect(found).toContain('signoff_never_satisfied');
  });

  it('flags stuck rows whose remedy has never once been attempted', () => {
    /** A row the register has been re-observing for `watched` without ever acting. */
    const watched = (over: Partial<StallWatchRow>, watchedMs: number) =>
      stallRow({ firstSeenAt: iso(watchedMs + HOUR), lastSeenAt: iso(HOUR), lastAttemptAt: null, ...over });

    const f = managerFindings({
      ...input,
      stalls: {
        ...stalls,
        rows: [
          watched({ taskId: 1, attempts: 0, remedy: 'reset_breaker', idleMs: 25 * DAY }, 25 * DAY),
          watched({ taskId: 2, attempts: 0, remedy: 'drive_signoff', idleMs: 24 * DAY }, 24 * DAY),
          // Attempted once — the manager IS working this one.
          watched({ taskId: 3, attempts: 1, remedy: 'dispatch', idleMs: 24 * DAY }, 24 * DAY),
          // Watched only briefly: still plausibly queued behind a per-pass cap.
          watched({ taskId: 4, attempts: 0, remedy: 'dispatch', idleMs: 2 * HOUR }, 2 * HOUR),
          // Not a run-starting remedy, so attempts=0 means something else.
          watched({ taskId: 5, attempts: 0, remedy: 'reconcile_pr', idleMs: 25 * DAY }, 25 * DAY),
        ],
      },
    }, now).find((x) => x.code === 'remedy_never_attempted');
    expect(f?.severity).toBe('critical');
    expect(f?.text).toContain('2 stuck tickets');
    expect(f?.text).toContain('reset_breaker ×1');
    expect(f?.text).toContain('drive_signoff ×1');
  });

  /**
   * THE FALSE CRITICAL. Measured on project 11 at 2026-07-28T02:56: six rows reported as
   * "every pass has skipped them", all six discovered inside the previous five minutes
   * (`lastAttempt=—`, `firstSeen` minutes old) on tickets that had been idle 16 days
   * before anyone looked at them. The predicate compared the TICKET's idle age, which
   * cannot distinguish a skipped row from one the manager picked up this minute — the
   * exact confusion the finding's own comment warned about.
   */
  it('does NOT flag a row discovered this minute, however long the TICKET has been idle', () => {
    const justDiscovered = (taskId: number, remedy: StallWatchRow['remedy']) => stallRow({
      taskId, remedy, attempts: 0, escalatedAt: null,
      idleMs: 16 * DAY,               // the ticket has been stuck for 16 days …
      firstSeenAt: iso(4 * MIN),   // … but the register only found it 4 minutes ago,
      lastSeenAt: iso(4 * MIN),    //   and has seen it exactly once,
      lastAttemptAt: null,            //   so no pass has yet had a chance to act.
    });
    const found = managerFindings({
      ...input,
      stalls: {
        ...stalls,
        rows: [
          justDiscovered(1, 'resolve_conflict'), justDiscovered(2, 'resolve_conflict'),
          justDiscovered(3, 'resolve_conflict'), justDiscovered(4, 'reset_breaker'),
          justDiscovered(5, 'drive_signoff'), justDiscovered(6, 'drive_signoff'),
        ],
      },
    }, now).map((x) => x.code);
    expect(found).not.toContain('remedy_never_attempted');
  });

  it('reports the WATCHED span, not the ticket idle age, so the number backs the claim', () => {
    const f = managerFindings({
      ...input,
      stalls: {
        ...stalls,
        rows: [stallRow({
          taskId: 1, attempts: 0, remedy: 'reset_breaker', escalatedAt: null,
          idleMs: 90 * DAY,             // a very old ticket …
          firstSeenAt: iso(5 * DAY), lastSeenAt: iso(HOUR), lastAttemptAt: null, // … watched 5 days
        })],
      },
    }, now).find((x) => x.code === 'remedy_never_attempted');
    expect(f?.text).toContain('re-observing it for up to 4d');
    expect(f?.text).not.toContain('90d');
  });
});

describe('buildManagerDiagnosticsReport — the new sections', () => {
  const full = buildManagerDiagnosticsReport(
    { ...input, overview: { ...overview, actions: [heldAction(), ...actions] } },
    ctx,
  );

  it('reports the per-pass ceilings next to the policy that says what is allowed', () => {
    expect(full).toContain('-- Operating limits (as the passes themselves reported) --');
    expect(full.indexOf('-- Effective policy')).toBeLessThan(full.indexOf('-- Operating limits'));
  });

  it('spells out who owes each outstanding sign-off', () => {
    expect(full).toContain('-- Sign-off gate --');
    expect(full).toContain('NOBODY assigned');
    expect(full).toContain('Architect: 1');
    expect(full).toContain('Product Owner → Sean: 1');
  });

  it('still prints every effective policy field', () => {
    for (const key of [
      'enabled', 'autoBusinessValue', 'autoPrioritize', 'autoAssign', 'autoSchedule',
      'requireSignoffToComplete', 'allowAutoMerge', 'prMergePolicy',
      'allowUnattendedCeremonies', 'allowAgentReassignment',
      'agentReassignIdleHours', 'agentReassignMaxPerSession',
    ]) {
      expect(full, key).toContain(`${key}: `);
    }
    expect(full).toContain('managerType: general');
  });
});

describe('the stall census in the diagnostics report', () => {
  const census: StallCensusResponse = {
    projectId: 11, managed: 767, stalled: 755, moving: 12, deepDiagnosed: 44,
    computedAt: iso(MIN),
    cohorts: [
      { cause: 'unassigned', count: 313, sampleTaskIds: [7, 8, 9], maxIdleMs: 26 * DAY },
      { cause: 'awaiting_signoff', count: 149, sampleTaskIds: [21], maxIdleMs: 20 * DAY },
      { cause: 'failure_breaker', count: 116, sampleTaskIds: [33], maxIdleMs: 25 * DAY },
    ],
    findings: [],
  };
  const withCensus = { ...input, census };

  it('prints the census ABOVE the register, and says which one is the count', () => {
    const r = buildManagerDiagnosticsReport(withCensus, ctx);
    expect(r).toContain('-- Stall census (EVERY ticket) + platform findings --');
    expect(r.indexOf('-- Stall census')).toBeLessThan(r.indexOf('-- Stuck register'));
    // The register must be labelled as the sample it is, or a reader ranks causes from it.
    expect(r).toContain('-- Stuck register (the per-ticket sample deep triage has worked) --');
    expect(r).toContain('unassigned: 313');
  });

  it('states the coverage gap between what is stalled and what was diagnosed', () => {
    const codes = managerFindings(withCensus, now).map((f) => f.code);
    expect(codes).toContain('triage_coverage_gap');
  });

  it('names a concentrated cause as ONE defect rather than N ticket problems', () => {
    const f = managerFindings(withCensus, now).find((x) => x.code === 'stall_cause_concentrated');
    expect(f?.severity).toBe('critical');
    expect(f?.text).toMatch(/not N independent ticket problems/i);
  });

  it('flags a large cohort the manager has raised NO finding for', () => {
    const codes = managerFindings(withCensus, now).map((f) => f.code);
    expect(codes).toContain('systemic_never_raised');
  });

  it('reports an open finding and the ticket it filed', () => {
    const r = { ...withCensus, census: { ...census, findings: [{
      id: 'f1', cause: 'unassigned' as const, ticketCount: 313,
      summary: 'No lane on any board has staffing.',
      remediation: 'Staff each lane with a role-capable agent.',
      source: 'ai', createdTaskId: 900, createdTaskKey: 'BF-900',
      firstSeenAt: iso(HOUR), lastSeenAt: iso(MIN),
    }] } };
    const codes = managerFindings(r, now).map((f) => f.code);
    expect(codes).toContain('systemic_finding_open');
    expect(codes).not.toContain('systemic_never_raised');
    expect(buildManagerDiagnosticsReport(r, ctx)).toContain('BF-900');
  });

  it('flags a finding that could NOT be ticketed — it has no owner', () => {
    const r = { ...withCensus, census: { ...census, findings: [{
      id: 'f2', cause: 'unassigned' as const, ticketCount: 313,
      summary: 'x', remediation: 'Staff the lanes.', source: 'ai',
      createdTaskId: null, createdTaskKey: null,
      firstSeenAt: iso(HOUR), lastSeenAt: iso(MIN),
    }] } };
    expect(managerFindings(r, now).map((f) => f.code)).toContain('systemic_finding_unticketed');
  });

  it('says the census is MISSING rather than rendering a healthy zero', () => {
    const r = buildManagerDiagnosticsReport({ ...input, census: null, censusError: 'boom' }, ctx);
    expect(r).toContain('boom');
    expect(r).toContain('this is NOT the same as "nothing is stalled"');
    expect(managerFindings({ ...input, census: null }, now).map((f) => f.code))
      .toContain('census_unavailable');
  });
});

/**
 * THE REGRESSION DETECTOR for the platform's largest measured autonomy defect: on a
 * lifecycle-managed board every run must be role-attributed, and when no authorised role
 * resolves nothing can dispatch at all. That state used to be invisible — reported as a
 * generic staffing problem by a census that did not model the dispatcher's own gate.
 *
 * On a healthy managed board this finding's count is ZERO.
 */
describe('managed dispatch — the finding that must read zero', () => {
  const withCohorts = (cohorts: StallCensusResponse["cohorts"]): ManagerDiagnosticsInput => ({
    ...input,
    census: {
      projectId: 11, managed: 690, stalled: 675, moving: 15, deepDiagnosed: 12,
      computedAt: iso(MIN), cohorts, findings: [],
    },
  });

  it('raises a CRITICAL naming the cohort, the reason assigning owners will not help, and examples', () => {
    const f = managerFindings(withCohorts([
      { cause: 'managed_no_role', count: 300, sampleTaskIds: [1032, 1033], maxIdleMs: 20 * DAY },
      { cause: 'awaiting_signoff', count: 181, sampleTaskIds: [58], maxIdleMs: 47 * DAY },
    ]), now);

    const found = f.find((x) => x.code === 'managed_dispatch_refused');
    expect(found?.severity).toBe('critical');
    expect(found?.text).toContain('300 tickets');
    expect(found?.text).toContain('Assigning owners will NOT fix it');
    expect(found?.text).toContain('1032, 1033');
  });

  it('is ABSENT on a board with no managed-dispatch cohort — the post-fix steady state', () => {
    const f = managerFindings(withCohorts([{ cause: 'awaiting_signoff', count: 20, sampleTaskIds: [58], maxIdleMs: 2 * DAY }]), now);
    expect(f.some((x) => x.code === 'managed_dispatch_refused')).toBe(false);
  });

  /**
   * THE ANSWER MUST BE IN THE FINDING, NOT IN A POINTER TO THE APPENDIX.
   *
   * The board-staffing sweep is the only thing that knows WHY a managed lane authorises
   * nobody, and it says so in one `assign` decision. That decision lives in the decision
   * feed — the last prose section, behind the PR pile and the register. Measured on
   * project 11 (2026-07-31, api 2026.7.191): the report ran past 50,000 characters, the
   * feed was the part that got cut, and the finding at the top said "look for an 'assign'
   * decision" — instructing the reader to read a section that was no longer there.
   */
  const cohort = withCohorts([{ cause: 'managed_no_role', count: 306, sampleTaskIds: [526], maxIdleMs: 19 * DAY }]);
  const sweepAction = (detail: Record<string, unknown>, summary = 'Board staffing swept'): ManagerAction => ({
    id: 'staff-1', taskId: null, ticketKey: null, ticketTitle: null,
    actionType: 'assign', summary, detail: JSON.stringify(detail), createdAt: iso(2 * MIN),
  });
  const withSweep = (action: ManagerAction | null): ManagerDiagnosticsInput => ({
    ...cohort,
    overview: { ...overview, actions: action ? [action, ...actions] : actions },
  });
  const refusal = (over: ManagerDiagnosticsInput) =>
    managerFindings(over, now).find((x) => x.code === 'managed_dispatch_refused')?.text ?? '';

  it('NAMES the unauthorised lane, what it holds and why, inside the finding itself', () => {
    const text = refusal(withSweep(sweepAction({
      unfilledRoleKeys: [], filled: [], unfillable: [], hires: 0, error: null,
      unauthorizedLanes: [{ swimlaneId: 's1', laneKey: 'ready', reason: 'lane_unstaffed', ticketCount: 204, unmappedAgents: [] }],
    })));
    expect(text).toContain("'ready' holding 204");
    expect(text).toContain('no requirements and no staffed agents');
    // The pointer it replaced. A reader must never be sent to a section that may be cut.
    expect(text).not.toContain("look for an 'assign' decision");
  });

  /** "agents are staffed but none maps to a role" is unactionable without a name. */
  it('carries the agent that needs a job role through to the finding and the section', () => {
    const action = sweepAction({
      unfilledRoleKeys: [], filled: [], unfillable: [], hires: 0, error: null,
      unauthorizedLanes: [{
        swimlaneId: 's2', laneKey: 'todo', reason: 'lane_agents_not_role_capable', ticketCount: 8,
        unmappedAgents: ['Bob (declared "Bob Developer")'],
      }],
    });
    expect(refusal(withSweep(action))).toContain('Bob (declared "Bob Developer")');
    expect(buildManagerDiagnosticsReport(withSweep(action), ctx))
      .toContain('agents to give a job role: Bob (declared "Bob Developer")');
  });

  it('calls an EMPTY sweep beside a standing cohort a contradiction, not a clean board', () => {
    const text = refusal(withSweep(sweepAction({
      unfilledRoleKeys: [], filled: [], unfillable: [], hires: 0, error: null, unauthorizedLanes: [],
    })));
    expect(text).toContain('contradicts this cohort');
  });

  it('says the sweep journalled NOTHING when it did — the same contradiction, one step earlier', () => {
    expect(refusal(withSweep(null))).toContain('NO board-staffing decision');
  });

  it('reports a FAILED sweep as unexplained rather than unstaffable', () => {
    const text = refusal(withSweep(sweepAction({
      unfilledRoleKeys: [], filled: [], unfillable: [], hires: 0, unauthorizedLanes: [],
      error: 'role roster unavailable',
    })));
    expect(text).toContain('UNEXPLAINED');
    expect(text).toContain('role roster unavailable');
  });

  it('credits what the sweep DID fill, so a reader does not redo it by hand', () => {
    const text = refusal(withSweep(sweepAction({
      unfilledRoleKeys: ['product-owner'], unauthorizedLanes: [], error: null, hires: 1,
      filled: [{ roleKey: 'product-owner', action: 'hired', agentName: 'Ada' }],
      unfillable: ['security-reviewer'],
    })));
    expect(text).toContain('It DID fill product-owner (1 hired)');
    expect(text).toContain('could not fill security-reviewer');
  });

  it('puts the board-staffing block ABOVE the decision feed it was extracted from', () => {
    const r = buildManagerDiagnosticsReport(withSweep(sweepAction({
      unfilledRoleKeys: [], filled: [], unfillable: [], hires: 0, error: null,
      unauthorizedLanes: [{ swimlaneId: 's1', laneKey: 'ready', reason: 'shape_unmatched', ticketCount: 204, unmappedAgents: [] }],
    }, 'Staffed 0 roles; 1 stage authorises nobody')), ctx);
    expect(r.indexOf('-- Board staffing')).toBeLessThan(r.indexOf('-- Decision feed'));
    expect(r.indexOf('-- Board staffing')).toBeLessThan(r.indexOf('-- Stuck register'));
    expect(r).toContain('ready  holding=204  reason=shape_unmatched');
    // The sweep's own sentence, not a re-derivation of it in this module.
    expect(r).toContain("the sweep's own words: Staffed 0 roles; 1 stage authorises nobody");
  });

  it('says the sweep is silent rather than rendering an empty staffing block', () => {
    const r = buildManagerDiagnosticsReport(withSweep(null), ctx);
    expect(r).toContain('no board-staffing decision in the last');
  });

  it('reads the BOARD-scope sweep, never a per-ticket assign that happens to share the type', () => {
    const perTicket: ManagerAction = {
      id: 'a-ticket', taskId: 77, ticketKey: '1-UNTITLED-077', ticketTitle: 'A ticket',
      actionType: 'assign', summary: 'Assigned Ada', detail: '{"unfilledRoleKeys":["decoy"]}',
      createdAt: iso(MIN),
    };
    const board = sweepAction({ unfilledRoleKeys: ['product-owner'], unauthorizedLanes: [] });
    // Newest first, and the per-ticket row is the newest of the two.
    expect(summarizeBoardStaffing([perTicket, board])?.unfilledRoleKeys).toEqual(['product-owner']);
    expect(summarizeBoardStaffing([perTicket])).toBeNull();
    expect(summarizeBoardStaffing(actions)).toBeNull();
  });
});

/**
 * THE REGISTER'S DETAIL IS A PROPERTY OF THE CAUSE, NOT OF THE ROW.
 *
 * Triage writes one sentence per cause and stamps it on every ticket carrying it, so a
 * 60-row window spent ~18,000 characters restating a handful of sentences — and what got
 * cut to pay for it was the decision feed at the end of the report.
 */
describe('the stuck register — one wording per cause, not one per row', () => {
  // The prose only. The raw-payload appendix carries every row verbatim by design, so
  // counting across the whole report measures the appendix rather than the register.
  const prose = (r: string) => r.slice(0, r.indexOf('-- Raw payload (JSON) --'));
  const occurrences = (r: string, needle: string) => prose(r).split(needle).length - 1;
  const conflict = 'the pull request conflicts with its base branch — dispatching an agent to resolve it.';
  const many = Array.from({ length: 40 }, (_, i) => stallRow({
    taskId: i, cause: 'pr_conflict', remedy: 'resolve_conflict',
    detail: `Stuck ${16 + (i % 5)} days: ${conflict}`,
  }));
  const r = buildManagerDiagnosticsReport({
    ...input,
    stalls: { ...stalls, rows: many, byCause: [{ cause: 'pr_conflict', count: 40 }] },
  }, ctx);

  it('prints the shared wording ONCE, under its cause', () => {
    expect(occurrences(r, conflict)).toBe(1);
    expect(r).toContain(`  pr_conflict: 40\n      → ${conflict}`);
  });

  it('drops the per-row detail line entirely — the cause column indexes it', () => {
    expect(r).not.toContain('     detail: Stuck');
    expect(r).toContain('cause=pr_conflict  remedy=resolve_conflict');
  });

  /**
   * The age prefix comes in TWO shapes and only one carries a colon. Anchoring the strip
   * on the punctuation left `never_started` reporting three "distinct" wordings that
   * differed by nothing but the day count — measured on project 11, 2026-07-31.
   */
  it('strips the age prefix in BOTH of its shapes, colon or not', () => {
    const runnable = 'despite being runnable — nothing dispatched it, so the manager is starting it.';
    const aged = buildManagerDiagnosticsReport({
      ...input,
      stalls: {
        ...stalls,
        byCause: [{ cause: 'never_started', count: 3 }],
        rows: [16, 17, 18].map((days, i) => stallRow({
          taskId: i, cause: 'never_started', remedy: 'dispatch',
          detail: `Stuck ${days} days ${runnable}`,
        })),
      },
    }, ctx);
    expect(occurrences(aged, runnable)).toBe(1);
    expect(aged).toContain(`  never_started: 3\n      → ${runnable}`);
  });

  it('counts the distinct wordings it did not print rather than dropping them silently', () => {
    const varied = Array.from({ length: 12 }, (_, i) => stallRow({
      taskId: i, cause: 'never_started', remedy: 'dispatch', detail: `Stuck 3 days: wording ${i}`,
    }));
    const big = buildManagerDiagnosticsReport({
      ...input,
      stalls: { ...stalls, rows: varied, byCause: [{ cause: 'never_started', count: 12 }] },
    }, ctx);
    expect(big).toContain('→ wording 0');
    expect(big).toContain(`… ${12 - MAX_CAUSE_WORDINGS} further distinct wordings for this cause not shown`);
  });
});

/**
 * The server renders the pass summary as PROSE and this module parses it back. That is a
 * cross-boundary contract, so it is tested against the EXACT sentence the server writes
 * (`finalizeManagerRunTask`) rather than a hand-written approximation.
 */
describe('the truncated-pass contract with the server', () => {
  it('reads back the stages a budget-limited pass shed', () => {
    const serverLine = 'Backlog management pass complete. Scored 3 · ranked 300 · assigned 1 · '
      + 'PRs 0 · dispatched 2 · audited 40 (5 flagged) · deferred: pr_conduct, audit, triage.';
    expect(parsePassCounters(serverLine)?.deferred).toEqual(['pr_conduct', 'audit', 'triage']);
  });

  it('reports NO deferral for a complete pass, so the two remain distinguishable', () => {
    const serverLine = 'Backlog management pass complete. Scored 3 · ranked 300 · assigned 1 · PRs 0 · dispatched 2 · audited 40.';
    expect(parsePassCounters(serverLine)?.deferred).toBeUndefined();
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
