'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminApi, type AdminEmailDeliveryFailurePage } from '@/lib/adminApi';
import { AdminError, AdminLoading, errText, fmtDateTime } from '@/components/admin/adminShared';
import { useFormat } from "@/i18n/useFormat";

const PAGE_SIZE = 50;

function Stat({ label, value }: { label: string; value: number }) {
  const fmt = useFormat();
  return (
    <div style={{ flex: '1 1 150px', padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--surface)' }}>
      <div className="text-muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 600, color: value ? 'var(--danger)' : 'var(--text-primary)' }}>{fmt.number(value)}</div>
    </div>
  );
}

export default function EmailDeliveriesPanel() {
  const [page, setPage] = useState<AdminEmailDeliveryFailurePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [deliveryType, setDeliveryType] = useState('');
  const [offset, setOffset] = useState(0);

  const reload = useCallback(() => {
    setLoading(true);
    setError('');
    adminApi.emailDeliveryFailures({ q: applied || undefined, deliveryType: deliveryType || undefined, limit: PAGE_SIZE, offset })
      .then(setPage)
      .catch((e) => setError(errText(e)))
      .finally(() => setLoading(false));
  }, [applied, deliveryType, offset]);

  useEffect(() => { reload(); }, [reload]);
  if (loading && !page) return <AdminLoading />;

  const summary = page?.summary;
  const rows = page?.failures ?? [];
  return (
    <div>
      <AdminError message={error} />
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: '0 0 4px' }}>Failed email deliveries</h2>
        <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>Resend rejections and transport failures. Message bodies, verification codes, and API keys are not stored.</p>
      </div>
      {summary && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          <Stat label="All-time failures" value={summary.total} />
          <Stat label="Last 24 hours" value={summary.last24Hours} />
          <Stat label="Affected recipients" value={summary.affectedRecipients} />
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <select className="admin-select" value={deliveryType} onChange={(e) => { setDeliveryType(e.target.value); setOffset(0); }}>
          <option value="">All email types</option>
          {(page?.deliveryTypes ?? []).map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <input className="admin-select" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { setApplied(search); setOffset(0); } }} placeholder="Search recipient or provider error…" style={{ flex: '1 1 260px' }} />
        <button type="button" className="admin-tab" onClick={() => { setApplied(search); setOffset(0); }}>Filter</button>
        <button type="button" className="btn-ghost" onClick={reload}>↻ Refresh</button>
      </div>
      {rows.length === 0 ? <p className="text-muted" style={{ padding: 24 }}>No failed email deliveries recorded.</p> : (
        <div className="table-wrap">
          <table className="data-table" style={{ fontSize: 13 }}>
            <thead><tr><th>Time</th><th>Recipient</th><th>Type</th><th>Provider</th><th>Status</th><th>Error</th></tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={row.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(row.createdAt)}</td>
                <td>{row.recipient}</td>
                <td><code>{row.deliveryType}</code></td>
                <td>{row.provider}</td>
                <td>{row.providerStatus ?? '—'}</td>
                <td style={{ maxWidth: 520, whiteSpace: 'normal', wordBreak: 'break-word' }}>{row.errorMessage}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
        <button type="button" className="btn-ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>← Prev</button>
        <span className="text-muted" style={{ fontSize: 12 }}>{page ? `${offset + 1}–${offset + rows.length} of ${page.total}` : ''}</span>
        <button type="button" className="btn-ghost" disabled={!page?.hasMore} onClick={() => setOffset(offset + PAGE_SIZE)}>Next →</button>
      </div>
    </div>
  );
}
