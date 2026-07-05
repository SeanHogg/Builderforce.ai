'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminApi, type ImpersonationSession } from '@/lib/adminApi';
import { AdminError, AdminLoading, errText, fmtDateTime } from '@/components/admin/adminShared';

export default function ImpersonationSessionsPanel() {
  const [impSessions, setImpSessions] = useState<ImpersonationSession[]>([]);
  const [impSessionsTotal, setImpSessionsTotal] = useState(0);
  const [impSessionsOffset, setImpSessionsOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    setLoading(true);
    setError('');
    adminApi
      .impersonationList({ limit: 50, offset: impSessionsOffset })
      .then((r) => {
        setImpSessions(r.sessions);
        setImpSessionsTotal(r.total);
      })
      .catch((e) => setError(errText(e)))
      .finally(() => setLoading(false));
  }, [impSessionsOffset]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (loading && impSessions.length === 0) return <AdminLoading />;

  return (
    <div>
      <AdminError message={error} />
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 className="page-title" style={{ fontSize: 18, margin: 0 }}>
          Impersonation Sessions
          <span style={{ marginLeft: 8, fontSize: 13, fontWeight: 400, color: 'var(--text-muted)' }}>{impSessionsTotal} total</span>
        </h2>
        <button type="button" className="admin-tab" onClick={reload}>↻ Refresh</button>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Target</th>
            <th>Workspace</th>
            <th>Role</th>
            <th>Reason</th>
            <th>Started</th>
            <th>Ended</th>
            <th>Duration / Pages</th>
          </tr>
        </thead>
        <tbody>
          {impSessions.map((s) => {
            const dur = s.endedAt
              ? Math.floor((new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 1000)
              : null;
            const durStr = dur != null ? `${Math.floor(dur / 60)}m ${dur % 60}s` : 'Active';
            return (
              <tr key={s.id}>
                <td style={{ fontSize: 13 }}>{s.targetEmail}</td>
                <td style={{ fontSize: 12 }}>{s.tenantName}</td>
                <td><span className="badge" style={{ background: 'var(--bg-card)' }}>{s.roleOverride}</span></td>
                <td style={{ fontSize: 12, maxWidth: 200 }}>{s.reason}</td>
                <td style={{ fontSize: 12 }}>{fmtDateTime(s.startedAt)}</td>
                <td style={{ fontSize: 12 }}>{s.endedAt ? fmtDateTime(s.endedAt) : <span style={{ color: '#f59e0b' }}>Active</span>}</td>
                <td style={{ fontSize: 12 }}>{durStr} / {s.pagesVisited.length} pages {s.writeBlockCount > 0 && <span style={{ color: '#ef4444' }}>({s.writeBlockCount} blocked writes)</span>}</td>
              </tr>
            );
          })}
          {impSessions.length === 0 && (
            <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>No impersonation sessions found.</td></tr>
          )}
        </tbody>
      </table>
      {impSessionsTotal > 50 && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            className="admin-tab"
            disabled={impSessionsOffset === 0}
            onClick={() => { setImpSessionsOffset(Math.max(0, impSessionsOffset - 50)); }}
          >
            ← Prev
          </button>
          <span style={{ fontSize: 13 }}>{impSessionsOffset + 1}–{Math.min(impSessionsOffset + 50, impSessionsTotal)} of {impSessionsTotal}</span>
          <button
            type="button"
            className="admin-tab"
            disabled={impSessionsOffset + 50 >= impSessionsTotal}
            onClick={() => { setImpSessionsOffset(impSessionsOffset + 50); }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
