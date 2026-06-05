'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { approvalsApi, agentHosts, type Approval, type ApprovalStatus, type AgentHost } from '@/lib/builderforceApi';
import { ViewToggle, type ViewMode } from '@/components/ViewToggle';

const STATUS_OPTIONS: Array<{ value: '' | ApprovalStatus; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'expired', label: 'Expired' },
];

function fmtDate(value?: string | null): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function statusClass(status: ApprovalStatus): string {
  if (status === 'pending') return 'badge badge-neutral';
  if (status === 'approved') return 'badge badge-success';
  if (status === 'rejected') return 'badge badge-danger';
  return 'badge badge-neutral';
}

export default function ApprovalsPage() {
  const router = useRouter();
  const { isAuthenticated, hasTenant } = useAuth();

  const [rows, setRows] = useState<Approval[]>([]);
  const [agentHostList, setAgentHostList] = useState<AgentHost[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'' | ApprovalStatus>('pending');
  const [agentHostId, setAgentHostId] = useState<string>('');
  const [query, setQuery] = useState<string>('');
  const [viewMode, setViewMode] = useState<ViewMode>('table');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [approvals, agentHostsData] = await Promise.all([
        approvalsApi.list({
          status: status || undefined,
          agentHostId: agentHostId ? Number(agentHostId) : undefined,
        }),
        agentHosts.list().catch(() => [] as AgentHost[]),
      ]);
      setRows(approvals);
      setAgentHostList(agentHostsData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load approvals');
    } finally {
      setLoading(false);
    }
  }, [status, agentHostId]);

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login?next=/approvals');
      return;
    }
    if (!hasTenant) {
      router.replace('/tenants?next=/approvals');
      return;
    }
    void load();
  }, [isAuthenticated, hasTenant, router, load]);

  const agentHostNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const agentHost of agentHostList) map.set(agentHost.id, agentHost.name);
    return map;
  }, [agentHostList]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      return (
        r.id.toLowerCase().includes(q) ||
        r.actionType.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        (r.requestedBy ?? '').toLowerCase().includes(q) ||
        (r.reviewedBy ?? '').toLowerCase().includes(q)
      );
    });
  }, [rows, query]);

  const decide = async (row: Approval, decision: 'approved' | 'rejected') => {
    setBusyId(row.id);
    setError(null);
    try {
      await approvalsApi.decide(row.id, { status: decision });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update approval');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ flex: 1, color: 'var(--text-primary)' }}>
      <main className="max-w-6xl mx-auto px-4 py-5">
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 4 }}>Approvals</h1>
            <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
              Review pending high-risk actions requested by agentHosts and approve or reject them.
            </p>
          </div>
          <ViewToggle value={viewMode} onChange={setViewMode} />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <select
            className="admin-select"
            value={status}
            onChange={(e) => setStatus(e.target.value as '' | ApprovalStatus)}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value || 'all'} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <select
            className="admin-select"
            value={agentHostId}
            onChange={(e) => setAgentHostId(e.target.value)}
          >
            <option value="">All agentHosts</option>
            {agentHostList.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </select>

          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search id, action, description"
            className="admin-select"
            style={{ minWidth: 220 }}
          />

          <button type="button" className="btn-ghost" onClick={() => void load()} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {error && (
          <div
            style={{
              marginBottom: 12,
              padding: '10px 12px',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              background: 'var(--surface-rose-soft)',
              color: 'var(--text-primary)',
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        {viewMode === 'table' ? (
        <div className="table-wrap">
          <table className="data-table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th>Status</th>
                <th>Action</th>
                <th>Description</th>
                <th>AgentHost</th>
                <th>Requested By</th>
                <th>Requested</th>
                <th>Expires</th>
                <th>Decision</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="text-muted">Loading approvals...</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-muted">No approvals found</td>
                </tr>
              ) : (
                filtered.map((row) => {
                  const isPending = row.status === 'pending';
                  const busy = busyId === row.id;
                  return (
                    <tr key={row.id}>
                      <td>
                        <span className={statusClass(row.status)}>{row.status}</span>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{row.actionType}</td>
                      <td title={row.description} style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {row.description}
                      </td>
                      <td>{row.agentHostId != null ? agentHostNameById.get(row.agentHostId) ?? `#${row.agentHostId}` : '-'}</td>
                      <td>{row.requestedBy ?? '-'}</td>
                      <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{fmtDate(row.createdAt)}</td>
                      <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{fmtDate(row.expiresAt)}</td>
                      <td className="text-muted" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {row.reviewedBy ? `${row.reviewedBy}${row.reviewNote ? `: ${row.reviewNote}` : ''}` : '-'}
                      </td>
                      <td>
                        {isPending ? (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="btn-ghost"
                              disabled={busy}
                              onClick={() => void decide(row, 'approved')}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="btn-ghost"
                              disabled={busy}
                              onClick={() => void decide(row, 'rejected')}
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        ) : (
          loading ? (
            <div className="text-muted" style={{ fontSize: 13, padding: '16px 0' }}>Loading approvals...</div>
          ) : filtered.length === 0 ? (
            <div className="text-muted" style={{ fontSize: 13, padding: '16px 0' }}>No approvals found</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
              {filtered.map((row) => {
                const isPending = row.status === 'pending';
                const busy = busyId === row.id;
                return (
                  <div
                    key={row.id}
                    style={{
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 12,
                      padding: 18,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14, wordBreak: 'break-word' }}>
                        {row.actionType}
                      </span>
                      <span className={statusClass(row.status)} style={{ flexShrink: 0 }}>{row.status}</span>
                    </div>

                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>
                      {row.description}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      {[
                        { label: 'AgentHost', value: row.agentHostId != null ? agentHostNameById.get(row.agentHostId) ?? `#${row.agentHostId}` : '-' },
                        { label: 'Requested By', value: row.requestedBy ?? '-' },
                        { label: 'Requested', value: fmtDate(row.createdAt) },
                        { label: 'Expires', value: fmtDate(row.expiresAt) },
                        { label: 'Decision', value: row.reviewedBy ? `${row.reviewedBy}${row.reviewNote ? `: ${row.reviewNote}` : ''}` : '-' },
                      ].map(({ label, value }) => (
                        <div key={label}>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{value}</div>
                        </div>
                      ))}
                    </div>

                    {isPending ? (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                        <button
                          type="button"
                          className="btn-ghost"
                          disabled={busy}
                          onClick={() => void decide(row, 'approved')}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="btn-ghost"
                          disabled={busy}
                          onClick={() => void decide(row, 'rejected')}
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <span className="text-muted" style={{ fontSize: 12 }}>No actions available</span>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}
      </main>
    </div>
  );
}
