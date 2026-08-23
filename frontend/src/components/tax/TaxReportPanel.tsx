'use client';

/**
 * The year-end 1099 report — manager+, own state, own fetch.
 *
 * Visibility is the CALLER's decision (wrap in `<RoleGate capability="tax.viewReport"
 * variant="block">`), matching every other manager-gated panel in this codebase —
 * this component itself just renders what `/api/tax` gives it. A non-manager never
 * reaches this component's fetch, so there is no 403 to handle here.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import { useMoneyFormat } from '@/lib/useMoneyFormat';
import { taxApi, type TaxYearReport } from '@/lib/taxApi';

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)',
  padding: 16, background: 'var(--bg-base)',
};

export function TaxReportPanel() {
  const t = useTranslations('tax');
  const { formatCents } = useMoneyFormat();
  const [years, setYears] = useState<number[]>([]);
  const [year, setYear] = useState<number | null>(null);
  const [report, setReport] = useState<TaxYearReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const { years: available } = await taxApi.years();
        setYears(available);
        setYear(available[0] ?? new Date().getFullYear());
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t('loadFailed'));
      } finally {
        setLoading(false);
      }
    })();
  }, [t]);

  const loadReport = useCallback(async (y: number) => {
    setBusy(true); setError('');
    try {
      setReport(await taxApi.report(y));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('loadFailed'));
      setReport(null);
    } finally {
      setBusy(false);
    }
  }, [t]);

  useEffect(() => { if (year != null) void loadReport(year); }, [year, loadReport]);

  const download = async () => {
    if (year == null) return;
    setBusy(true); setError('');
    try {
      await taxApi.downloadReportCsv(year, !showAll);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('exportFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>{t('loading')}</p>;

  const rows = report ? (showAll ? report.rows : report.rows.filter((r) => r.reportable)) : [];

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {error && <p role="alert" style={{ color: 'var(--coral-bright)', fontSize: 'var(--font-size-small)', margin: 0 }}>{error}</p>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
            {t('year')}
            <select
              value={year ?? ''}
              onChange={(event) => setYear(Number(event.target.value))}
              style={{ padding: '6px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
            >
              {(years.includes(year ?? -1) ? years : [year, ...years]).filter((y): y is number => y != null).map((y) => (
                <option key={y} value={y} style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>{y}</option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />
            {t('showAllRecipients')}
          </label>
        </div>
        <Button size="sm" variant="ghost" disabled={busy || !report} onClick={() => void download()}>
          {t('downloadCsv')}
        </Button>
      </div>

      {report && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: 10 }}>
          <div style={cardStyle}>
            <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-eyebrow)' }}>{t('reportableRecipients')}</div>
            <div style={{ color: 'var(--text-primary)', fontSize: 'var(--font-size-card-title)', fontWeight: 700 }}>{report.reportableRecipients}</div>
          </div>
          <div style={cardStyle}>
            <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-eyebrow)' }}>{t('reportableTotal')}</div>
            <div style={{ color: 'var(--text-primary)', fontSize: 'var(--font-size-card-title)', fontWeight: 700 }}>{formatCents(report.reportableCents)}</div>
          </div>
          {report.blockedRecipients > 0 && (
            <div style={cardStyle}>
              <div style={{ color: 'var(--coral-bright)', fontSize: 'var(--font-size-eyebrow)' }}>{t('blockedRecipients')}</div>
              <div style={{ color: 'var(--coral-bright)', fontSize: 'var(--font-size-card-title)', fontWeight: 700 }}>{report.blockedRecipients}</div>
            </div>
          )}
        </div>
      )}

      {report && report.blockedRecipients > 0 && (
        <p style={{ color: 'var(--coral-bright)', fontSize: 'var(--font-size-small)', margin: 0 }}>{t('blockedHint')}</p>
      )}

      {report && rows.length === 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-body)', margin: 0 }}>{t('noRows')}</p>
      )}

      {report && rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-body)', minWidth: 640 }}>
            <thead>
              <tr>
                {[t('colRecipient'), t('colType'), t('colForm'), t('colTotal'), t('colStatus')].map((heading) => (
                  <th key={heading} style={{ textAlign: 'left', padding: '6px 10px 6px 0', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.userId} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '8px 10px 8px 0' }}>{row.legalName ?? row.businessName ?? row.userId}</td>
                  <td style={{ padding: '8px 10px 8px 0', whiteSpace: 'nowrap' }}>{t(`recipientTypeLabel.${row.recipientType}`)}</td>
                  <td style={{ padding: '8px 10px 8px 0', whiteSpace: 'nowrap' }}>{row.formType}</td>
                  <td style={{ padding: '8px 10px 8px 0', color: 'var(--text-primary)', fontWeight: 600, whiteSpace: 'nowrap' }}>{formatCents(row.totalPaidCents)}</td>
                  <td style={{ padding: '8px 10px 8px 0', whiteSpace: 'nowrap', color: !row.reportable ? 'var(--text-muted)' : row.profileComplete ? 'var(--success)' : 'var(--coral-bright)' }}>
                    {!row.reportable ? t('statusBelowThreshold') : row.profileComplete ? t('statusReady') : t('statusIncomplete')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default TaxReportPanel;
