'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { adminApi, type AuditLogEntry } from '@/lib/adminApi';
import { AdminError, AdminLoading, errText, fmtDateTime } from '@/components/admin/adminShared';

export default function AuditLogPanel() {
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditEventFilter, setAuditEventFilter] = useState('');
  const [auditOffset, setAuditOffset] = useState(0);
  const [auditExporting, setAuditExporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Keep the latest filter available to reload without forcing a re-fetch on
  // every keystroke — reload only re-runs when the offset changes.
  const eventFilterRef = useRef(auditEventFilter);
  eventFilterRef.current = auditEventFilter;

  const reload = useCallback(() => {
    setLoading(true);
    setError('');
    adminApi
      .auditLog({ event: eventFilterRef.current || undefined, limit: 50, offset: auditOffset })
      .then((r) => {
        setAuditEntries(r.entries);
        setAuditTotal(r.total);
      })
      .catch((e) => setError(errText(e)))
      .finally(() => setLoading(false));
  }, [auditOffset]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (loading && auditEntries.length === 0) return <AdminLoading />;

  return (
    <div>
      <AdminError message={error} />
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 className="page-title" style={{ fontSize: 18, margin: 0 }}>
          Audit Log
          <span style={{ marginLeft: 8, fontSize: 13, fontWeight: 400, color: 'var(--text-muted)' }}>{auditTotal} total</span>
        </h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="admin-select"
            value={auditEventFilter}
            onChange={(e) => setAuditEventFilter(e.target.value)}
            placeholder="Filter by event…"
            style={{ width: 200 }}
            onKeyDown={(e) => { if (e.key === 'Enter') { setAuditOffset(0); reload(); } }}
          />
          <button type="button" className="admin-tab" onClick={() => { setAuditOffset(0); reload(); }}>Filter</button>
          <button
            type="button"
            className="admin-tab"
            disabled={auditExporting}
            onClick={async () => {
              setAuditExporting(true);
              setError('');
              try {
                const csv = await adminApi.auditLogExport({ event: auditEventFilter || undefined });
                const blob = new Blob([csv], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = 'audit-log.csv'; a.click();
                URL.revokeObjectURL(url);
              } catch (e) { setError(errText(e)); }
              finally { setAuditExporting(false); }
            }}
          >
            {auditExporting ? 'Exporting…' : 'Export CSV'}
          </button>
          <button type="button" className="admin-tab" onClick={() => { setAuditOffset(0); reload(); }}>↻ Refresh</button>
        </div>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Event</th>
            <th>Actor</th>
            <th>Target</th>
            <th>Workspace</th>
            <th>IP</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {auditEntries.map((e) => (
            <tr key={e.id}>
              <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{e.event}</td>
              <td style={{ fontSize: 12 }}>{e.actorEmail ?? e.actorId ?? '—'}</td>
              <td style={{ fontSize: 12 }}>{e.targetEmail ?? e.targetUserId ?? '—'}</td>
              <td style={{ fontSize: 12 }}>{e.tenantName ?? (e.tenantId ? String(e.tenantId) : '—')}</td>
              <td style={{ fontSize: 12, fontFamily: 'monospace' }}>{e.ipAddress ?? '—'}</td>
              <td style={{ fontSize: 12 }}>{fmtDateTime(e.createdAt)}</td>
            </tr>
          ))}
          {auditEntries.length === 0 && (
            <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>No audit log entries found.</td></tr>
          )}
        </tbody>
      </table>
      {auditTotal > 50 && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            className="admin-tab"
            disabled={auditOffset === 0}
            onClick={() => { setAuditOffset(Math.max(0, auditOffset - 50)); }}
          >
            ← Prev
          </button>
          <span style={{ fontSize: 13 }}>{auditOffset + 1}–{Math.min(auditOffset + 50, auditTotal)} of {auditTotal}</span>
          <button
            type="button"
            className="admin-tab"
            disabled={auditOffset + 50 >= auditTotal}
            onClick={() => { setAuditOffset(auditOffset + 50); }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
