import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi, type AdminEmailDeliveryFailurePage } from '@/lib/adminApi';
import { AdminError, AdminLoading, errText, useAdminFormat } from '@/components/admin/adminShared';
import { StatTile } from '@/components/ui/StatTile';
import { useFormat } from "@/i18n/useFormat";

const PAGE_SIZE = 50;

export default function EmailDeliveriesPanel() {
  const t = useTranslations('admin.emailDeliveries');
  const { fmtDateTime } = useAdminFormat();
  const fmt = useFormat();
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
        <h2 style={{ margin: '0 0 4px' }}>{t('title')}</h2>
        <p className="text-muted" style={{ margin: 0, fontSize: 'var(--font-size-small)' }}>{t('subtitle')}</p>
      </div>
      {summary && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          <StatTile label={t('allTime')} value={fmt.number(summary.total)} tone={summary.total ? 'error' : undefined} />
          <StatTile label={t('last24h')} value={fmt.number(summary.last24Hours)} tone={summary.last24Hours ? 'error' : undefined} />
          <StatTile label={t('affected')} value={fmt.number(summary.affectedRecipients)} tone={summary.affectedRecipients ? 'error' : undefined} />
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <select className="admin-select" value={deliveryType} onChange={(e) => { setDeliveryType(e.target.value); setOffset(0); }}>
          <option value="">{t('allTypes')}</option>
          {(page?.deliveryTypes ?? []).map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <input className="admin-select" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { setApplied(search); setOffset(0); } }} placeholder={t('searchPlaceholder')} style={{ flex: '1 1 260px' }} />
        <button type="button" className="admin-tab" onClick={() => { setApplied(search); setOffset(0); }}>{t('filter')}</button>
        <button type="button" className="btn-ghost" onClick={reload}>↻ {t('refresh')}</button>
      </div>
      {rows.length === 0 ? <p className="text-muted" style={{ padding: 24 }}>{t('empty')}</p> : (
        <div className="table-wrap">
          <table className="data-table" style={{ fontSize: 'var(--font-size-small)' }}>
            <thead><tr><th>{t('time')}</th><th>{t('recipient')}</th><th>{t('type')}</th><th>{t('provider')}</th><th>{t('status')}</th><th>{t('error')}</th></tr></thead>
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
        <button type="button" className="btn-ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>← {t('prev')}</button>
        <span className="text-muted" style={{ fontSize: 'var(--font-size-small)' }}>{page ? t('range', { from: offset + 1, to: offset + rows.length, total: page.total }) : ''}</span>
        <button type="button" className="btn-ghost" disabled={!page?.hasMore} onClick={() => setOffset(offset + PAGE_SIZE)}>{t('next')} →</button>
      </div>
    </div>
  );
}
