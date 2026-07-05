import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { agentHosts, executions, ideAgents, memberProfiles, tasks, users } from '../../infrastructure/database/schema';
import { clampScore } from '../../domain/shared/numbers';

/**
 * Project 360 — the single source of truth for a project's whole-picture health,
 * missing items, and live workforce state. Computed server-side in ONE cached
 * round-trip so every surface (the VS Code native panel today; the web app) renders
 * the SAME numbers instead of each re-deriving a score that drifts.
 *
 * It reuses the SAME task-status aggregates the `/api/projects` list already folds
 * in (passed as {@link Project360Aggregate}) — no second count of the same rows —
 * and layers on the live signals the list doesn't carry: per-task assignment,
 * estimation, the non-terminal executions that tell us who is actually working right
 * now, and each owner's availability (ooo / focus / on-call) so "idle" says WHY.
 *
 * Two rings, like the Career 360 wheel: four PILLARS (inner) each split into two
 * DIMENSIONS (outer). Every dimension is a 0–100 score with a tier colour and a
 * list of concrete GAPS, each carrying an ACTION the panel turns into a one-click
 * "improve" button (open the board, ask the Brain to groom/assign/unblock, run a
 * task, review approvals).
 *
 * The DB I/O lives in {@link computeProject360}; the pure scoring + assembly is
 * {@link assembleProject360} (no DB) so it is unit-testable with plain fixtures.
 */

export type HealthTier = 'healthy' | 'watch' | 'at_risk' | 'critical';

const TIER_COLOR: Record<HealthTier, string> = {
  healthy: '#22c55e',
  watch: '#eab308',
  at_risk: '#f59e0b',
  critical: '#ef4444',
};

/** Map a 0–100 score to a tier. Mirrors the frontend `healthTier` so the wheel,
 *  the badge and the web project card all agree on the same thresholds. */
export function healthTier(score: number): HealthTier {
  if (score >= 80) return 'healthy';
  if (score >= 60) return 'watch';
  if (score >= 40) return 'at_risk';
  return 'critical';
}

const scored = (score: number): { score: number; tier: HealthTier; color: string } => {
  const s = clampScore(Math.round(score));
  const tier = healthTier(s);
  return { score: s, tier, color: TIER_COLOR[tier] };
};

export interface Project360Action {
  kind: 'board' | 'approvals' | 'brain' | 'run-task' | 'open-task';
  label: string;
  text?: string;
  task?: { id: number; key?: string; title: string };
}

export interface Project360Gap {
  id: string;
  dimension: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail?: string;
  action?: Project360Action;
}

export interface Project360Dimension {
  key: string;
  label: string;
  pillar: string;
  score: number;
  tier: HealthTier;
  color: string;
  summary: string;
  gaps: Project360Gap[];
}

export interface Project360Pillar {
  key: string;
  label: string;
  score: number;
  tier: HealthTier;
  color: string;
}

export interface Project360Member {
  ref: string;
  kind: 'human' | 'host' | 'cloud';
  name: string;
  status: 'working' | 'awaiting' | 'blocked' | 'idle' | 'available';
  reason: string;
  taskId?: number;
  taskKey?: string;
  taskTitle?: string;
}

export interface Project360 {
  project: { id: number; name: string; key?: string; status?: string };
  hasData: boolean;
  overall: { score: number; tier: HealthTier; color: string; progressPct: number };
  counts: {
    total: number;
    completed: number;
    open: number;
    blocked: number;
    overdue: number;
    unassigned: number;
    inProgress: number;
    activeRuns: number;
    workers: number;
  };
  pillars: Project360Pillar[];
  dimensions: Project360Dimension[];
  gaps: Project360Gap[];
  workforce: Project360Member[];
  generatedAt: string;
}

export interface Project360Aggregate {
  id: number;
  name: string;
  key?: string | null;
  status?: string | null;
  taskCount: number;
  completedTaskCount: number;
  openTaskCount: number;
  blockedTaskCount: number;
  overdueTaskCount: number;
  linkedGoalCount: number;
  initiativeId: string | null;
  hasArchitecturePrd: boolean;
  assignedAgentHost: { id: number; name: string } | null;
}

/** One (non-archived) task row, trimmed to the fields the model needs. */
export interface Project360TaskRow {
  id: number;
  key: string | null;
  title: string;
  status: string;
  storyPoints: number | null;
  description: string | null;
  assignedUserId: string | null;
  assignedAgentHostId: number | null;
  assignedAgentRef: string | null;
}

/** One non-terminal execution on a project task. */
export interface Project360ActiveRow {
  taskId: number;
  status: string;
}

/** An owner's availability signal (from member_profiles), if known. */
export interface Project360Availability {
  status: 'available' | 'busy' | 'focus' | 'ooo' | 'on_call' | string;
  until: string | null;
}

const DONE = new Set(['done', 'completed', 'closed', 'merged', 'resolved']);
const TERMINAL = new Set([...DONE, 'cancelled']);
const NOT_STARTED = new Set(['backlog', 'todo', 'ready', 'open', 'new']);

type Owner = { ref: string; kind: Project360Member['kind'] };

function ownerOf(t: {
  assignedUserId: string | null;
  assignedAgentHostId: number | null;
  assignedAgentRef: string | null;
}): Owner | null {
  if (t.assignedUserId) return { ref: t.assignedUserId, kind: 'human' };
  if (t.assignedAgentHostId != null) return { ref: `host:${t.assignedAgentHostId}`, kind: 'host' };
  if (t.assignedAgentRef) return { ref: t.assignedAgentRef, kind: 'cloud' };
  return null;
}

/**
 * Pure model assembly — no DB. Given the aggregate, the project's tasks, its live
 * executions, and resolvers for owner names + availability, produce the full 360
 * model. Deterministic (takes `nowIso`) so it can be unit-tested with fixtures.
 */
export function assembleProject360(input: {
  agg: Project360Aggregate;
  tasks: Project360TaskRow[];
  active: Project360ActiveRow[];
  resolveName: (owner: Owner) => string;
  resolveAvailability?: (ownerRef: string) => Project360Availability | undefined;
  nowIso: string;
}): Project360 {
  const { agg, tasks: taskRows, active: activeRows, resolveName, resolveAvailability, nowIso } = input;

  const total = agg.taskCount;
  const completed = agg.completedTaskCount;
  const open = agg.openTaskCount;
  const blocked = agg.blockedTaskCount;
  const overdue = agg.overdueTaskCount;
  const hasData = total > 0;

  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const openTasks = taskRows.filter((t) => !TERMINAL.has(t.status));
  const inProgressTasks = taskRows.filter((t) => t.status === 'in_progress');
  const notStarted = taskRows.filter((t) => NOT_STARTED.has(t.status));
  const unestimated = notStarted.filter((t) => !(t.storyPoints && t.storyPoints > 0));
  const thin = taskRows.filter((t) => !TERMINAL.has(t.status) && !(t.description && t.description.trim().length >= 24));
  const assignable = openTasks.filter((t) => t.status !== 'blocked');
  const unassigned = assignable.filter((t) => !ownerOf(t));
  const unownedInProgress = inProgressTasks.filter((t) => !ownerOf(t));

  const activeByTask = new Map<number, { paused: boolean }>();
  for (const e of activeRows) {
    const prev = activeByTask.get(e.taskId);
    const paused = e.status === 'paused';
    if (!prev || (prev.paused && !paused)) activeByTask.set(e.taskId, { paused });
  }
  const activeRuns = activeRows.length;

  const gap = (
    dimension: string,
    severity: Project360Gap['severity'],
    title: string,
    action?: Project360Action,
    detail?: string,
  ): Project360Gap => ({ id: `${dimension}:${title}`, dimension, severity, title, detail, action });

  const boardAction = (label: string): Project360Action => ({ kind: 'board', label });
  const brainAction = (label: string, text: string): Project360Action => ({ kind: 'brain', label, text });
  const pj = agg.name;

  const dims: Project360Dimension[] = [];
  const push = (
    key: string,
    label: string,
    pillar: string,
    rawScore: number,
    summary: string,
    gaps: Project360Gap[],
  ) => dims.push({ key, label, pillar, ...scored(rawScore), summary, gaps });

  // Delivery — Progress
  push(
    'progress',
    'Progress',
    'delivery',
    hasData ? progressPct : 100,
    hasData ? `${completed} of ${total} tasks done (${progressPct}%)` : 'No tasks yet',
    hasData && completed === 0 ? [gap('progress', 'medium', 'Nothing completed yet', boardAction('Open board'))] : [],
  );

  // Delivery — Timeliness
  const timeliness = open === 0 ? 100 : 100 * (1 - Math.min(1, overdue / open));
  push(
    'timeliness',
    'Timeliness',
    'delivery',
    timeliness,
    overdue > 0 ? `${overdue} overdue` : 'On schedule',
    overdue > 0
      ? [gap('timeliness', overdue >= 3 ? 'high' : 'medium', `${overdue} task${overdue === 1 ? '' : 's'} overdue`, brainAction('Re-plan with Brain', `${overdue} tasks in the "${pj}" project are overdue. Review each overdue task, then either update its due date to something realistic or break it into smaller tasks. Summarise the new plan.`))]
      : [],
  );

  // Execution — Flow (unblocked)
  const flow = open === 0 ? 100 : 100 * (1 - Math.min(1, blocked / open));
  push(
    'flow',
    'Flow',
    'execution',
    flow,
    blocked > 0 ? `${blocked} blocked` : 'Nothing blocked',
    blocked > 0
      ? [gap('flow', blocked >= 2 ? 'high' : 'medium', `${blocked} task${blocked === 1 ? '' : 's'} blocked`, brainAction('Unblock with Brain', `${blocked} tasks in the "${pj}" project are blocked. Investigate each blocked task, identify what's blocking it, and propose a concrete way to unblock it. Where you can act, do it.`))]
      : [],
  );

  // Execution — Momentum (open work actually moving)
  const momentumTarget = Math.max(1, Math.ceil(open * 0.2));
  const inMotion = inProgressTasks.length + Math.min(activeRuns, open);
  const momentum = open === 0 ? 100 : Math.min(100, (inMotion / momentumTarget) * 100);
  push(
    'momentum',
    'Momentum',
    'execution',
    momentum,
    open === 0 ? 'All work resolved' : `${inProgressTasks.length} in progress · ${activeRuns} running`,
    open > 0 && inProgressTasks.length === 0 && activeRuns === 0
      ? [gap('momentum', 'medium', 'No work in progress', brainAction('Start next task', `The "${pj}" project has open work but nothing in progress. Pick the highest-priority ready task, explain why, and start it.`))]
      : [],
  );

  // Planning — Direction (goals / architecture defined)
  const hasGoals = agg.linkedGoalCount > 0 || !!agg.initiativeId;
  const directionScore = 20 + (hasGoals ? 50 : 0) + (agg.hasArchitecturePrd ? 30 : 0);
  const directionGaps: Project360Gap[] = [];
  if (!hasGoals)
    directionGaps.push(gap('direction', 'high', 'No goal or OKR linked', brainAction('Define objectives', `Help me define 1–3 clear objectives / OKRs for the "${pj}" project and link the key tasks to them so the work has a measurable direction.`)));
  if (!agg.hasArchitecturePrd)
    directionGaps.push(gap('direction', 'medium', 'No architecture PRD', brainAction('Draft architecture', `Analyse the "${pj}" project's codebase and produce an architecture PRD: key components, data flow, and the main technical decisions.`)));
  push('direction', 'Direction', 'planning', directionScore, hasGoals ? (agg.hasArchitecturePrd ? 'Goals + architecture set' : 'Goals set') : 'Direction undefined', directionGaps);

  // Planning — Readiness (backlog estimated / groomed)
  const readiness = notStarted.length === 0 ? 100 : 100 * (1 - unestimated.length / notStarted.length);
  push(
    'readiness',
    'Readiness',
    'planning',
    readiness,
    notStarted.length === 0 ? 'Backlog clear' : `${notStarted.length - unestimated.length}/${notStarted.length} backlog tasks estimated`,
    unestimated.length > 0
      ? [gap('readiness', unestimated.length >= 5 ? 'high' : 'medium', `${unestimated.length} backlog task${unestimated.length === 1 ? '' : 's'} unestimated`, brainAction('Groom backlog', `Review the un-estimated backlog tasks in the "${pj}" project. Add a story-point estimate to each, and mark the well-defined ones as ready.`))]
      : [],
  );

  // Team — Staffing (open work has an owner)
  const staffing = assignable.length === 0 ? 100 : 100 * (1 - unassigned.length / assignable.length);
  push(
    'staffing',
    'Staffing',
    'team',
    staffing,
    assignable.length === 0 ? 'No open work' : `${assignable.length - unassigned.length}/${assignable.length} open tasks owned`,
    unassigned.length > 0
      ? [gap('staffing', unassigned.length >= 3 ? 'high' : 'medium', `${unassigned.length} open task${unassigned.length === 1 ? '' : 's'} unassigned`, brainAction('Assign owners', `Assign an owner to each unassigned open task in the "${pj}" project, matching the work to the right teammate or agent by skill and availability.`))]
      : [],
  );

  // Team — Definition (tasks are executable)
  const definition = taskRows.length === 0 ? 100 : 100 * (1 - thin.length / Math.max(1, openTasks.length || taskRows.length));
  const defGaps: Project360Gap[] = [];
  if (thin.length > 0)
    defGaps.push(gap('definition', thin.length >= 4 ? 'medium' : 'low', `${thin.length} task${thin.length === 1 ? '' : 's'} lack detail`, brainAction('Flesh out tasks', `Several open tasks in the "${pj}" project have thin or missing descriptions. Flesh each out with scope and acceptance criteria so an agent can execute it unattended.`)));
  if (unownedInProgress.length > 0)
    defGaps.push(gap('definition', 'medium', `${unownedInProgress.length} in-progress task${unownedInProgress.length === 1 ? '' : 's'} have no owner`, boardAction('Review on board')));
  push('definition', 'Definition', 'team', definition, thin.length === 0 ? 'Tasks well-defined' : `${thin.length} thin`, defGaps);

  // Pillars (inner ring = mean of their two dimensions)
  const PILLARS: { key: string; label: string }[] = [
    { key: 'delivery', label: 'Delivery' },
    { key: 'execution', label: 'Execution' },
    { key: 'planning', label: 'Planning' },
    { key: 'team', label: 'Team' },
  ];
  const pillars: Project360Pillar[] = PILLARS.map((p) => {
    const ds = dims.filter((d) => d.pillar === p.key);
    const avg = ds.reduce((s, d) => s + d.score, 0) / (ds.length || 1);
    return { key: p.key, label: p.label, ...scored(avg) };
  });

  const WEIGHT: Record<string, number> = {
    progress: 1.5, timeliness: 1, flow: 1.25, momentum: 1,
    direction: 1, readiness: 1, staffing: 1, definition: 0.75,
  };
  const wsum = dims.reduce((s, d) => s + (WEIGHT[d.key] ?? 1), 0);
  const overallRaw = dims.reduce((s, d) => s + d.score * (WEIGHT[d.key] ?? 1), 0) / (wsum || 1);
  const overall = { ...scored(hasData ? overallRaw : 100), progressPct };

  // A project with no tasks is "no data", not "unhealthy" — the surface shows an
  // empty state, so suppress the dimension gaps/nudges until there is work to assess.
  if (!hasData) for (const d of dims) d.gaps = [];
  const severityRank: Record<Project360Gap['severity'], number> = { high: 3, medium: 2, low: 1 };
  const allGaps = dims.flatMap((d) => d.gaps).sort((a, b) => severityRank[b.severity] - severityRank[a.severity]);

  // Workforce — aggregate the best status per owner across their open tasks, then
  // enrich the reason with availability so "idle" explains itself (ooo / focus / on-call).
  const rank: Record<Project360Member['status'], number> = { working: 5, awaiting: 4, blocked: 3, idle: 2, available: 1 };
  const byOwner = new Map<string, Project360Member>();
  const consider = (o: Owner, m: Omit<Project360Member, 'ref' | 'kind' | 'name'>) => {
    const existing = byOwner.get(o.ref);
    const next: Project360Member = { ref: o.ref, kind: o.kind, name: resolveName(o), ...m };
    if (!existing || rank[next.status] > rank[existing.status]) byOwner.set(o.ref, next);
  };
  for (const t of openTasks) {
    const o = ownerOf(t);
    if (!o) continue;
    const live = activeByTask.get(t.id);
    const label = t.key ?? t.title;
    if (live && !live.paused) consider(o, { status: 'working', reason: `Running ${label}`, taskId: t.id, taskKey: t.key ?? undefined, taskTitle: t.title });
    else if (live && live.paused) consider(o, { status: 'awaiting', reason: `Awaiting input on ${label}`, taskId: t.id, taskKey: t.key ?? undefined, taskTitle: t.title });
    else if (t.status === 'blocked') consider(o, { status: 'blocked', reason: `Blocked on ${label}`, taskId: t.id, taskKey: t.key ?? undefined, taskTitle: t.title });
    else if (t.status === 'in_progress') consider(o, { status: 'idle', reason: `In progress, no active run: ${label}`, taskId: t.id, taskKey: t.key ?? undefined, taskTitle: t.title });
    else consider(o, { status: 'idle', reason: `Assigned ${label}, not started`, taskId: t.id, taskKey: t.key ?? undefined, taskTitle: t.title });
  }
  if (agg.assignedAgentHost) {
    const ref = `host:${agg.assignedAgentHost.id}`;
    if (!byOwner.has(ref)) byOwner.set(ref, { ref, kind: 'host', name: agg.assignedAgentHost.name, status: 'available', reason: 'Assigned to project, no active task' });
  }

  // Availability overlay — only for members not actively running (working/awaiting
  // already describe themselves). Turns a bare "idle" into the real reason.
  if (resolveAvailability) {
    for (const m of byOwner.values()) {
      if (m.status === 'working' || m.status === 'awaiting') continue;
      const av = resolveAvailability(m.ref);
      if (!av) continue;
      if (av.status === 'ooo') m.reason = m.taskKey ? `Out of office — ${m.taskKey} waiting` : 'Out of office';
      else if (av.status === 'focus') m.reason = `${m.reason} · in focus time`;
      else if (av.status === 'on_call') m.reason = `${m.reason} · on call`;
      else if (av.status === 'busy' && m.status === 'available') m.reason = 'Busy on other work';
    }
  }

  const workforce = [...byOwner.values()].sort((a, b) => rank[b.status] - rank[a.status] || a.name.localeCompare(b.name));
  const workers = workforce.filter((m) => m.status === 'working').length;

  return {
    project: { id: agg.id, name: agg.name, key: agg.key ?? undefined, status: agg.status ?? undefined },
    hasData,
    overall,
    counts: { total, completed, open, blocked, overdue, unassigned: unassigned.length, inProgress: inProgressTasks.length, activeRuns, workers },
    pillars,
    dimensions: dims,
    gaps: allGaps,
    workforce,
    generatedAt: nowIso,
  };
}

/** Load the live signals for a project and assemble its 360 model. */
export async function computeProject360(
  db: Db,
  tenantId: number,
  agg: Project360Aggregate,
): Promise<Project360> {
  const projectId = agg.id;

  const [taskRows, activeRows] = await Promise.all([
    db
      .select({
        id: tasks.id,
        key: tasks.key,
        title: tasks.title,
        status: tasks.status,
        storyPoints: tasks.storyPoints,
        description: tasks.description,
        assignedUserId: tasks.assignedUserId,
        assignedAgentHostId: tasks.assignedAgentHostId,
        assignedAgentRef: tasks.assignedAgentRef,
      })
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), eq(tasks.archived, false))),
    db
      .select({ taskId: executions.taskId, status: executions.status })
      .from(executions)
      .innerJoin(tasks, eq(executions.taskId, tasks.id))
      .where(
        and(
          eq(tasks.projectId, projectId),
          eq(executions.tenantId, tenantId),
          inArray(executions.status, ['pending', 'submitted', 'running', 'paused']),
        ),
      ),
  ]);

  // Resolve names + availability for every owner (+ the assigned host) in one pass — no N+1.
  const userIds = new Set<string>();
  const hostIds = new Set<number>();
  const cloudRefs = new Set<string>();
  for (const t of taskRows) {
    const o = ownerOf(t);
    if (!o) continue;
    if (o.kind === 'human') userIds.add(o.ref);
    else if (o.kind === 'host') hostIds.add(Number(o.ref.slice(5)));
    else cloudRefs.add(o.ref);
  }
  if (agg.assignedAgentHost) hostIds.add(agg.assignedAgentHost.id);

  const allRefs = [...userIds, ...[...hostIds].map(String), ...cloudRefs];
  const [userRows, hostRows, cloudRows, profileRows] = await Promise.all([
    userIds.size
      ? db.select({ id: users.id, displayName: users.displayName, username: users.username, email: users.email }).from(users).where(inArray(users.id, [...userIds]))
      : Promise.resolve([] as { id: string; displayName: string | null; username: string | null; email: string }[]),
    hostIds.size
      ? db.select({ id: agentHosts.id, name: agentHosts.name }).from(agentHosts).where(inArray(agentHosts.id, [...hostIds]))
      : Promise.resolve([] as { id: number; name: string }[]),
    cloudRefs.size
      ? db.select({ id: ideAgents.id, name: ideAgents.name }).from(ideAgents).where(inArray(ideAgents.id, [...cloudRefs]))
      : Promise.resolve([] as { id: string; name: string }[]),
    allRefs.length
      ? db.select({ memberKind: memberProfiles.memberKind, memberRef: memberProfiles.memberRef, availabilityStatus: memberProfiles.availabilityStatus, availabilityUntil: memberProfiles.availabilityUntil }).from(memberProfiles).where(and(eq(memberProfiles.tenantId, tenantId), inArray(memberProfiles.memberRef, allRefs)))
      : Promise.resolve([] as { memberKind: string; memberRef: string; availabilityStatus: string; availabilityUntil: Date | null }[]),
  ]);

  const userName = new Map(userRows.map((u) => [u.id, u.displayName || u.username || u.email]));
  const hostName = new Map(hostRows.map((h) => [h.id, h.name]));
  const cloudName = new Map(cloudRows.map((a) => [a.id, a.name]));

  // Profile availability keyed by our internal owner ref (human=userId, host=`host:<id>`, cloud=ref).
  const KIND_TO_OWNER: Record<string, Project360Member['kind']> = { human: 'human', host_agent: 'host', cloud_agent: 'cloud' };
  const availByRef = new Map<string, Project360Availability>();
  for (const p of profileRows) {
    const kind = KIND_TO_OWNER[p.memberKind];
    if (!kind) continue;
    const ref = kind === 'host' ? `host:${p.memberRef}` : p.memberRef;
    availByRef.set(ref, { status: p.availabilityStatus, until: p.availabilityUntil ? new Date(p.availabilityUntil).toISOString() : null });
  }

  const resolveName = (o: Owner): string => {
    if (o.kind === 'human') return userName.get(o.ref) ?? 'Teammate';
    if (o.kind === 'host') return hostName.get(Number(o.ref.slice(5))) ?? `Host #${o.ref.slice(5)}`;
    return cloudName.get(o.ref) ?? o.ref;
  };

  return assembleProject360({
    agg,
    tasks: taskRows,
    active: activeRows,
    resolveName,
    resolveAvailability: (ref) => availByRef.get(ref),
    nowIso: new Date().toISOString(),
  });
}
