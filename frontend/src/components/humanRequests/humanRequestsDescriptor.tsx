import type { CSSProperties } from 'react';
import type { useTranslations } from 'next-intl';
import type { CollectionDescriptor } from '@/components/collection/descriptor';
import type { Formatter } from '@/i18n/format';
import type { Approval, ApprovalStatus, RequestKind } from '@/lib/builderforceApi';
import { ApprovalResolveControl } from './ApprovalResolveControl';

/**
 * The human-request queue as a descriptor for the ONE shared `<Collection>` (PRD 47).
 * Read-only as a collection (`entity: null` — there is no bulk port for requests); the
 * resolve control (approve / reject / answer) and "view ticket" are per-row actions in
 * the cells and card bodies.
 */

type T = ReturnType<typeof useTranslations>;

export interface HumanRequestRowContext {
  t: T;
  fmt: Formatter;
  /** Agent-host display name for a row (or '-'). */
  agentHostLabel: (row: Approval) => string;
  onViewTicket: (taskId: number) => void;
  onResolved: () => void;
  /** Card-first, single-column surface (a drawer / widget). */
  compact: boolean;
}

function statusClass(status: ApprovalStatus): string {
  switch (status) {
    case 'pending': return 'badge-yellow';
    case 'approved': return 'badge-green';
    case 'rejected': return 'badge-red';
    case 'answered': return 'badge-blue';
    default: return 'badge-muted'; // expired
  }
}

function kindClass(kind: RequestKind): string {
  switch (kind) {
    case 'question': return 'badge-blue';
    case 'feedback': return 'badge-gray';
    default: return 'badge-muted'; // approval
  }
}

const label: CSSProperties = { fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 };
const value: CSSProperties = { fontSize: 12, color: 'var(--text-primary)', overflowWrap: 'anywhere' };
const clip = (maxWidth: number): CSSProperties => ({ maxWidth, overflow: 'hidden', textOverflow: 'ellipsis' });
const byText = (pick: (r: Approval) => string | null) => (a: Approval, b: Approval) => (pick(a) ?? '').localeCompare(pick(b) ?? '');

export function humanRequestsDescriptor({ t, fmt, agentHostLabel, onViewTicket, onResolved, compact }: HumanRequestRowContext): CollectionDescriptor<Approval> {
  /** Resolution summary for a non-pending row. */
  const resolutionText = (row: Approval): string => {
    if (row.status === 'answered') return `${row.reviewedBy ?? t('human')}: ${row.responseText ?? ''}`;
    if (row.reviewedBy) return `${row.reviewedBy}${row.reviewNote ? `: ${row.reviewNote}` : ''}`;
    return '-';
  };
  const kind = (row: Approval) => <span className={kindClass(row.kind)} style={{ flexShrink: 0 }}>{t(`kind.${row.kind}`)}</span>;
  const status = (row: Approval) => <span className={statusClass(row.status)} style={{ flexShrink: 0 }}>{t(`status.${row.status}`)}</span>;
  const viewTicket = (row: Approval) =>
    row.taskId != null ? (
      <button type="button" className="btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => onViewTicket(row.taskId as number)}>
        {t('viewTicket')}
      </button>
    ) : null;
  const resolve = (row: Approval) => <ApprovalResolveControl approval={row} compact={compact} onResolved={onResolved} />;

  return {
    entity: null,
    surfaceKey: compact ? 'workforce.humanRequests.compact' : 'workforce.humanRequests',
    rowId: (r) => r.id,
    label: (r) => r.actionType,
    defaultView: compact ? 'card' : 'table',
    defaultSort: { key: 'requested', dir: 'desc' },
    emptyKey: 'emptyHumanRequests',
    columns: [
      { key: 'kind', header: t('column.kind'), compare: byText((r) => r.kind), cell: kind },
      { key: 'status', header: t('column.status'), compare: byText((r) => r.status), cell: status },
      { key: 'action', header: t('column.action'), compare: byText((r) => r.actionType), cell: (r) => <span style={{ whiteSpace: 'nowrap' }}>{r.actionType}</span> },
      { key: 'description', header: t('column.description'), cell: (r) => <span title={r.description} style={{ ...clip(320), display: 'inline-block' }}>{r.description}</span> },
      { key: 'item', header: t('column.item'), cell: (r) => viewTicket(r) ?? <span className="text-muted">-</span> },
      { key: 'agentHost', header: t('column.agentHost'), compare: byText(agentHostLabel), cell: agentHostLabel },
      { key: 'requested', header: t('column.requested'), compare: byText((r) => r.createdAt), cell: (r) => <span className="text-muted" style={{ whiteSpace: 'nowrap' }}>{fmt.dateTime(r.createdAt)}</span> },
      {
        key: 'resolution',
        header: t('column.resolution'),
        cell: (r) => (
          <span className="text-muted" title={resolutionText(r)} style={{ ...clip(260), display: 'inline-block' }}>
            {r.status === 'pending' ? '-' : resolutionText(r)}
          </span>
        ),
      },
      {
        key: 'resolve',
        header: t('column.resolve'),
        cell: (r) => (r.status === 'pending' ? <div style={{ minWidth: 220 }}>{resolve(r)}</div> : <span className="text-muted">-</span>),
      },
    ],
    card: (row) => (
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            {kind(row)}
            <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {row.actionType}
            </span>
          </span>
          {status(row)}
        </div>

        <div style={{ fontSize: 13, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{row.description}</div>

        {viewTicket(row)}

        {row.status !== 'pending' && row.status !== 'expired' && (
          <div style={{ ...value, background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '8px 10px' }}>
            <div style={label}>{row.status === 'answered' ? t('column.answer') : t('column.resolution')}</div>
            {resolutionText(row)}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[
            { key: 'agentHost', label: t('column.agentHost'), value: agentHostLabel(row) },
            { key: 'requestedBy', label: t('column.requestedBy'), value: row.requestedBy ?? '-' },
            { key: 'requested', label: t('column.requested'), value: fmt.dateTime(row.createdAt) },
            { key: 'expires', label: t('column.expires'), value: fmt.dateTime(row.expiresAt) },
          ].map((field) => (
            <div key={field.key} style={{ minWidth: 0 }}>
              <div style={label}>{field.label}</div>
              <div style={value}>{field.value}</div>
            </div>
          ))}
        </div>

        {row.status === 'pending' ? (
          <div style={{ marginTop: 2 }}>{resolve(row)}</div>
        ) : (
          <span className="text-muted" style={{ fontSize: 12 }}>{t('noActions')}</span>
        )}
      </div>
    ),
  };
}
