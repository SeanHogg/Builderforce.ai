import type { CSSProperties, ReactNode } from 'react';
import type { useTranslations } from 'next-intl';
import { RoleGate } from '@/components/RoleGate';
import type { CollectionDescriptor } from '@/components/collection/descriptor';
import type { Formatter } from '@/i18n/format';
import type { GovernedMemory, Lease, Rehearsal, RehearsalComparison, RehearsalKind, RehearsalStep, WorkspaceNote } from '@/lib/agentOpsApi';
import { button, chip, mono, muted } from './agentOpsStyles';

/**
 * The Agent Ops record lists — leases, workspace notes, governed memories, rehearsals,
 * a rehearsal's suppressed steps and a comparison's per-operation deltas — as
 * descriptors for the ONE shared `<Collection>` (PRD 47). Every list is an in-memory,
 * read-only catalog (`entity: null`): the row actions (force release, forget, compare,
 * report) live in the cells and card bodies, never in a bulk bar.
 */

type T = ReturnType<typeof useTranslations>;

const cardBody: CSSProperties = { padding: 12, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 };
const cardRow: CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' };
const strong: CSSProperties = { fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', overflowWrap: 'anywhere' };
const byText = <Row,>(pick: (r: Row) => string | null | undefined) => (a: Row, b: Row) => (pick(a) ?? '').localeCompare(pick(b) ?? '');
const byNumber = <Row,>(pick: (r: Row) => number) => (a: Row, b: Row) => pick(a) - pick(b);

// ── Coordination ────────────────────────────────────────────────────────────────

export function leasesDescriptor(t: T, onRelease: (lease: Lease) => void): CollectionDescriptor<Lease> {
  const mode = (l: Lease) => (
    <span style={chip(l.mode === 'exclusive' ? 'warn' : 'neutral')}>
      {l.mode === 'exclusive' ? t('coordination.exclusive') : t('coordination.shared')}
    </span>
  );
  const release = (l: Lease) => (
    <RoleGate capability="agents.manage">
      <button type="button" style={button('danger')} onClick={() => onRelease(l)}>
        {t('coordination.release')}
      </button>
    </RoleGate>
  );
  return {
    entity: null,
    surfaceKey: 'agentOps.coordination.leases',
    rowId: (l) => l.resource,
    label: (l) => l.resource,
    defaultView: 'table',
    defaultSort: { key: 'resource', dir: 'asc' },
    emptyKey: 'empty',
    columns: [
      { key: 'resource', header: t('coordination.resource'), compare: byText((l) => l.resource), cell: (l) => <span style={mono}>{l.resource}</span> },
      { key: 'holder', header: t('coordination.holder'), compare: byText((l) => l.holder), cell: (l) => l.holder },
      { key: 'mode', header: t('coordination.mode'), compare: byText((l) => l.mode), cell: mode },
      { key: 'reason', header: t('coordination.reason'), cell: (l) => l.reason ?? '—' },
      { key: 'actions', header: '', align: 'end', cell: release },
    ],
    card: (l) => (
      <div style={cardBody}>
        <span style={{ ...mono, ...strong }}>{l.resource}</span>
        <div style={cardRow}>
          <span style={chip('accent')}>{l.holder}</span>
          {mode(l)}
        </div>
        {l.reason && <p style={muted}>{l.reason}</p>}
        <div>{release(l)}</div>
      </div>
    ),
  };
}

export function notesDescriptor(t: T, fmt: Formatter): CollectionDescriptor<WorkspaceNote> {
  return {
    entity: null,
    surfaceKey: 'agentOps.coordination.notes',
    rowId: (n) => n.key,
    label: (n) => n.key,
    defaultView: 'card',
    defaultSort: { key: 'updated', dir: 'desc' },
    emptyKey: 'empty',
    columns: [
      { key: 'key', header: t('coordination.noteKey'), compare: byText((n) => n.key), cell: (n) => <strong style={strong}>{n.key}</strong> },
      { key: 'author', header: t('coordination.noteAuthor'), compare: byText((n) => n.author), cell: (n) => <span style={chip('accent')}>{n.author}</span> },
      { key: 'updated', header: t('coordination.noteUpdated'), compare: byText((n) => n.updatedAt), cell: (n) => fmt.dateTime(n.updatedAt) },
      { key: 'content', header: t('coordination.noteContent'), cell: (n) => <span style={{ whiteSpace: 'normal' }}>{n.content}</span> },
    ],
    card: (n) => (
      <div style={cardBody}>
        <div style={cardRow}>
          <strong style={strong}>{n.key}</strong>
          <span style={chip('accent')}>{n.author}</span>
        </div>
        <span style={muted}>{fmt.dateTime(n.updatedAt)}</span>
        <p style={{ ...muted, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{n.content}</p>
      </div>
    ),
  };
}

// ── Memory ──────────────────────────────────────────────────────────────────────

export function memoriesDescriptor(
  t: T,
  fmt: Formatter,
  hasLapsed: (m: GovernedMemory) => boolean,
  onForget: (m: GovernedMemory) => void,
): CollectionDescriptor<GovernedMemory> {
  const scopeLabel = (m: GovernedMemory): string =>
    m.scope === 'tenant' ? t('memory.scopeTenant') : m.scope === 'project' ? t('memory.scopeProject') : t('memory.scopeTicket', { id: m.scopeId });
  const scope = (m: GovernedMemory) => <span style={chip(m.scope === 'tenant' ? 'neutral' : 'accent')}>{scopeLabel(m)}</span>;
  const origin = (m: GovernedMemory) => (
    <>
      <span style={chip()}>{m.origin}</span>
      {m.originExecutionId != null && <div style={muted}>{t('memory.fromRun', { id: m.originExecutionId })}</div>}
    </>
  );
  const expiry = (m: GovernedMemory) => {
    if (m.expiresAt == null) return <span style={muted}>{t('memory.durable')}</span>;
    const lapsed = hasLapsed(m);
    return <span style={chip(lapsed ? 'warn' : 'good')}>{lapsed ? t('memory.lapsed') : fmt.date(m.expiresAt)}</span>;
  };
  const forget = (m: GovernedMemory) => (
    <RoleGate capability="facts.manage">
      <button type="button" style={button('danger')} onClick={() => onForget(m)}>
        {t('memory.forget')}
      </button>
    </RoleGate>
  );
  return {
    entity: null,
    surfaceKey: 'agentOps.memory',
    rowId: (m) => `${m.scope}:${m.scopeId}:${m.key}`,
    label: (m) => m.key,
    defaultView: 'table',
    defaultSort: { key: 'key', dir: 'asc' },
    emptyKey: 'empty',
    columns: [
      { key: 'key', header: t('memory.key'), compare: byText((m) => m.key), cell: (m) => <span style={mono}>{m.key}</span> },
      { key: 'fact', header: t('memory.fact'), cell: (m) => <span style={{ whiteSpace: 'normal' }}>{m.content}</span> },
      { key: 'scope', header: t('memory.scope'), compare: byText(scopeLabel), cell: scope },
      { key: 'origin', header: t('memory.origin'), compare: byText((m) => m.origin), cell: origin },
      { key: 'expiry', header: t('memory.expiry'), compare: byText((m) => m.expiresAt ?? '￿'), cell: expiry },
      { key: 'actions', header: '', align: 'end', cell: forget },
    ],
    card: (m) => (
      <div style={cardBody}>
        <span style={{ ...mono, ...strong }}>{m.key}</span>
        <p style={{ ...muted, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{m.content}</p>
        <div style={cardRow}>
          {scope(m)}
          {origin(m)}
          {expiry(m)}
        </div>
        <div>{forget(m)}</div>
      </div>
    ),
  };
}

// ── Rehearsal ───────────────────────────────────────────────────────────────────

export function rehearsalKindLabel(t: T, k: RehearsalKind): string {
  return k === 'replay' ? t('rehearsal.kindReplay') : k === 'trial' ? t('rehearsal.kindTrial') : t('rehearsal.kindDryRun');
}

export interface RehearsalRowActions {
  isCompared: (id: string) => boolean;
  onToggleCompare: (id: string) => void;
  onOpenReport: (id: string) => void;
}

export function rehearsalsDescriptor(t: T, fmt: Formatter, actions: RehearsalRowActions): CollectionDescriptor<Rehearsal> {
  const ticket = (r: Rehearsal) => (r.taskId ? `#${r.taskId} ${r.taskTitle ?? ''}` : '—');
  const writes = (r: Rehearsal) => (
    <span>
      <strong>{r.suppressedWrites}</strong>
      <span style={muted}> / {t('rehearsal.stepCount', { count: r.steps })}</span>
    </span>
  );
  const outcome = (r: Rehearsal) =>
    r.status === 'failed' ? (
      <span style={chip('warn')}>{t('rehearsal.failed')}</span>
    ) : r.finishedOk ? (
      <span style={chip('good')}>{t('rehearsal.finished')}</span>
    ) : (
      <span style={chip()}>{t('rehearsal.unfinished')}</span>
    );
  const rowActions = (r: Rehearsal): ReactNode => {
    const picked = actions.isCompared(r.id);
    return (
      <div style={{ ...cardRow, justifyContent: 'flex-end' }}>
        <button type="button" style={button(picked ? 'primary' : 'ghost')} aria-pressed={picked} onClick={() => actions.onToggleCompare(r.id)}>
          {picked ? t('rehearsal.selected') : t('rehearsal.selectCompare')}
        </button>
        <button type="button" style={button()} onClick={() => actions.onOpenReport(r.id)}>
          {t('rehearsal.viewReport')}
        </button>
      </div>
    );
  };
  return {
    entity: null,
    surfaceKey: 'agentOps.rehearsals',
    rowId: (r) => r.id,
    label: (r) => `${rehearsalKindLabel(t, r.kind)} ${ticket(r)}`,
    defaultView: 'table',
    defaultSort: { key: 'created', dir: 'desc' },
    emptyKey: 'empty',
    columns: [
      { key: 'kind', header: t('rehearsal.kind'), compare: byText((r) => rehearsalKindLabel(t, r.kind)), cell: (r) => <span style={chip('accent')}>{rehearsalKindLabel(t, r.kind)}</span> },
      { key: 'ticket', header: t('rehearsal.ticket'), compare: byNumber((r) => r.taskId ?? 0), cell: ticket },
      { key: 'agent', header: t('rehearsal.agent'), compare: byText((r) => r.agentLabel), cell: (r) => r.agentLabel },
      { key: 'writes', header: t('rehearsal.wouldWrite'), compare: byNumber((r) => r.suppressedWrites), cell: writes },
      { key: 'outcome', header: t('rehearsal.outcome'), compare: byText((r) => r.status), cell: outcome },
      { key: 'created', header: t('rehearsal.created'), compare: byText((r) => r.createdAt), cell: (r) => fmt.dateTime(r.createdAt) },
      { key: 'actions', header: '', align: 'end', cell: rowActions },
    ],
    card: (r) => (
      <div style={cardBody}>
        <div style={cardRow}>
          <span style={chip('accent')}>{rehearsalKindLabel(t, r.kind)}</span>
          {outcome(r)}
        </div>
        <span style={strong}>{ticket(r)}</span>
        <span style={muted}>{r.agentLabel} · {fmt.dateTime(r.createdAt)}</span>
        <div style={muted}>{t('rehearsal.wouldWrite')}: {writes(r)}</div>
        {rowActions(r)}
      </div>
    ),
  };
}

export function rehearsalStepsDescriptor(t: T): CollectionDescriptor<RehearsalStep> {
  const op = (s: RehearsalStep) => <span style={chip('accent')}>{s.op}</span>;
  const target = (s: RehearsalStep) => <span style={mono}>{s.target ?? '—'}</span>;
  return {
    entity: null,
    surfaceKey: 'agentOps.rehearsal.steps',
    rowId: (s) => String(s.seq),
    label: (s) => `${s.op} ${s.target ?? ''}`,
    defaultView: 'table',
    defaultSort: { key: 'step', dir: 'asc' },
    emptyKey: 'empty',
    columns: [
      { key: 'step', header: t('rehearsal.step'), compare: byNumber((s) => s.seq), cell: (s) => s.seq },
      { key: 'operation', header: t('rehearsal.operation'), compare: byText((s) => s.op), cell: op },
      { key: 'target', header: t('rehearsal.target'), compare: byText((s) => s.target), cell: target },
    ],
    card: (s) => (
      <div style={cardBody}>
        <div style={cardRow}>
          <span style={muted}>{t('rehearsal.step')} {s.seq}</span>
          {op(s)}
        </div>
        {target(s)}
      </div>
    ),
  };
}

type ComparedOperation = RehearsalComparison['operations'][number];

export function comparisonDescriptor(t: T): CollectionDescriptor<ComparedOperation> {
  const delta = (o: ComparedOperation) => (o.delta > 0 ? `+${o.delta}` : String(o.delta));
  return {
    entity: null,
    surfaceKey: 'agentOps.rehearsal.comparison',
    rowId: (o) => o.op,
    label: (o) => o.op,
    defaultView: 'table',
    defaultSort: { key: 'operation', dir: 'asc' },
    emptyKey: 'empty',
    columns: [
      { key: 'operation', header: t('rehearsal.operation'), compare: byText((o) => o.op), cell: (o) => <span style={mono}>{o.op}</span> },
      { key: 'baseline', header: t('rehearsal.baseline'), compare: byNumber((o) => o.left), cell: (o) => o.left },
      { key: 'candidate', header: t('rehearsal.candidate'), compare: byNumber((o) => o.right), cell: (o) => o.right },
      { key: 'delta', header: t('rehearsal.delta'), compare: byNumber((o) => o.delta), cell: delta },
    ],
    card: (o) => (
      <div style={cardBody}>
        <span style={{ ...mono, ...strong }}>{o.op}</span>
        <div style={cardRow}>
          <span style={muted}>{t('rehearsal.baseline')}: {o.left}</span>
          <span style={muted}>{t('rehearsal.candidate')}: {o.right}</span>
          <span style={chip(o.delta === 0 ? 'neutral' : 'accent')}>{t('rehearsal.delta')}: {delta(o)}</span>
        </div>
      </div>
    ),
  };
}
