'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { approvalsApi, agentHosts, type Approval, type ApprovalStatus, type RequestKind, type AgentHost } from '@/lib/builderforceApi';
import { ViewToggle, type ViewMode } from '@/components/ViewToggle';

/**
 * Human-in-the-loop request queue — the portal side of the agent's `ask_human`
 * tool. Lists every request an agent has bubbled up (approvals, questions,
 * feedback) and lets a person resolve it: approve/reject an action, or answer a
 * question/feedback with free text. Resolving a request unblocks the agent that
 * is waiting on it.
 *
 * Fully reusable / self-contained: it owns its own fetch, filters, and resolve
 * calls, takes no required props, and renders no page chrome — so it drops into
 * the Workforce tab, an agent-host detail panel, a dashboard widget, or a task
 * drawer. Layout-only; auth/tenant gating is the surrounding shell's job.
 */

type KindFilter = '' | RequestKind;
type StatusFilter = '' | ApprovalStatus;

const KIND_OPTIONS: Array<{ value: KindFilter; label: string }> = [
  { value: '', label: 'All kinds' },
  { value: 'approval', label: 'Approvals' },
  { value: 'question', label: 'Questions' },
  { value: 'feedback', label: 'Feedback' },
];

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'answered', label: 'Answered' },
  { value: 'expired', label: 'Expired' },
];

const KIND_LABEL: Record<RequestKind, string> = {
  approval: 'Approval',
  question: 'Question',
  feedback: 'Feedback',
};

function isAnswerable(kind: RequestKind): boolean {
  return kind === 'question' || kind === 'feedback';
}

function fmtDate(value?: string | null): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
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

export interface HumanRequestsViewProps {
  /** Preselect (and hide) the kind filter — e.g. a Questions-only widget. */
  defaultKind?: KindFilter;
  /** Initial status filter. Defaults to 'pending'. */
  defaultStatus?: StatusFilter;
  /** Lock the queue to a single agent host and hide the host filter. */
  lockedAgentHostId?: number;
  /** Denser layout for embedding in a panel/drawer (hides view toggle + search). */
  compact?: boolean;
  /** Fired after each load with the number of pending requests in view. */
  onPendingCountChange?: (count: number) => void;
}

export function HumanRequestsView({
  defaultKind = '',
  defaultStatus = 'pending',
  lockedAgentHostId,
  compact = false,
  onPendingCountChange,
}: HumanRequestsViewProps = {}) {
  const [rows, setRows] = useState<Approval[]>([]);
  const [agentHostList, setAgentHostList] = useState<AgentHost[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<KindFilter>(defaultKind);
  const [status, setStatus] = useState<StatusFilter>(defaultStatus);
  const [agentHostId, setAgentHostId] = useState<string>(lockedAgentHostId != null ? String(lockedAgentHostId) : '');
  const [query, setQuery] = useState<string>('');
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  // Per-request answer drafts (questions/feedback), keyed by request id.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [approvals, agentHostsData] = await Promise.all([
        approvalsApi.list({
          status: status || undefined,
          agentHostId: agentHostId ? Number(agentHostId) : undefined,
        }),
        lockedAgentHostId != null ? Promise.resolve([] as AgentHost[]) : agentHosts.list().catch(() => [] as AgentHost[]),
      ]);
      setRows(approvals);
      if (lockedAgentHostId == null) setAgentHostList(agentHostsData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load requests');
    } finally {
      setLoading(false);
    }
  }, [status, agentHostId, lockedAgentHostId]);

  useEffect(() => {
    void load();
  }, [load]);

  const agentHostNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const agentHost of agentHostList) map.set(agentHost.id, agentHost.name);
    return map;
  }, [agentHostList]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (kind && r.kind !== kind) return false;
      if (!q) return true;
      return (
        r.id.toLowerCase().includes(q) ||
        r.actionType.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        (r.requestedBy ?? '').toLowerCase().includes(q) ||
        (r.reviewedBy ?? '').toLowerCase().includes(q) ||
        (r.responseText ?? '').toLowerCase().includes(q)
      );
    });
  }, [rows, query, kind]);

  // Report the pending count in view so a host page/widget can badge it.
  useEffect(() => {
    onPendingCountChange?.(filtered.filter((r) => r.status === 'pending').length);
  }, [filtered, onPendingCountChange]);

  const decide = async (row: Approval, decision: 'approved' | 'rejected') => {
    setBusyId(row.id);
    setError(null);
    try {
      await approvalsApi.decide(row.id, { status: decision });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update request');
    } finally {
      setBusyId(null);
    }
  };

  const submitAnswer = async (row: Approval) => {
    const text = (drafts[row.id] ?? '').trim();
    if (!text) return;
    setBusyId(row.id);
    setError(null);
    try {
      await approvalsApi.decide(row.id, { status: 'answered', responseText: text });
      setDrafts((d) => { const next = { ...d }; delete next[row.id]; return next; });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit answer');
    } finally {
      setBusyId(null);
    }
  };

  /** Resolve controls for a pending row — approve/reject for actions, answer box for Q&A. */
  const renderResolveControls = (row: Approval) => {
    const busy = busyId === row.id;
    if (isAnswerable(row.kind)) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <textarea
            value={drafts[row.id] ?? ''}
            onChange={(e) => setDrafts((d) => ({ ...d, [row.id]: e.target.value }))}
            placeholder={row.kind === 'feedback' ? 'Write feedback…' : 'Write an answer…'}
            rows={compact ? 2 : 3}
            className="admin-select"
            style={{ minWidth: 200, width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
          />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn-ghost"
              disabled={busy || !(drafts[row.id] ?? '').trim()}
              onClick={() => void submitAnswer(row)}
            >
              {busy ? 'Sending…' : 'Send answer'}
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={() => void decide(row, 'rejected')}
            >
              Dismiss
            </button>
          </div>
        </div>
      );
    }
    return (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => void decide(row, 'approved')}>Approve</button>
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => void decide(row, 'rejected')}>Reject</button>
      </div>
    );
  };

  /** Resolution summary for a non-pending row. */
  const resolutionText = (row: Approval): string => {
    if (row.status === 'answered') {
      return `${row.reviewedBy ?? 'human'}: ${row.responseText ?? ''}`;
    }
    if (row.reviewedBy) {
      return `${row.reviewedBy}${row.reviewNote ? `: ${row.reviewNote}` : ''}`;
    }
    return '-';
  };

  const emptyText = 'No requests found';

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
          Approvals, questions, and feedback your agents have escalated for a human. Resolving a request unblocks the waiting agent.
        </p>
        {!compact && <ViewToggle value={viewMode} onChange={setViewMode} />}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {!defaultKind && (
          <select className="admin-select" value={kind} onChange={(e) => setKind(e.target.value as KindFilter)}>
            {KIND_OPTIONS.map((opt) => (
              <option key={opt.value || 'all'} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        )}

        <select className="admin-select" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value || 'all'} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        {lockedAgentHostId == null && (
          <select className="admin-select" value={agentHostId} onChange={(e) => setAgentHostId(e.target.value)}>
            <option value="">All agentHosts</option>
            {agentHostList.map((c) => (
              <option key={c.id} value={String(c.id)}>{c.name}</option>
            ))}
          </select>
        )}

        {!compact && (
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search action, description, answer"
            className="admin-select"
            style={{ minWidth: 220 }}
          />
        )}

        <button type="button" className="btn-ghost" onClick={() => void load()} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div
          style={{
            marginBottom: 12, padding: '10px 12px',
            border: '1px solid var(--border-subtle)', borderRadius: 8,
            background: 'var(--surface-rose-soft)', color: 'var(--text-primary)', fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {viewMode === 'table' && !compact ? (
        <div className="table-wrap">
          <table className="data-table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th>Kind</th>
                <th>Status</th>
                <th>Action</th>
                <th>Description</th>
                <th>AgentHost</th>
                <th>Requested</th>
                <th>Resolution</th>
                <th>Resolve</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-muted">Loading requests...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="text-muted">{emptyText}</td></tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.id}>
                    <td><span className={kindClass(row.kind)}>{KIND_LABEL[row.kind]}</span></td>
                    <td><span className={statusClass(row.status)}>{row.status}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{row.actionType}</td>
                    <td title={row.description} style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.description}</td>
                    <td>{row.agentHostId != null ? agentHostNameById.get(row.agentHostId) ?? `#${row.agentHostId}` : '-'}</td>
                    <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{fmtDate(row.createdAt)}</td>
                    <td className="text-muted" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }} title={resolutionText(row)}>
                      {row.status === 'pending' ? '-' : resolutionText(row)}
                    </td>
                    <td style={{ minWidth: 220 }}>
                      {row.status === 'pending' ? renderResolveControls(row) : <span className="text-muted">-</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        loading ? (
          <div className="text-muted" style={{ fontSize: 13, padding: '16px 0' }}>Loading requests...</div>
        ) : filtered.length === 0 ? (
          <div className="text-muted" style={{ fontSize: 13, padding: '16px 0' }}>{emptyText}</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {filtered.map((row) => (
              <div
                key={row.id}
                style={{
                  background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                  borderRadius: 12, padding: 18, display: 'flex', flexDirection: 'column', gap: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <span className={kindClass(row.kind)} style={{ flexShrink: 0 }}>{KIND_LABEL[row.kind]}</span>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.actionType}
                    </span>
                  </span>
                  <span className={statusClass(row.status)} style={{ flexShrink: 0 }}>{row.status}</span>
                </div>

                <div style={{ fontSize: 13, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{row.description}</div>

                {row.status !== 'pending' && row.status !== 'expired' && (
                  <div style={{ fontSize: 12, color: 'var(--text-primary)', background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '8px 10px', overflowWrap: 'anywhere' }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>{row.status === 'answered' ? 'Answer' : 'Resolution'}</div>
                    {resolutionText(row)}
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[
                    { label: 'AgentHost', value: row.agentHostId != null ? agentHostNameById.get(row.agentHostId) ?? `#${row.agentHostId}` : '-' },
                    { label: 'Requested By', value: row.requestedBy ?? '-' },
                    { label: 'Requested', value: fmtDate(row.createdAt) },
                    { label: 'Expires', value: fmtDate(row.expiresAt) },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{value}</div>
                    </div>
                  ))}
                </div>

                {row.status === 'pending' ? (
                  <div style={{ marginTop: 2 }}>{renderResolveControls(row)}</div>
                ) : (
                  <span className="text-muted" style={{ fontSize: 12 }}>No actions available</span>
                )}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
