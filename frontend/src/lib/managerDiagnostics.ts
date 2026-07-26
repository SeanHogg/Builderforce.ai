/**
 * managerDiagnostics — turn the AI Manager surface into ONE pasteable report.
 *
 * The Stuck tab answers "what is not moving?". This answers the question a human asks
 * the moment the board rots: **why has the manager stopped working?** — which is not one
 * question but a dozen, spread across five places on the surface and two API payloads:
 *
 *   • is it even ON (the three-tier policy fold), and which TIER turned a capability off;
 *   • is autonomy paused for the whole tenant (out of tokens ⇒ cron sweeps skip silently);
 *   • is the scheduled sweep still reaching this project at all (`lastRunAt` staleness);
 *   • are the passes COMPLETING, or dying mid-flight and being reaped by the next one;
 *   • do the passes that DO complete actually change anything (a pass that reports
 *     "scored 0 · assigned 0 · dispatched 0" against a backlog with 300 unscored tickets
 *     is a successful no-op, and it looks identical to a healthy pass on the surface);
 *   • what is stuck, why, what the manager has already tried, and what it gave up on.
 *
 * A screenshot answers none of those: it loses the policy tiers, the pass counters, the
 * attempt counts and the timestamps that separate "the manager is on it" from "the
 * manager has been on it for a week". So this serialises all of it, ANSWER FIRST — the
 * findings block names the likely causes, ranked, before any raw row — and treats the
 * activity feed and the stall rows as the appendix they are: collapsed, windowed, and
 * always explicit about what was dropped.
 *
 * PURE — no clock, no fetch, no DOM, no i18n (see {@link ./diagnosticsReport} for why the
 * body is deliberately locale-independent English while the button around it is not).
 */
import type {
  ManagerAction,
  ManagerConfig,
  ManagerOverview,
  ManagerPolicy,
  ManagerRunTask,
  StallCensusResponse,
  StallRegister,
  StallWatchRow,
} from './builderforceApi';
import {
  capText,
  collapseRuns,
  environmentLines,
  jsonAppendix,
  line,
  windowRows,
  REPORT_BUDGET_CHARS,
  type DiagnosticsContext,
} from './diagnosticsReport';
import { formatAge } from './duration';

/** How often the scheduled manager sweep is expected to run (api cron cadence). */
export const MANAGER_CRON_PERIOD_MS = 5 * 60_000;

/**
 * How stale `lastRunAt` may get before the SCHEDULED sweep is presumed broken for this
 * project. Six cron periods: long enough to absorb a skipped tick or a slow pass, short
 * enough that "the cron is not reaching this project" is caught the same hour.
 */
export const STALE_LAST_RUN_MS = 6 * MANAGER_CRON_PERIOD_MS;

/**
 * Mirrors the api's `STALE_RUN_TASK_MS`. A pass runs inside a Worker invocation and
 * cannot legitimately take anywhere near this long, so an open run task older than this
 * did not "take a while" — it DIED between minting its card and the finally block that
 * closes it. Kept identical to the server constant so the report and the reaper agree on
 * what "still running" means.
 */
export const STALE_RUN_TASK_MS = 30 * 60_000;

/** A decision repeated this many times is a retry loop, not a series of decisions. */
export const REPEAT_FINDING_THRESHOLD = 3;

// Row windows. The activity feed and the stall register are both unbounded in practice
// (one measured tenant carried 809 stalled tickets), so both are windowed head + tail.
export const ACTION_WINDOW_HEAD = 15;
export const ACTION_WINDOW_TAIL = 35;
export const STALL_WINDOW_HEAD = 20;
export const STALL_WINDOW_TAIL = 40;

/** Everything the report needs, already gathered by the surface (pure in). */
export interface ManagerDiagnosticsInput {
  projectId: number;
  overview: ManagerOverview;
  /** The stuck register. `null` when it could not be loaded — STATED, never rendered as
   *  an empty register, which would read as "nothing is stuck". */
  stalls: StallRegister | null;
  /** The error the register load failed with, when it did. */
  stallsError?: string | null;
  /**
   * The FULL-COVERAGE stall census and the systemic findings raised from it (0373).
   *
   * The single most important thing this report gained, because the register above is
   * bounded by what deep triage has diagnosed and this is not. Without it the report
   * carried the same 5.8%-coverage sample that made eight rounds of remediation aim at
   * the wrong cohort — and, worse, presented it with no indication it was a sample.
   * `null` when it could not be loaded: STATED, never rendered as a healthy zero.
   */
  census?: StallCensusResponse | null;
  /** The error the census load failed with, when it did. */
  censusError?: string | null;
}

export type FindingSeverity = 'critical' | 'warning' | 'info';

/** One named cause, ready to read. `code` is stable and greppable; `text` is the sentence. */
export interface ManagerFinding {
  severity: FindingSeverity;
  code: string;
  text: string;
}

/**
 * The counters a completed pass reports, parsed back out of its summary line.
 *
 * The server writes the summary as prose (`finalizeManagerRunTask`), so this is a
 * TOLERANT parse, not a contract: it scans for `<name> <number>` pairs in any order and
 * returns null when it recognises nothing. That degradation is safe — the raw summary is
 * printed verbatim next to the parse in every case, so a parse miss costs a derived
 * finding, never a fact.
 */
export interface PassCounters {
  scored?: number;
  ranked?: number;
  assigned?: number;
  prs?: number;
  dispatched?: number;
  audited?: number;
  flagged?: number;
  /**
   * Stages the pass SHED because it ran out of its wall-clock budget, e.g.
   * `['pr_merge', 'triage']`. Present only on a truncated pass.
   *
   * A bounded pass used to be indistinguishable from a complete one — the pass was being
   * evicted mid-PR-loop and never wrote its closing row at all, so for two weeks the
   * surface reported health nobody had verified. The server now names what it deferred
   * on the run card; this reads it back.
   */
  deferred?: string[];
}

const COUNTER_NAMES = ['scored', 'ranked', 'assigned', 'prs', 'dispatched', 'audited'] as const;

export function parsePassCounters(summary: string | null | undefined): PassCounters | null {
  if (!summary) return null;
  const out: PassCounters = {};
  let matched = false;
  for (const name of COUNTER_NAMES) {
    const m = new RegExp(`\\b${name}\\s+(\\d+)`, 'i').exec(summary);
    if (!m) continue;
    out[name] = Number(m[1]);
    matched = true;
  }
  const flagged = /\((\d+)\s+flagged\)/i.exec(summary);
  if (flagged) { out.flagged = Number(flagged[1]); matched = true; }
  const deferred = /·\s*deferred:\s*([^.·]+)/i.exec(summary);
  if (deferred?.[1]) {
    const stages = deferred[1].split(',').map((s) => s.trim()).filter(Boolean);
    if (stages.length) { out.deferred = stages; matched = true; }
  }
  return matched ? out : null;
}

/** What actually happened to one "Backlog management pass" card. */
export type PassOutcome = 'running' | 'died' | 'completed' | 'ended_early';

/**
 * Classify a pass card. `died` is the load-bearing one: an open card older than the
 * server's own reap threshold is a pass whose Worker was evicted, and until something
 * reaps it the Manager surface shows a pass "In progress" that has not existed for days.
 */
export function classifyPass(task: ManagerRunTask, nowMs: number | null): PassOutcome {
  if (task.status === 'done') return 'completed';
  if (task.status === 'blocked') return 'ended_early';
  const age = ageMs(task.createdAt, nowMs);
  return age != null && age > STALE_RUN_TASK_MS ? 'died' : 'running';
}

// ── small local formatters ──────────────────────────────────────────────────

/** Elapsed ms since an ISO stamp, or null when either end is unknown/unparseable. */
function ageMs(iso: string | null | undefined, nowMs: number | null): number | null {
  if (!iso || nowMs == null) return null;
  const then = Date.parse(iso);
  return Number.isFinite(then) ? nowMs - then : null;
}

/** "2026-07-25T09:00:00.000Z (7d 04h ago)" — the stamp AND the distance from now. */
function stampWithAge(iso: string | null | undefined, nowMs: number | null): string {
  if (!iso) return '(never)';
  const age = ageMs(iso, nowMs);
  return age == null ? iso : `${iso} (${formatAge(age)} ago)`;
}

/** "300 of 300 (100%)" — a bare count hides whether it is the whole backlog. */
function share(part: number, whole: number): string {
  if (whole <= 0) return `${part}`;
  return `${part} of ${whole} (${Math.round((part / whole) * 100)}%)`;
}

/** Tri-state project-tier value: `null` means "inherit the workspace answer", NOT "no". */
function tri(value: unknown): string {
  if (value === null || value === undefined) return 'inherit';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

// ── findings ────────────────────────────────────────────────────────────────

/**
 * The four autonomy capabilities, each paired with the backlog deficit it is supposed to
 * clear and the counter a pass reports for it.
 *
 * ONE table drives both findings a capability can produce — "it is switched off" and "it
 * is switched on and doing nothing" — so a fifth capability cannot be added to the policy
 * and silently skipped here.
 */
const CAPABILITIES: ReadonlyArray<{
  key: 'autoBusinessValue' | 'autoPrioritize' | 'autoAssign' | 'autoSchedule';
  label: string;
  /** Which stat counts the work this capability exists to clear. */
  deficit: 'unscored' | 'unranked' | 'unowned' | 'undated';
  deficitLabel: string;
  /** The pass counter for it, or null when the summary line does not report one. */
  counter: keyof PassCounters | null;
}> = [
  { key: 'autoBusinessValue', label: 'business-value scoring', deficit: 'unscored', deficitLabel: 'unscored', counter: 'scored' },
  { key: 'autoPrioritize', label: 'ranking', deficit: 'unranked', deficitLabel: 'unranked', counter: 'ranked' },
  { key: 'autoAssign', label: 'auto-assignment', deficit: 'unowned', deficitLabel: 'unowned', counter: 'assigned' },
  { key: 'autoSchedule', label: 'auto-scheduling', deficit: 'undated', deficitLabel: 'undated', counter: null },
];

/**
 * Remedies whose whole effect is to START a run. Mirrors the api's
 * `DISPATCHING_REMEDIES` — a stuck row carrying one of these at attempts=0 has never
 * actually had anything tried on it, which reads identically to "the manager is on it"
 * unless the report says otherwise.
 */
const RUN_STARTING_REMEDIES: ReadonlySet<string> = new Set([
  'dispatch', 'reset_breaker', 'drive_signoff', 'resolve_conflict',
]);

/**
 * How long a register row may sit at attempts=0 before "the manager is still trying" is
 * not a credible reading of it. Three days is well past the 24h stall threshold AND past
 * any plausible per-pass cap backlog, so anything older has been passed over, not queued.
 */
export const NEVER_ATTEMPTED_AFTER_MS = 3 * 86_400_000;

/**
 * What share of the stalled set ONE cause must hold before the report calls it a
 * concentrated defect rather than a distribution.
 *
 * A quarter, deliberately NOT a majority. The measured case is 313 of 755 tickets (41%)
 * sharing `unassigned` — plainly one defect, and a 50% bar would have stayed silent on
 * exactly the finding this block exists to surface. The bar that matters is not "most of
 * the stalls" but "far more than per-ticket remediation can ever work through", and at a
 * quarter of a stalled backlog that is already true by orders of magnitude.
 */
export const CONCENTRATED_COHORT_SHARE = 0.25;

/** Tolerant parse of an action's `detail` JSON blob — never throws, never guesses. */
export function parseActionDetail(detail: string | null | undefined): Record<string, unknown> | null {
  if (!detail) return null;
  try {
    const parsed: unknown = JSON.parse(detail);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** One outstanding required sign-off slot, as journalled by the manager. */
interface OutstandingSlotRow {
  roleName: string;
  state: string;
  assigneeKind: string | null;
  assigneeName: string | null;
}

/**
 * What the sign-off gate is actually waiting on, across the decisions in this window.
 *
 * This is the block whose absence made the report unable to answer the question an
 * operator asks first: the feed says "waiting on 10 of 10 required sign-offs" while the
 * ticket shows no assignee, and BOTH are true — a required participation slot is not the
 * ticket's owner. Until the report separated agent-owed slots from human-owed and
 * unstaffed ones, there was no way to tell "an agent was asked and has not answered"
 * from "nobody has ever been on this ticket".
 */
export interface SignoffRollup {
  /** Decisions in this window where the gate held a ticket. */
  heldTickets: number;
  /** Of those, how many actually dispatched a role to sign off. */
  askedTickets: number;
  requiredTotal: number;
  satisfiedTotal: number;
  /** Outstanding slots by who owes them. Counted only from rows that report ownership. */
  unstaffed: number;
  humanOwed: number;
  dispatchable: number;
  /** Roles seen outstanding with no assignee at all, most frequent first. */
  unassignedRoles: Array<{ role: string; count: number }>;
  /** People a sign-off is waiting on, most frequent first. */
  waitingOnPeople: Array<{ who: string; count: number }>;
  /**
   * False when EVERY row predates the manager reporting slot ownership. The counts
   * above are then structurally zero and must not be read as "nothing is unstaffed".
   */
  hasOwnership: boolean;
}

export function summarizeSignoffs(actions: readonly ManagerAction[]): SignoffRollup {
  const roles = new Map<string, number>();
  const people = new Map<string, number>();
  const out: SignoffRollup = {
    heldTickets: 0, askedTickets: 0, requiredTotal: 0, satisfiedTotal: 0,
    unstaffed: 0, humanOwed: 0, dispatchable: 0,
    unassignedRoles: [], waitingOnPeople: [], hasOwnership: false,
  };
  for (const a of actions) {
    const d = parseActionDetail(a.detail);
    if (!d || typeof d.signoffGate !== 'string') continue;
    out.heldTickets += 1;
    out.requiredTotal += num(d.requiredCount) ?? 0;
    out.satisfiedTotal += num(d.satisfiedCount) ?? 0;
    if (Array.isArray(d.dispatchedTo) && d.dispatchedTo.length > 0) out.askedTickets += 1;

    // Per-ticket ownership counters (newer rows). Absent on rows written before the
    // manager journalled them — tracked so the report can say which it is.
    const unstaffed = num(d.unstaffedCount);
    const humanOwed = num(d.humanOwedCount);
    const dispatchable = num(d.dispatchableCount);
    if (unstaffed != null || humanOwed != null || dispatchable != null) {
      out.hasOwnership = true;
      out.unstaffed += unstaffed ?? 0;
      out.humanOwed += humanOwed ?? 0;
      out.dispatchable += dispatchable ?? 0;
    }

    if (!Array.isArray(d.outstanding)) continue;
    for (const raw of d.outstanding as unknown[]) {
      if (!raw || typeof raw !== 'object') continue;
      const slot = raw as Partial<OutstandingSlotRow>;
      const role = typeof slot.roleName === 'string' ? slot.roleName : null;
      if (!role) continue;
      // `assigneeKind` present at all means this row carries ownership per slot.
      if ('assigneeKind' in slot) {
        out.hasOwnership = true;
        if (!slot.assigneeKind) roles.set(role, (roles.get(role) ?? 0) + 1);
        else if (slot.assigneeKind !== 'agent') {
          const who = `${role} → ${slot.assigneeName ?? 'unnamed'}`;
          people.set(who, (people.get(who) ?? 0) + 1);
        }
      }
    }
  }
  const rank = <T extends string>(m: Map<T, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  out.unassignedRoles = rank(roles).map(([role, count]) => ({ role, count }));
  out.waitingOnPeople = rank(people).map(([who, count]) => ({ who, count }));
  return out;
}

/**
 * The per-pass ceilings the manager reported for itself, and whether the pass owned
 * dispatch. These are as load-bearing as the policy toggles — a capability that is ON in
 * policy still does nothing to ticket #400 if the pass stops at 10 — and none of them
 * were anywhere in this report, so "enabled: yes" read as "it will get to everything".
 *
 * Read from what the passes JOURNALLED rather than hardcoded here, so the report can
 * never claim a limit the running server does not actually use.
 */
export interface PassLimits {
  triageDispatchCap: number | null;
  remediationCap: number | null;
  /** False when the autonomous executor, not the manager, is the single dispatcher. */
  ownsDispatch: boolean | null;
  stalledSeen: number | null;
  unstuck: number | null;
  deferred: number | null;
  remediationDeferred: number | null;
}

export function summarizePassLimits(actions: readonly ManagerAction[]): PassLimits {
  const out: PassLimits = {
    triageDispatchCap: null, remediationCap: null, ownsDispatch: null,
    stalledSeen: null, unstuck: null, deferred: null, remediationDeferred: null,
  };
  // Newest-first feed: the first row carrying each field is the most recent answer.
  for (const a of actions) {
    const d = parseActionDetail(a.detail);
    if (!d) continue;
    if (a.actionType === 'triage') {
      out.triageDispatchCap ??= num(d.dispatchCap);
      out.stalledSeen ??= num(d.stalled);
      out.unstuck ??= num(d.unstuck);
      out.deferred ??= num(d.deferred);
      if (out.ownsDispatch == null && typeof d.ownsDispatch === 'boolean') out.ownsDispatch = d.ownsDispatch;
    }
    if (a.actionType === 'coordinate' && d.cap != null) {
      out.remediationCap ??= num(d.cap);
      out.remediationDeferred ??= num(d.deferred);
    }
  }
  return out;
}

/** Group the activity feed by (type, summary) — the shape a retry loop makes. */
interface RepeatedAction {
  actionType: string;
  summary: string;
  count: number;
  firstAt: string;
  lastAt: string;
  tickets: string[];
}

export function repeatedActions(actions: readonly ManagerAction[]): RepeatedAction[] {
  const byKey = new Map<string, RepeatedAction>();
  // The feed arrives newest-first, so first/last are assigned by comparison rather than
  // by arrival order — a report that mislabels which end is recent is worse than none.
  for (const a of actions) {
    const key = `${a.actionType}|${a.summary}`;
    const found = byKey.get(key);
    const ticket = a.ticketKey ?? (a.taskId != null ? `#${a.taskId}` : null);
    if (!found) {
      byKey.set(key, {
        actionType: a.actionType,
        summary: a.summary,
        count: 1,
        firstAt: a.createdAt,
        lastAt: a.createdAt,
        tickets: ticket ? [ticket] : [],
      });
      continue;
    }
    found.count += 1;
    if (a.createdAt < found.firstAt) found.firstAt = a.createdAt;
    if (a.createdAt > found.lastAt) found.lastAt = a.createdAt;
    if (ticket && !found.tickets.includes(ticket)) found.tickets.push(ticket);
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count);
}

/**
 * Name the likely causes, ranked, instead of leaving the reader to correlate a policy
 * table against a stats tile against a run-task list.
 *
 * Ordered most-actionable first within severity. Every finding is derived ONLY from data
 * on the wire — nothing here guesses.
 */
export function managerFindings(input: ManagerDiagnosticsInput, nowMs: number | null): ManagerFinding[] {
  const { overview, stalls } = input;
  const { policy, config, tenantPolicy, stats, autonomy, runTasks, actions, directives } = overview;
  const critical: ManagerFinding[] = [];
  const warning: ManagerFinding[] = [];
  const info: ManagerFinding[] = [];

  // ── 1. Is it on at all, and is the machinery that runs it allowed to run? ──
  if (!policy.enabled) {
    critical.push({
      severity: 'critical',
      code: 'manager_disabled',
      text: `Managing is DISABLED for this project (effective policy). Nothing runs — cron passes skip it and "Run manager now" returns started=false. Project tier says ${tri(config?.enabled)}, workspace tier says ${tri(tenantPolicy.enabled)}.`,
    });
  }
  if (autonomy.tokenBlocked) {
    critical.push({
      severity: 'critical',
      code: 'autonomy_token_blocked',
      text: `Autonomy is PAUSED for this tenant: token budget ${autonomy.reason ?? 'exhausted'} on the ${autonomy.effectivePlan ?? 'unknown'} plan. The cron manager sweep AND the autonomous executor both skip a capped tenant, so ranking, assignment, dispatch and Evermind learning all freeze. Only a manual "Run manager now" (which does not token-gate) still works.`,
    });
  }

  // ── 2. Is the scheduled sweep still reaching this project? ──
  const lastRunAge = ageMs(stats.lastRunAt, nowMs);
  if (!stats.lastRunAt) {
    critical.push({
      severity: 'critical',
      code: 'never_run',
      text: 'The manager has NEVER completed a pass for this project (lastRunAt is null), so nothing in the backlog has ever been scored, ranked or assigned by it.',
    });
  } else if (lastRunAge != null && lastRunAge > STALE_LAST_RUN_MS && policy.enabled && !autonomy.tokenBlocked) {
    critical.push({
      severity: 'critical',
      code: 'last_run_stale',
      text: `The last completed pass was ${formatAge(lastRunAge)} ago, but the scheduled sweep is expected roughly every ${formatAge(MANAGER_CRON_PERIOD_MS)} and nothing is blocking it (managing is enabled, tokens are available). Either the cron is not reaching this project or every pass is dying before it stamps lastRunAt — see the pass table below.`,
    });
  }

  // ── 3. Are the passes themselves completing? ──
  const passes = runTasks.map((t) => ({ task: t, outcome: classifyPass(t, nowMs) }));
  const died = passes.filter((p) => p.outcome === 'died');
  const endedEarly = passes.filter((p) => p.outcome === 'ended_early');
  if (died.length > 0) {
    const oldest = died[died.length - 1];
    const age = ageMs(oldest.task.createdAt, nowMs);
    critical.push({
      severity: 'critical',
      code: 'pass_never_completed',
      text: `${died.length} management pass card${died.length === 1 ? ' is' : 's are'} still "in progress" past the ${formatAge(STALE_RUN_TASK_MS)} reap threshold — the oldest (${oldest.task.key}) has been open ${age == null ? 'an unknown time' : formatAge(age)}. A pass cannot legitimately run that long: the Worker was evicted mid-pass and never ran the block that closes the card, so the work of that pass was NOT finished.`,
    });
  }
  // A pass that COMPLETED but shed stages. Distinct from `died`/`ended_early`: this pass
  // finished honestly and said what it could not reach, which is the outcome the pass
  // budget was added to produce. Worth a warning, never a critical — the deferred work is
  // picked up on the next 5-minute pass.
  const truncated = passes.filter((p) => (parsePassCounters(p.task.summary)?.deferred?.length ?? 0) > 0);
  if (truncated.length > 0) {
    const stages = [...new Set(truncated.flatMap((p) => parsePassCounters(p.task.summary)?.deferred ?? []))];
    warning.push({
      severity: 'warning',
      code: 'passes_truncated',
      text: `${truncated.length} of the last ${passes.length} passes ran out of their wall-clock budget and deferred ${stages.join(', ')} to the next pass. The pass still completed and journalled honestly, but a project whose PR coordination consistently consumes the whole budget is starving the stages behind it — bound the PR work (or split the pass) rather than letting the backlog behind it go ungroomed.`,
    });
  }
  if (endedEarly.length > 0) {
    const ratio = passes.length > 0 ? Math.round((endedEarly.length / passes.length) * 100) : 0;
    // Half the recent passes dying is not a flaky run, it is the normal path.
    const severe = endedEarly.length >= passes.length / 2;
    (severe ? critical : warning).push({
      severity: severe ? 'critical' : 'warning',
      code: 'passes_ending_early',
      text: `${endedEarly.length} of the last ${passes.length} passes (${ratio}%) ended early or were closed by a newer pass without reporting completion. A pass that is reaped did not finish its backlog, so its scoring/assignment/dispatch work never happened — repeatedly, this alone is enough to leave the backlog ungroomed.`,
    });
  }

  // ── 4. Do the passes that DO complete change anything? ──
  const lastCompleted = passes.find((p) => p.outcome === 'completed')?.task ?? null;
  const counters = parsePassCounters(lastCompleted?.summary);
  for (const cap of CAPABILITIES) {
    const deficit = stats[cap.deficit];
    if (deficit <= 0) continue;
    if (!policy[cap.key]) {
      warning.push({
        severity: 'warning',
        code: `policy_off_${cap.key}`,
        text: `${share(deficit, stats.total)} open tickets are ${cap.deficitLabel} and ${cap.label} is OFF in the effective policy (project tier: ${tri(config?.[cap.key])} · workspace tier: ${tri(tenantPolicy[cap.key])}). The manager will never clear these — this is configuration, not a fault.`,
      });
      continue;
    }
    const reported = cap.counter ? counters?.[cap.counter] : undefined;
    if (reported === 0 && lastCompleted) {
      critical.push({
        severity: 'critical',
        code: `ineffective_${cap.key}`,
        text: `${cap.label} is ENABLED, but the last COMPLETED pass (${lastCompleted.key}, ${stampWithAge(lastCompleted.completedAt ?? lastCompleted.createdAt, nowMs)}) reported ${cap.counter} 0 while ${share(deficit, stats.total)} open tickets are still ${cap.deficitLabel}. The pass is finishing and reporting success without changing the backlog.`,
      });
    }
  }

  // ── 5. What the manager has given up on / cannot get past ──
  if (stalls == null) {
    warning.push({
      severity: 'warning',
      code: 'stall_register_unavailable',
      text: `The stuck-ticket register could not be loaded${input.stallsError ? ` (${input.stallsError})` : ''}, so this report cannot say what is stalled or what the manager has tried.`,
    });
  } else {
    const stuck = stalls.rows.length;
    if (stats.total > 0 && stuck >= stats.total / 2) {
      critical.push({
        severity: 'critical',
        code: 'stall_saturation',
        text: `${share(stuck, stats.total)} open tickets are on the stuck register. At that share the backlog is not "some tickets blocked" — the delivery loop itself is not turning. Top causes: ${stalls.byCause.slice(0, 3).map((c) => `${c.cause} ×${c.count}`).join(', ') || '(none recorded)'}.`,
      });
    }
    if (stalls.escalated > 0) {
      critical.push({
        severity: 'critical',
        code: 'escalations_pending',
        text: `${stalls.escalated} ticket${stalls.escalated === 1 ? ' has' : 's have'} been handed back to a HUMAN — the manager tried its own remedy ${stalls.maxAttempts} times without the ticket moving and stopped retrying. Nothing further happens on these until a person acts.`,
      });
    }
    const livelocked = stalls.rows.filter((r) => !r.escalatedAt && r.attempts >= stalls.maxAttempts);
    if (livelocked.length > 0) {
      warning.push({
        severity: 'warning',
        code: 'remedy_livelock',
        text: `${livelocked.length} ticket${livelocked.length === 1 ? ' is' : 's are'} at or past the ${stalls.maxAttempts}-attempt ceiling without being escalated — the same remedy is being re-applied to a ticket it has already failed to move.`,
      });
    }
    // The OPPOSITE failure, and the harder one to see: a row nothing has ever been
    // tried on. `attempts` only advances when a remedy actually ran, so a remedy the
    // pass keeps skipping leaves the row at 0 forever — it never reaches the
    // escalation ceiling either, so it is neither worked nor handed to a human. On the
    // surface it is indistinguishable from a ticket the manager picked up this minute.
    const neverAttempted = stalls.rows.filter(
      (r) => r.attempts === 0 && !r.escalatedAt
        && RUN_STARTING_REMEDIES.has(r.remedy) && r.idleMs > NEVER_ATTEMPTED_AFTER_MS,
    );
    if (neverAttempted.length > 0) {
      const byRemedy = new Map<string, number>();
      for (const r of neverAttempted) byRemedy.set(r.remedy, (byRemedy.get(r.remedy) ?? 0) + 1);
      const oldest = neverAttempted.reduce((a, b) => (b.idleMs > a.idleMs ? b : a));
      critical.push({
        severity: 'critical',
        code: 'remedy_never_attempted',
        text: `${neverAttempted.length} stuck ticket${neverAttempted.length === 1 ? ' has' : 's have'} a remedy that has NEVER been attempted (attempts=0), the longest idle ${formatAge(oldest.idleMs)} — ${[...byRemedy.entries()].map(([k, n]) => `${k} ×${n}`).join(', ')}. Each of these remedies has to start a run, and every pass has skipped them: because an attempt that never happened cannot fail, the ${stalls.maxAttempts}-attempt escalation ceiling is never reached either, so nothing is worked AND nothing is handed to a human.`,
      });
    }
  }

  // ── 5b. Does the manager actually SEE its whole problem? ──
  //
  // These are the findings that judge the manager's own execution rather than the
  // backlog's health. The failure they exist to catch is the one that hid for weeks: a
  // register that looked complete, ranked the wrong cause first, and had no field
  // anywhere saying how much of the problem it had actually looked at.
  // `undefined` means the caller never asked for a census; `null` means it asked and the
  // read failed. Only the second is a finding — reporting the first would fire on every
  // caller that predates the census and drown the real signal in false warnings.
  const census = input.census ?? null;
  if (census == null && input.census === null) {
    warning.push({
      severity: 'warning',
      code: 'census_unavailable',
      text: `The full-coverage stall census could not be loaded${input.censusError ? ` (${input.censusError})` : ''}. Everything said about stall causes below therefore comes from the stuck register ALONE, which is bounded by what deep triage has diagnosed — treat its cause ranking as a sample, not a count.`,
    });
  } else if (census != null) {
    // Coverage: the register is a sample of the census, and the report must say by how
    // much before anyone reasons about the cause ranking.
    if (census.stalled > 0 && census.deepDiagnosed < census.stalled) {
      const pct = Math.round((census.deepDiagnosed / census.stalled) * 100);
      const severe = pct < 25;
      (severe ? critical : warning).push({
        severity: severe ? 'critical' : 'warning',
        code: 'triage_coverage_gap',
        text: `${census.stalled} tickets are stalled but only ${census.deepDiagnosed} (${pct}%) have been diagnosed in depth — the stuck register below is a SAMPLE of that size. Deep triage is capped per project per pass, so at this ratio the register's cause ranking can disagree with reality: rank causes from the census block, not from the register.`,
      });
    }
    // The concentration finding — the one that reframes remediation entirely.
    const top = census.cohorts[0];
    if (top && census.stalled > 0 && top.count >= census.stalled * CONCENTRATED_COHORT_SHARE) {
      critical.push({
        severity: 'critical',
        code: 'stall_cause_concentrated',
        text: `${top.count} of ${census.stalled} stalled tickets (${Math.round((top.count / census.stalled) * 100)}%) share ONE cause: ${top.cause}. A cohort that size is a single platform or configuration defect, not N independent ticket problems — per-ticket remedies cannot clear it, because the cohort outruns the per-pass budget every pass. Fix the shared cause; example tickets: ${top.sampleTaskIds.join(', ')}.`,
      });
    }
    // Did the manager DO the thing it is supposed to do about a large cohort?
    const systemicWorthy = census.cohorts.filter((c) => c.count >= 12);
    if (systemicWorthy.length > 0 && census.findings.length === 0) {
      critical.push({
        severity: 'critical',
        code: 'systemic_never_raised',
        text: `${systemicWorthy.length} stall cohort${systemicWorthy.length === 1 ? ' is' : 's are'} large enough to be a platform defect (${systemicWorthy.map((c) => `${c.cause} ×${c.count}`).join(', ')}), but the manager has raised NO systemic finding. The stage that turns a cohort into a root cause and a ticket is either not running or failing silently — check for 'systemic' rows in the decision feed.`,
      });
    }
    for (const f of census.findings) {
      if (f.createdTaskId == null) {
        warning.push({
          severity: 'warning',
          code: 'systemic_finding_unticketed',
          text: `The manager diagnosed a platform defect (${f.cause}, ${f.ticketCount} tickets) but could NOT open a ticket for it, so the finding has no owner and no place on the board. Its remediation: ${capText(f.remediation, 200)}`,
        });
        continue;
      }
      info.push({
        severity: 'info',
        code: 'systemic_finding_open',
        text: `Platform finding open: ${f.ticketCount} tickets stalled on ${f.cause} → ticket ${f.createdTaskKey ?? `#${f.createdTaskId}`} (${f.source === 'ai' ? 'model-diagnosed' : 'measured fallback'}). Root cause: ${capText(f.summary, 220)}`,
      });
    }
  }

  // ── 6. Policy gates that HOLD finished work (a full backlog with nothing shipping) ──
  if (!policy.allowAutoMerge && stats.openPullRequests > 0) {
    warning.push({
      severity: 'warning',
      code: 'merge_withheld',
      text: `${stats.openPullRequests} pull request${stats.openPullRequests === 1 ? ' is' : 's are'} open and unattended merge is NOT granted (project tier: ${tri(config?.allowAutoMerge)} · workspace tier: ${tri(tenantPolicy.allowAutoMerge)}). The manager can prepare a PR but cannot land it, so finished work accumulates unmerged.`,
    });
  }
  const awaitingSignoff = stalls?.byCause.find((c) => c.cause === 'awaiting_signoff')?.count ?? 0;
  const signoffs = summarizeSignoffs(actions);
  if (policy.requireSignoffToComplete && (awaitingSignoff > 0 || signoffs.heldTickets > 0)) {
    warning.push({
      severity: 'warning',
      code: 'signoff_gate',
      // The register counts tickets whose STALL cause is awaiting_signoff; the feed
      // counts tickets the gate held this window. They routinely disagree by an order
      // of magnitude (a ticket held every pass is not necessarily idle long enough to
      // be "stalled"), and reporting only the first made the gate look marginal.
      text: `The effective policy requires UNANIMOUS sign-off before a ticket can complete or merge. ${awaitingSignoff} ticket${awaitingSignoff === 1 ? ' is' : 's are'} on the stuck register for it, and the gate held ${signoffs.heldTickets} ticket${signoffs.heldTickets === 1 ? '' : 's'} in the last ${actions.length} decisions. Every unfilled role on a ticket is a hard stop.`,
    });
  }
  // Every finding below is conditioned on the gate being ON: with
  // requireSignoffToComplete off, an outstanding slot is advisory and is not what is
  // holding the ticket, so reporting it as a cause would send the reader after the
  // wrong thing. A pattern claim also needs more than one decision to stand on —
  // hence the two-ticket floor on the "never" findings, which are about a WINDOW.
  if (policy.requireSignoffToComplete) {
  // THE contradiction operators hit: the feed says "waiting on N required sign-offs"
  // while the ticket shows no assignee. Both are true — a required participation slot
  // is not the ticket's owner — and only this finding says so.
  if (signoffs.unstaffed > 0) {
    critical.push({
      severity: 'critical',
      code: 'signoff_roles_unstaffed',
      text: `${signoffs.unstaffed} required sign-off slot${signoffs.unstaffed === 1 ? '' : 's'} across the held tickets have NO assignee at all${signoffs.unassignedRoles.length ? ` (${signoffs.unassignedRoles.map((r) => `${r.role} ×${r.count}`).join(', ')})` : ''}. This is why a ticket can read "waiting on 10 of 10 sign-offs" while its assignee column is empty: the manifest slot is a required ROLE, not the ticket's owner, and an unstaffed role is a hard stop no agent can clear. Staff the role (project roster / role assignments) or waive the slot — nothing else moves these.`,
    });
  }
  if (signoffs.humanOwed > 0) {
    warning.push({
      severity: 'warning',
      code: 'signoff_owed_by_human',
      text: `${signoffs.humanOwed} required sign-off slot${signoffs.humanOwed === 1 ? ' is' : 's are'} owed by a PERSON, not an agent${signoffs.waitingOnPeople.length ? ` (${signoffs.waitingOnPeople.map((p) => `${p.who} ×${p.count}`).join(', ')})` : ''}. The manager can only dispatch agents, so it cannot drive these — they wait until the named person signs off on the ticket's Sign-off & Accountability tab.`,
    });
  }
  if (signoffs.heldTickets >= 2 && signoffs.askedTickets === 0) {
    critical.push({
      severity: 'critical',
      code: 'signoff_never_asked',
      text: `The gate held ${signoffs.heldTickets} tickets in this window and dispatched NOBODY to sign off on any of them. Holding without asking is a closed loop: the tickets are re-evaluated every pass, the same roles stay outstanding, and no verdict can ever arrive.`,
    });
  }
  if (signoffs.heldTickets >= 2 && signoffs.requiredTotal > 0 && signoffs.satisfiedTotal === 0) {
    critical.push({
      severity: 'critical',
      code: 'signoff_never_satisfied',
      text: `Across the held tickets, ${signoffs.requiredTotal} required sign-off slots have been counted and ZERO are satisfied. A gate that has never once opened is not a gate that is close to opening — check that reviewers are recording verdicts against the ticket's LANE (a verdict recorded with no lane matches no lane-scoped slot).`,
    });
  }
  }
  if (stats.flagged > 0) {
    warning.push({
      severity: 'warning',
      code: 'coverage_flagged',
      text: `${share(stats.flagged, stats.total)} open tickets are flagged for unmet role/reviewer coverage. Those tickets cannot satisfy a sign-off gate until the manager staffs them.`,
    });
  }

  // ── 7. Is the manager repeating itself? ──
  const repeats = repeatedActions(actions).filter((r) => r.count >= REPEAT_FINDING_THRESHOLD);
  if (repeats.length > 0) {
    const top = repeats[0];
    warning.push({
      severity: 'warning',
      code: 'decision_loop',
      text: `The activity feed is repeating: "${capText(top.summary, 160)}" (${top.actionType}) appears ${top.count}× in the last ${actions.length} decisions${top.tickets.length ? ` on ${top.tickets.slice(0, 3).join(', ')}` : ''}. A decision re-taken every pass is a loop the manager cannot exit on its own.`,
    });
  }
  if (actions.length === 0 && stats.total > 0) {
    warning.push({
      severity: 'warning',
      code: 'no_decisions',
      text: `The manager has recorded NO decisions for this project despite ${stats.total} open tickets — passes are either not running or exiting before they journal anything.`,
    });
  }

  // ── 8. Context that changes how the rest reads ──
  if (policy.managerKind === 'system') {
    info.push({
      severity: 'info',
      code: 'manager_unassigned',
      text: 'No manager is designated, so passes run as the built-in system service. Everything above still applies; the owner column on the pass cards will read "System service".',
    });
  }
  const activeDirectives = directives.filter((d) => d.status === 'active');
  if (activeDirectives.length > 0) {
    info.push({
      severity: 'info',
      code: 'standing_directives',
      text: `${activeDirectives.length} standing coaching directive${activeDirectives.length === 1 ? '' : 's'} reshape${activeDirectives.length === 1 ? 's' : ''} every pass (listed below). A stale or over-broad directive is a real cause of odd manager behaviour.`,
    });
  }

  return [...critical, ...warning, ...info];
}

// ── section renderers ───────────────────────────────────────────────────────

/** Manager identity + the effective/stored/inherited fold, tier by tier. */
const POLICY_KEYS: ReadonlyArray<keyof ManagerPolicy & keyof ManagerConfig> = [
  'enabled', 'autoBusinessValue', 'autoPrioritize', 'autoAssign', 'autoSchedule',
  'requireSignoffToComplete', 'allowAutoMerge', 'prMergePolicy',
  'allowUnattendedCeremonies', 'allowAgentReassignment',
  'agentReassignIdleHours', 'agentReassignMaxPerSession',
];

function formatPolicy(policy: ManagerPolicy, config: ManagerConfig | null, tenantPolicy: ManagerPolicy): string[] {
  return POLICY_KEYS.map((key) => line(
    key,
    // Effective first (what the manager may actually do), then the two tiers that
    // produced it — the whole point is to see WHICH tier turned something off.
    `${tri(policy[key])}   [project: ${config ? tri(config[key]) : 'no row'} · workspace: ${tri(tenantPolicy[key])}]`,
  ));
}

/**
 * The sign-off gate: what it is waiting on, and — the part that decides whether a human
 * or the manager has to act — WHO owes each outstanding slot.
 */
function formatSignoffs(rollup: SignoffRollup, actionCount: number): string[] {
  if (rollup.heldTickets === 0) {
    return [`(the gate held no ticket in the last ${actionCount} decisions)`];
  }
  const out: string[] = [];
  out.push(line('tickets held by the gate', rollup.heldTickets));
  out.push(line('of those, a role was actually asked to sign off', rollup.askedTickets));
  out.push(line('required slots counted', rollup.requiredTotal));
  out.push(line('satisfied', `${rollup.satisfiedTotal}${rollup.requiredTotal > 0 ? ` of ${rollup.requiredTotal}` : ''}`));
  out.push('');
  if (!rollup.hasOwnership) {
    out.push('slot ownership: NOT REPORTED by these decisions (they predate the manager');
    out.push('  journalling who owes each slot). The zeros below are "unknown", not "none" —');
    out.push('  open the ticket\'s Sign-off & Accountability tab for the per-slot truth.');
    return out;
  }
  out.push('who owes the outstanding slots:');
  out.push(line('  agent-owed (the manager can ask)', rollup.dispatchable));
  out.push(line('  owed by a person', rollup.humanOwed));
  out.push(line('  NOBODY assigned', rollup.unstaffed));
  if (rollup.unassignedRoles.length) {
    out.push('');
    out.push('roles outstanding with no assignee (this is what "nobody is assigned" means');
    out.push('on a ticket the manager says is awaiting sign-off):');
    for (const r of rollup.unassignedRoles) out.push(`  ${r.role}: ${r.count}`);
  }
  if (rollup.waitingOnPeople.length) {
    out.push('');
    out.push('waiting on a person:');
    for (const p of rollup.waitingOnPeople) out.push(`  ${p.who}: ${p.count}`);
  }
  return out;
}

/** The per-pass ceilings and dispatch ownership, as the passes themselves reported. */
function formatLimits(limits: PassLimits): string[] {
  const out: string[] = [];
  const show = (label: string, v: number | boolean | null) =>
    out.push(line(label, v == null ? '(not reported by these decisions)' : String(v)));
  show('ownsDispatch (this pass starts runnable work itself)', limits.ownsDispatch);
  show('triage dispatch cap (billable runs per pass)', limits.triageDispatchCap);
  show('coverage remediation cap (flagged tickets per pass)', limits.remediationCap);
  out.push('');
  show('stalled tickets seen last triage', limits.stalledSeen);
  show('unstuck last triage', limits.unstuck);
  show('deferred to the next pass (triage)', limits.deferred);
  show('deferred to the next pass (coverage)', limits.remediationDeferred);
  return out;
}

/** The pass table: every management pass, what happened to it, and its counters. */
function formatPasses(runTasks: readonly ManagerRunTask[], nowMs: number | null): string[] {
  if (runTasks.length === 0) return ['(no management pass cards exist for this project)'];
  const out: string[] = [];
  for (const [i, t] of runTasks.entries()) {
    const outcome = classifyPass(t, nowMs);
    const created = ageMs(t.createdAt, nowMs);
    const took = t.completedAt && Number.isFinite(Date.parse(t.completedAt)) && Number.isFinite(Date.parse(t.createdAt))
      ? formatAge(Date.parse(t.completedAt) - Date.parse(t.createdAt))
      : null;
    out.push(
      `${String(i + 1).padStart(2, ' ')}. ${t.key}  outcome=${outcome}  status=${t.status}`
      + `  created=${t.createdAt}${created == null ? '' : ` (${formatAge(created)} ago)`}`
      + `  completed=${t.completedAt ?? '—'}${took ? ` (took ${took})` : ''}`,
    );
    const counters = parsePassCounters(t.summary);
    if (counters) {
      out.push(`     counters: ${COUNTER_NAMES.filter((n) => counters[n] != null).map((n) => `${n}=${counters[n]}`).join(' ')}${counters.flagged != null ? ` flagged=${counters.flagged}` : ''}`);
    }
    if (t.summary) out.push(`     summary: ${capText(t.summary)}`);
  }
  return out;
}

/**
 * The full-coverage census: what is stuck across EVERY ticket, and the platform findings
 * the manager raised from it.
 *
 * Printed BEFORE the stuck register on purpose. The register is the sample; this is the
 * count. Reading them the other way round is exactly how a 313-ticket cohort stayed
 * invisible behind a 44-row register whose top cause read "unknown".
 */
function formatCensus(census: StallCensusResponse): string[] {
  const out: string[] = [];
  out.push(line('managed (active tickets)', census.managed));
  out.push(line('stalled', share(census.stalled, census.managed)));
  out.push(line('moving', census.moving));
  out.push(line('confirmed by deep triage', census.stalled > 0
    ? `${share(census.deepDiagnosed, census.stalled)} of the stalled set`
    : String(census.deepDiagnosed)));
  out.push(line('computedAt', census.computedAt));
  out.push('');
  out.push('cohorts (every stalled ticket, grouped by cause — largest first):');
  if (census.cohorts.length === 0) out.push('  (none — nothing is stalled)');
  for (const c of census.cohorts) {
    out.push(`  ${c.cause}: ${c.count}  longest-idle=${formatAge(c.maxIdleMs)}  examples=${c.sampleTaskIds.join(', ') || '—'}`);
  }
  out.push('');
  out.push(`platform findings (${census.findings.length} open):`);
  if (census.findings.length === 0) {
    out.push('  (none raised — a cohort must cross the materiality threshold before the');
    out.push('   manager treats it as one defect rather than as ticket work)');
  }
  for (const f of census.findings) {
    out.push(`  - ${f.cause} ×${f.ticketCount}  ticket=${f.createdTaskKey ?? (f.createdTaskId != null ? `#${f.createdTaskId}` : 'NOT CREATED')}`
      + `  source=${f.source}  firstSeen=${f.firstSeenAt}  lastSeen=${f.lastSeenAt}`);
    out.push(`      root cause: ${capText(f.summary, 400)}`);
    out.push(`      remediation: ${capText(f.remediation, 400)}`);
  }
  return out;
}

/** The stuck register: the counts, the causes, then the rows. */
function formatStalls(stalls: StallRegister, nowMs: number | null): string[] {
  const out: string[] = [];
  out.push(line('working (manager still trying)', stalls.working));
  out.push(line('escalated (handed to a human)', stalls.escalated));
  out.push(line('maxAttempts (remedy ceiling)', stalls.maxAttempts));
  out.push(line('rows', stalls.rows.length));
  out.push('');
  out.push('by cause:');
  if (stalls.byCause.length === 0) out.push('  (none)');
  for (const c of stalls.byCause) out.push(`  ${c.cause}: ${c.count}`);
  out.push('');

  const rendered = stalls.rows.map((r: StallWatchRow, i) => {
    const head = `${String(i + 1).padStart(3, ' ')}. #${r.taskId} ${capText(r.title, 80)}`
      + `  status=${r.status}  cause=${r.cause}  remedy=${r.remedy}`
      + `  attempts=${r.attempts}  idle=${formatAge(r.idleMs)}`
      + `  firstSeen=${r.firstSeenAt}  lastAttempt=${r.lastAttemptAt ?? '—'}`
      + (r.escalatedAt ? `  ESCALATED=${r.escalatedAt}` : '');
    return r.detail ? `${head}\n     detail: ${capText(r.detail)}` : head;
  });
  out.push(...windowRows(rendered, {
    head: STALL_WINDOW_HEAD,
    tail: STALL_WINDOW_TAIL,
    note: (elided) => [
      `     … ${elided} stuck ticket${elided === 1 ? '' : 's'} elided from the MIDDLE of the register. The server`,
      '       orders it escalated-first then longest-idle, so the head keeps everything waiting on a',
      '       human and the most-stuck rows, and the tail keeps the newest stalls. The cause rollup',
      '       above covers every row; for the untrimmed list re-fetch GET /api/manager/<id>/stalls',
      '       (itself capped at 200 rows server-side).',
    ],
  }));
  // A row count with no clock reference reads as "now"; say when it was captured.
  if (nowMs == null) out.push('     (ages computed against an unparseable capturedAt — treat idle values as unknown)');
  return out;
}

/** The decision feed: the rollup that names a loop, then the collapsed rows. */
function formatActivity(actions: readonly ManagerAction[]): string[] {
  if (actions.length === 0) return ['(no decisions recorded — the manager has journaled nothing for this project)'];
  const out: string[] = [];

  const byType = new Map<string, number>();
  for (const a of actions) byType.set(a.actionType, (byType.get(a.actionType) ?? 0) + 1);
  out.push(`by type: ${[...byType.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join(' ')}`);

  const repeats = repeatedActions(actions).filter((r) => r.count > 1).slice(0, 10);
  if (repeats.length > 0) {
    out.push('');
    out.push('repeated decisions (the same decision re-taken — a loop, not progress):');
    for (const r of repeats) {
      out.push(`  ${r.count}× ${r.actionType}: ${capText(r.summary, 200)}`);
      out.push(`     first: ${r.firstAt}   last: ${r.lastAt}   tickets: ${r.tickets.slice(0, 5).join(', ') || '(none)'}`);
    }
  }
  out.push('');

  // Collapse strictly-consecutive identical decisions before windowing, same as the
  // lifecycle chain of custody: 30 identical rows are one fact, not thirty.
  const collapsed = collapseRuns(
    actions,
    (a) => `${a.actionType}|${a.taskId}|${a.summary}|${a.detail}`,
    (a) => a.createdAt,
  );
  const rendered = collapsed.map((row, i) => {
    const a = row.item;
    // "back to", not "through": this feed arrives NEWEST-first, so the collapsed run
    // extends backwards in time from the row's own stamp.
    const head = `${String(i + 1).padStart(3, ' ')}. ${a.createdAt}  ${a.actionType}`
      + `  ticket=${a.ticketKey ?? (a.taskId != null ? `#${a.taskId}` : '—')}`
      + (row.repeats > 1 ? `  ×${row.repeats} (back to ${row.lastStamp})` : '');
    const body = [`     ${capText(a.summary)}`];
    if (a.detail) body.push(`     detail: ${capText(a.detail)}`);
    return [head, ...body].join('\n');
  });
  out.push(...windowRows(rendered, {
    head: ACTION_WINDOW_HEAD,
    tail: ACTION_WINDOW_TAIL,
    note: (elided) => [
      `     … ${elided} decision row${elided === 1 ? '' : 's'} elided from the MIDDLE of the feed (the head and`,
      '       the most recent are both kept). Repeats are summarised above; for more history',
      '       re-fetch GET /api/manager/<id>/activity?limit=200.',
    ],
  }));
  return out;
}

/**
 * Build the full AI Manager diagnostics report.
 *
 * Order: environment → findings → manager identity → policy fold → autonomy → backlog
 * health → passes → stuck register → decision feed → directives → raw JSON. Answer first,
 * evidence second, appendix last — so a report that IS truncated by whatever it is pasted
 * into loses the appendix rather than the diagnosis.
 */
export function buildManagerDiagnosticsReport(
  input: ManagerDiagnosticsInput,
  ctx: DiagnosticsContext,
): string {
  const { overview, stalls } = input;
  const { policy, config, tenantPolicy, stats, autonomy, runTasks, actions, directives } = overview;
  // ONE instant for the whole report, taken from the capture stamp so the builder stays
  // pure. An unparseable stamp degrades every age to "unknown" rather than to a lie.
  const parsed = Date.parse(ctx.capturedAt);
  const nowMs = Number.isFinite(parsed) ? parsed : null;

  const out: string[] = [];
  out.push('=== BUILDERFORCE AI MANAGER DIAGNOSTICS ===');
  out.push('');
  out.push(...environmentLines(ctx, [['projectId', input.projectId]]));
  out.push('');

  const findings = managerFindings(input, nowMs);
  out.push(`-- Findings (${findings.length}) --`);
  out.push('Derived from the data below, most actionable first. Codes are stable and greppable.');
  if (findings.length === 0) {
    out.push('(nothing detected — managing is enabled, passes are completing, and no gate is holding the backlog)');
  }
  for (const f of findings) out.push(`[${f.severity}] ${f.code}: ${f.text}`);
  out.push('');

  out.push('-- Manager --');
  out.push(line('managerRef', policy.managerRef));
  out.push(line('managerKind', policy.managerKind));
  out.push(line('managerType', policy.managerType));
  out.push(line('lastRunAt', stampWithAge(stats.lastRunAt, nowMs)));
  out.push(line('expected cron cadence', `~${formatAge(MANAGER_CRON_PERIOD_MS)}`));
  out.push('');

  out.push('-- Effective policy (built-in default ← workspace ← this project) --');
  out.push('Effective value first, then the tier values that produced it. "inherit" = the tier');
  out.push('expresses no opinion; the authority gates resolve MOST-RESTRICTIVE-wins, not');
  out.push('nearest-tier-wins, so an effective "no" can come from either tier.');
  out.push(...formatPolicy(policy, config, tenantPolicy));
  out.push('');

  out.push('-- Operating limits (as the passes themselves reported) --');
  out.push('The policy above says what the manager MAY do; these say how much of it fits in');
  out.push('one pass. A capability that is enabled still leaves a 600-ticket backlog untouched');
  out.push('if every pass stops at its cap, and a remedy that must start a run does nothing at');
  out.push('all on a pass that does not own dispatch. Read from the journalled decisions, so an');
  out.push('unreported value means these decisions did not carry it — not that it is unlimited.');
  out.push(...formatLimits(summarizePassLimits(actions)));
  out.push('');

  out.push('-- Sign-off gate --');
  out.push('requireSignoffToComplete gates completion AND merge on every REQUIRED role slot');
  out.push('being satisfied. A role slot is not the ticket\'s assignee: a ticket can show an');
  out.push('empty assignee column and still owe ten sign-offs. What matters for whether the');
  out.push('manager can do anything is WHO owes each slot — an agent it can dispatch, a person');
  out.push('it cannot, or nobody at all (which no dispatch can ever clear).');
  out.push(...formatSignoffs(summarizeSignoffs(actions), actions.length));
  out.push('');

  out.push('-- Autonomy health (tenant-wide) --');
  out.push(line('tokenBlocked', autonomy.tokenBlocked));
  out.push(line('reason', autonomy.reason));
  out.push(line('effectivePlan', autonomy.effectivePlan));
  out.push('');

  out.push('-- Backlog health (open, non-archived, non-system tickets) --');
  out.push(line('total', stats.total));
  out.push(line('unscored', share(stats.unscored, stats.total)));
  out.push(line('unranked', share(stats.unranked, stats.total)));
  out.push(line('undated', share(stats.undated, stats.total)));
  out.push(line('unowned', share(stats.unowned, stats.total)));
  out.push(line('flagged (unmet role coverage)', share(stats.flagged, stats.total)));
  out.push(line('openPullRequests', stats.openPullRequests));
  out.push('');

  out.push(`-- Management passes (${runTasks.length} most recent) --`);
  out.push(`outcome=died means the card is open past the ${formatAge(STALE_RUN_TASK_MS)} reap threshold: the`);
  out.push('Worker was evicted mid-pass, so that pass never finished its work. This is what the');
  out.push('overview endpoint returned, not the project\'s whole pass history.');
  out.push(...formatPasses(runTasks, nowMs));
  out.push('');

  out.push('-- Stall census (EVERY ticket) + platform findings --');
  out.push('The count, not a sample. The stuck register below is bounded by what deep triage');
  out.push('has had budget to diagnose (capped per project per pass), so its cause ranking can');
  out.push('disagree with this block — when they differ, THIS one is the distribution. A cohort');
  out.push('far larger than the per-pass budget cannot be cleared ticket-by-ticket at all, which');
  out.push('is why a large one is raised as a platform finding with its own ticket.');
  if (input.census == null) {
    out.push(`(unavailable${input.censusError ? `: ${input.censusError}` : ''} — this is NOT the same as "nothing is stalled")`);
  } else {
    out.push(...formatCensus(input.census));
  }
  out.push('');

  out.push('-- Stuck register (the per-ticket sample deep triage has worked) --');
  if (stalls == null) {
    out.push(`(unavailable${input.stallsError ? `: ${input.stallsError}` : ''} — this is NOT the same as "nothing is stuck")`);
  } else {
    out.push(...formatStalls(stalls, nowMs));
  }
  out.push('');

  out.push(`-- Decision feed (${actions.length} most recent) --`);
  out.push('What the overview endpoint returned, not the whole history — counts here are "of these');
  out.push(`${actions.length}", and GET /api/manager/${input.projectId}/activity?limit=200 goes further back.`);
  out.push(...formatActivity(actions));
  out.push('');

  out.push(`-- Standing coaching directives (${directives.filter((d) => d.status === 'active').length} active of ${directives.length}) --`);
  if (directives.length === 0) out.push('(none)');
  for (const d of directives) {
    out.push(`- [${d.status}] ${d.projectId == null ? 'tenant-wide' : `project #${d.projectId}`} · created ${d.createdAt} · expires ${d.expiresAt ?? 'never'} · via ${d.source}`);
    out.push(`  ${capText(d.directive)}`);
  }
  out.push('');

  // The appendix. `backlog`, `actions` and the stall rows are the unbounded parts of the
  // payload and are all rendered above, so they are what gets dropped when keeping them
  // would push the WHOLE report past the budget — every computed block survives.
  const body = out.join('\n');
  const payload = { projectId: input.projectId, overview, stalls, census: input.census ?? null };
  out.push(...jsonAppendix(body.length, payload, {
    note: `(rows elided: the full report would exceed ${REPORT_BUDGET_CHARS} characters. Every computed block above is intact.)`,
    compact: () => ({
      projectId: input.projectId,
      overview: {
        ...overview,
        backlog: `<elided: ${overview.backlog.length} ranked backlog rows — re-fetch GET /api/manager/${input.projectId}>`,
        actions: `<elided: ${actions.length} decisions — see the decision feed above>`,
      },
      stalls: stalls == null ? null : {
        ...stalls,
        rows: `<elided: ${stalls.rows.length} stuck tickets — see the stuck register above, or re-fetch GET /api/manager/${input.projectId}/stalls>`,
      },
      // The census survives compaction WHOLE: it is small (one row per CAUSE, not per
      // ticket) and it is the block a reader most needs when everything else is trimmed.
      census: input.census ?? null,
    }),
  }));

  return out.join('\n');
}
