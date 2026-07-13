'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi, type AuditLogEntry } from '@/lib/adminApi';
import { AdminError, AdminLoading, errText, fmtDateTime } from '@/components/admin/adminShared';

export default function AuditLogPanel() {
  const t = useTranslations('admin');
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
          {t('auditlog.title')}
          <span style={{ marginLeft: 8, fontSize: 13, fontWeight: 400, color: 'var(--text-muted)' }}>{t('auditlog.total', { n: auditTotal })}</span>
        </h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="admin-select"
            value={auditEventFilter}
            onChange={(e) => setAuditEventFilter(e.target.value)}
            placeholder={t('auditlog.filterByEvent')}
            style={{ width: 200 }}
            onKeyDown={(e) => { if (e.key === 'Enter') { setAuditOffset(0); reload(); } }}
          />
          <button type="button" className="admin-tab" onClick={() => { setAuditOffset(0); reload(); }}>{t('common.filter')}</button>
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
            {auditExporting ? t('common.exporting') : t('common.exportCsv')}
          </button>
          <button type="button" className="admin-tab" onClick={() => { setAuditOffset(0); reload(); }}>↻ {t('common.refresh')}</button>
        </div>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>{t('auditlog.event')}</th>
            <th>{t('auditlog.actor')}</th>
            <th>{t('auditlog.target')}</th>
            <th>{t('auditlog.workspace')}</th>
            <th>{t('auditlog.ip')}</th>
            <th>{t('auditlog.time')}</th>
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
            <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>{t('auditlog.noneFound')}</td></tr>
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
            {t('common.prev')}
          </button>
          <span style={{ fontSize: 13 }}>{t('auditlog.pagination', { from: auditOffset + 1, to: Math.min(auditOffset + 50, auditTotal), total: auditTotal })}</span>
          <button
            type="button"
            className="admin-tab"
            disabled={auditOffset + 50 >= auditTotal}
            onClick={() => { setAuditOffset(auditOffset + 50); }}
          >
            {t('common.next')}
          </button>
        </div>
      )}
    </div>
  );
}
