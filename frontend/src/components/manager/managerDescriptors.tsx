import Link from 'next/link';
import type { ReactNode } from 'react';
import type { CollectionDescriptor } from '@/components/collection/descriptor';
import type { ManagerAction, ManagerBacklogItem, ManagerRunTask, StallWatchRow } from '@/lib/builderforceApi';
import { ticketHref } from '@/lib/ticketHref';
import { taskPriorityBadgeClass } from '@/lib/taskPriority';
import { Icon } from '@/components/ui/Icon';
import { managerActionIcon } from '@/lib/managerActions';
import { statusColor, type StatusToneMap } from '@/lib/statusTone';

/**
 * Collection descriptors for the Manager sub-views (Backlog · Stuck · Activity).
 * All are READ-ONLY (`entity: null`): the manager API has no bulk port for these
 * rows (they are derived views of tasks/actions, not an owned catalog), so no
 * selection column or bulk bar appears. Already-translated strings are passed in
 * as `labels`, per the descriptor contract.
 */

const muted = { color: 'var(--text-muted)', fontSize: '0.8rem' } as const;
const dash = <span style={{ color: 'var(--text-muted)' }}>—</span>;

// ── Backlog ────────────────────────────────────────────────────────────────

export interface BacklogLabels {
  rank: string; key: string; title: string; priority: string; businessValue: string; dueDate: string; assignee: string;
  unassigned: string; noRationale: string;
  priorityLabel: (p: ManagerBacklogItem['priority']) => string;
  owner: (item: ManagerBacklogItem) => string;
  due: (iso: string) => string;
}

function BusinessValueBar({ value, rationale, noRationale }: { value: number | null; rationale: string | null; noRationale: string }) {
  if (value == null) return dash;
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }} title={rationale || noRationale}>
      <span style={{ fontWeight: 700, fontSize: '0.82rem', minWidth: 26, color: 'var(--text-primary)' }}>{value}</span>
      <div style={{ position: 'relative', flex: 1, height: 8, minWidth: 40, background: 'var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}>
        <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, background: 'var(--accent)', borderRadius: 'var(--radius-sm)' }} />
      </div>
    </div>
  );
}

const PRIORITY_ORDER: Record<string, number> = { critical: 0, urgent: 0, high: 1, medium: 2, low: 3 };
const isUnassigned = (i: ManagerBacklogItem) => i.assignedUserId == null && i.assignedAgentRef == null && i.assignedAgentHostId == null;

export function managerBacklogDescriptor(l: BacklogLabels): CollectionDescriptor<ManagerBacklogItem> {
  const priorityBadge = (i: ManagerBacklogItem) => (
    <span className={taskPriorityBadgeClass(i.priority)} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 'var(--radius-sm)' }}>
      {l.priorityLabel(i.priority)}
    </span>
  );
  return {
    entity: null,
    surfaceKey: 'manager.backlog',
    rowId: (i) => String(i.id),
    label: (i) => `${i.key} ${i.title}`,
    defaultSort: { key: 'rank', dir: 'asc' },
    emptyKey: 'emptyManagerBacklog',
    card: (i) => (
      <div style={{ padding: '36px 14px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontFamily: 'var(--font-mono)', ...muted }}>{i.key}</span>
          <strong>{i.managerRank != null ? `#${i.managerRank}` : '—'}</strong>
        </div>
        <div style={{ color: 'var(--text-primary)', fontWeight: 600, overflowWrap: 'anywhere' }}>{i.title}</div>
        <div>{priorityBadge(i)}</div>
        <BusinessValueBar value={i.businessValue} rationale={i.businessValueRationale} noRationale={l.noRationale} />
        <div style={muted}>{isUnassigned(i) ? l.unassigned : l.owner(i)}{i.dueDate ? ` · ${l.due(i.dueDate)}` : ''}</div>
      </div>
    ),
    columns: [
      {
        key: 'rank', header: l.rank, sortKey: 'rank', width: '72px',
        compare: (a, b) => (a.managerRank ?? Number.MAX_SAFE_INTEGER) - (b.managerRank ?? Number.MAX_SAFE_INTEGER),
        cell: (i) => <strong>{i.managerRank != null ? `#${i.managerRank}` : '—'}</strong>,
      },
      { key: 'key', header: l.key, sortKey: 'key', compare: (a, b) => a.key.localeCompare(b.key), cell: (i) => <span style={{ fontFamily: 'var(--font-mono)' }}>{i.key}</span> },
      { key: 'title', header: l.title, sortKey: 'title', compare: (a, b) => a.title.localeCompare(b.title), cell: (i) => i.title },
      {
        key: 'priority', header: l.priority, sortKey: 'priority',
        compare: (a, b) => (PRIORITY_ORDER[String(a.priority)] ?? 9) - (PRIORITY_ORDER[String(b.priority)] ?? 9),
        cell: priorityBadge,
      },
      {
        key: 'businessValue', header: l.businessValue, sortKey: 'businessValue', width: '160px',
        compare: (a, b) => (a.businessValue ?? -1) - (b.businessValue ?? -1),
        cell: (i) => <BusinessValueBar value={i.businessValue} rationale={i.businessValueRationale} noRationale={l.noRationale} />,
      },
      {
        key: 'dueDate', header: l.dueDate, sortKey: 'dueDate',
        compare: (a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'),
        cell: (i) => (i.dueDate ? l.due(i.dueDate) : '—'),
      },
      { key: 'assignee', header: l.assignee, cell: (i) => (isUnassigned(i) ? l.unassigned : l.owner(i)) },
    ],
  };
}

// ── Manager run tasks (Activity) ───────────────────────────────────────────

type RunStatusKey = 'in_progress' | 'done' | 'blocked' | 'open';
const RUN_TASK_TONE: StatusToneMap<RunStatusKey> = { in_progress: 'accent', done: 'success', blocked: 'warning', open: 'neutral' };
export function runTaskStatusKey(status: string): RunStatusKey {
  if (status === 'in_progress') return 'in_progress';
  if (status === 'done') return 'done';
  if (status === 'blocked') return 'blocked';
  return 'open';
}

export interface RunTaskLabels {
  key: string; status: string; result: string; owner: string; when: string;
  statusLabel: (s: RunStatusKey) => string;
  ownerName: (t: ManagerRunTask) => string;
  systemOwner: string;
  whenText: (t: ManagerRunTask) => string;
}

function RunStatusPill({ status, label }: { status: string; label: string }) {
  const key = runTaskStatusKey(status);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', fontWeight: 600,
      color: statusColor(RUN_TASK_TONE, key), border: `1px solid ${statusColor(RUN_TASK_TONE, key, 'border')}`,
      borderRadius: 'var(--radius-full)', padding: '2px 9px',
    }}>
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
      {label}
    </span>
  );
}

export function managerRunTasksDescriptor(l: RunTaskLabels): CollectionDescriptor<ManagerRunTask> {
  const unowned = (t: ManagerRunTask) => t.assignedUserId == null && t.assignedAgentRef == null && t.assignedAgentHostId == null;
  const owner = (t: ManagerRunTask) => (unowned(t) ? l.systemOwner : l.ownerName(t));
  const stamp = (t: ManagerRunTask) => t.completedAt ?? t.createdAt;
  return {
    entity: null,
    surfaceKey: 'manager.runTasks',
    rowId: (t) => String(t.id),
    label: (t) => t.key,
    defaultSort: { key: 'when', dir: 'desc' },
    emptyKey: 'emptyManagerRunTasks',
    card: (t) => (
      <div style={{ padding: '36px 14px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontFamily: 'var(--font-mono)', ...muted }}>{t.key}</span>
        <RunStatusPill status={t.status} label={l.statusLabel(runTaskStatusKey(t.status))} />
        <div style={{ color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{t.summary || t.title}</div>
        <div style={muted}>{owner(t)} · {l.whenText(t)}</div>
      </div>
    ),
    columns: [
      { key: 'key', header: l.key, sortKey: 'key', compare: (a, b) => a.key.localeCompare(b.key), cell: (t) => <span style={{ fontFamily: 'var(--font-mono)' }}>{t.key}</span> },
      { key: 'status', header: l.status, sortKey: 'status', compare: (a, b) => a.status.localeCompare(b.status), cell: (t) => <RunStatusPill status={t.status} label={l.statusLabel(runTaskStatusKey(t.status))} /> },
      { key: 'result', header: l.result, cell: (t) => t.summary || t.title },
      { key: 'owner', header: l.owner, cell: owner },
      { key: 'when', header: l.when, sortKey: 'when', compare: (a, b) => stamp(a).localeCompare(stamp(b)), cell: (t) => l.whenText(t) },
    ],
  };
}

// ── Activity feed ──────────────────────────────────────────────────────────

export interface ActivityLabels {
  summary: string; type: string; when: string;
  typeLabel: (a: ManagerAction) => string;
  whenText: (a: ManagerAction) => string;
}

function TicketLink({ a }: { a: ManagerAction }): ReactNode {
  if (a.taskId == null) return null;
  return (
    <Link href={ticketHref(a.taskId)} style={{ display: 'inline-block', marginBottom: 3, color: 'var(--accent)', fontSize: '0.78rem', fontWeight: 700, textDecoration: 'none' }}>
      {a.ticketKey ?? `#${a.taskId}`}{a.ticketTitle ? ` · ${a.ticketTitle}` : ''}
    </Link>
  );
}

export function managerActivityDescriptor(l: ActivityLabels): CollectionDescriptor<ManagerAction> {
  const body = (a: ManagerAction) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, whiteSpace: 'normal' }}>
      <span aria-hidden style={{ flexShrink: 0 }}><Icon source={managerActionIcon(a.actionType)} size={18} /></span>
      <div style={{ minWidth: 0 }}>
        <TicketLink a={a} />
        <div style={{ color: 'var(--text-primary)' }}>{a.summary}</div>
        {a.detail && <div style={{ ...muted, marginTop: 2 }}>{a.detail}</div>}
      </div>
    </div>
  );
  return {
    entity: null,
    surfaceKey: 'manager.activity',
    rowId: (a) => a.id,
    label: (a) => a.summary,
    defaultSort: { key: 'when', dir: 'desc' },
    emptyKey: 'emptyManagerActivity',
    card: (a) => (
      <div style={{ padding: '36px 14px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {body(a)}
        <div style={muted}>{l.typeLabel(a)} · {l.whenText(a)}</div>
      </div>
    ),
    columns: [
      { key: 'summary', header: l.summary, cell: body },
      { key: 'type', header: l.type, sortKey: 'type', compare: (a, b) => a.actionType.localeCompare(b.actionType), cell: l.typeLabel },
      { key: 'when', header: l.when, sortKey: 'when', compare: (a, b) => a.createdAt.localeCompare(b.createdAt), cell: l.whenText },
    ],
  };
}

// ── Stuck register ─────────────────────────────────────────────────────────

export interface StallLabels {
  ticket: string; cause: string; doing: string; attempts: string; stuckFor: string;
  causeLabel: (r: StallWatchRow) => string;
  lastTried: (r: StallWatchRow) => string | null;
  needsYou: string;
  attemptsText: (r: StallWatchRow) => string;
  idle: (ms: number) => string;
}

function StallBadge({ label, escalated }: { label: string; escalated: boolean }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 'var(--radius-full)', fontSize: '0.72rem', fontWeight: 700,
      color: escalated ? 'var(--warning-text)' : 'var(--text-muted)',
      background: escalated ? 'var(--warning-bg, rgba(180, 83, 9, 0.12))' : 'var(--bg-base)',
      border: '1px solid var(--border-subtle)', whiteSpace: 'nowrap',
    }}>{label}</span>
  );
}

export function managerStallsDescriptor(l: StallLabels): CollectionDescriptor<StallWatchRow> {
  const ticket = (r: StallWatchRow) => (
    <div style={{ whiteSpace: 'normal' }}>
      <Link href={ticketHref(r.taskId)} style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>{r.title}</Link>
      <div style={{ ...muted, marginTop: 2 }}>{r.status}</div>
    </div>
  );
  const doing = (r: StallWatchRow) => {
    const last = l.lastTried(r);
    return (
      <div style={{ whiteSpace: 'normal', color: 'var(--text-muted)' }}>
        {r.detail}
        {last && <div style={{ ...muted, marginTop: 2 }}>{last}</div>}
      </div>
    );
  };
  const attempts = (r: StallWatchRow) =>
    r.escalatedAt ? <StallBadge label={l.needsYou} escalated /> : <span style={muted}>{l.attemptsText(r)}</span>;
  return {
    entity: null,
    surfaceKey: 'manager.stalls',
    rowId: (r) => String(r.taskId),
    label: (r) => r.title,
    defaultSort: { key: 'stuckFor', dir: 'desc' },
    emptyKey: 'emptyManagerStalls',
    card: (r) => (
      <div style={{ padding: '36px 14px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {ticket(r)}
        <div><StallBadge label={l.causeLabel(r)} escalated={!!r.escalatedAt} /></div>
        {doing(r)}
        <div>{attempts(r)}</div>
        <div style={muted}>{l.stuckFor}: {l.idle(r.idleMs)}</div>
      </div>
    ),
    columns: [
      { key: 'ticket', header: l.ticket, sortKey: 'ticket', compare: (a, b) => a.title.localeCompare(b.title), cell: ticket },
      { key: 'cause', header: l.cause, sortKey: 'cause', compare: (a, b) => a.cause.localeCompare(b.cause), cell: (r) => <StallBadge label={l.causeLabel(r)} escalated={!!r.escalatedAt} /> },
      { key: 'doing', header: l.doing, cell: doing },
      { key: 'attempts', header: l.attempts, sortKey: 'attempts', compare: (a, b) => a.attempts - b.attempts, cell: attempts },
      { key: 'stuckFor', header: l.stuckFor, sortKey: 'stuckFor', compare: (a, b) => a.idleMs - b.idleMs, cell: (r) => l.idle(r.idleMs) },
    ],
  };
}
