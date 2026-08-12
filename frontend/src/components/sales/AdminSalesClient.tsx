'use client';

/**
 * `/admin/sales` — the platform owner's view of the sales programme.
 *
 * ── ONE REPORT, TWO POPULATIONS ──────────────────────────────────────────────
 * This renders the SAME `SalesReportView` an associate reads in their own hub.
 * That is the whole design: the owner asked for "the same reports the sales rep
 * would get, but aggregated across the accounts and then filtered to a specific
 * user", and the honest way to deliver that is one component over one endpoint,
 * with the population as a parameter. A bespoke admin report would be a second
 * definition of "conversion rate" that starts agreeing with the rep's and stops
 * the first time either is edited.
 *
 * The filter is therefore a SELECT, not a mode: "Everyone" is the aggregate and
 * a name is that associate's own report — byte-identical to what they see.
 *
 * It also carries the two things only the owner can do: open an associate's live
 * canvas to coach on it, and message them (which is the shared hub, opened with
 * that person preselected — never a second chat implementation).
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import { Select } from '@/components/Select';
import { Button } from '@/components/ui';
import { SalesReportView } from '@/components/sales/SalesReportView';
import { useMessageHub } from '@/components/messages/MessageHubContext';
import { salesApi, type SalesAssociate, type SalesReport, type SalesReportWindow } from '@/lib/salesApi';

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
  marginBottom: 16,
};

/** The aggregate has no associate id; this is the sentinel the select uses. */
const EVERYONE = '';

export default function AdminSalesClient() {
  const t = useTranslations('salesAdmin');
  const router = useRouter();
  const { openWith } = useMessageHub();

  const [associates, setAssociates] = useState<SalesAssociate[]>([]);
  const [selected, setSelected] = useState<string>(EVERYONE);
  const [report, setReport] = useState<SalesReport | null>(null);
  const [window_, setWindow] = useState<SalesReportWindow>('month');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    salesApi.associates()
      .then(({ associates: rows }) => setAssociates(rows))
      .catch((cause) => setError(cause instanceof Error ? cause.message : t('loadFailed')));
  }, [t]);

  const load = useCallback((associateId: string) => {
    setError('');
    salesApi.report(associateId || null)
      .then(({ report: row }) => setReport(row))
      .catch((cause) => setError(cause instanceof Error ? cause.message : t('loadFailed')));
  }, [t]);

  useEffect(() => { load(selected); }, [load, selected]);

  const openCanvas = async () => {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      const result = await salesApi.canvas(selected);
      if (!result.sessionId) { setError(t('noCanvas')); return; }
      router.push(`/create/${result.sessionId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('canvasFailed'));
    } finally {
      setBusy(false);
    }
  };

  const chosen = associates.find((associate) => associate.id === selected);

  return (
    <PageContainer width="full" style={{ padding: '24px 28px' }}>
      <h1 style={{ fontSize: 'var(--font-size-page-title)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>{t('title')}</h1>
      <p style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-muted)', margin: '0 0 18px' }}>{t('intro')}</p>

      <div style={{ ...cardStyle, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'grid', gap: 6, flex: '1 1 260px', minWidth: 0 }}>
          <span style={{ fontSize: 'var(--font-size-field-label)', fontWeight: 600, color: 'var(--text-secondary)' }}>{t('filterLabel')}</span>
          <Select value={selected} onChange={(event) => setSelected(event.target.value)}>
            <option value={EVERYONE}>{t('everyone', { count: associates.length })}</option>
            {associates.map((associate) => (
              <option key={associate.id} value={associate.id}>{associate.name || associate.email}</option>
            ))}
          </Select>
        </label>
        {/* Both actions are per-ASSOCIATE, so they self-hide on the aggregate —
            there is no single canvas or inbox for "everyone". */}
        {chosen && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button size="sm" variant="ghost" loading={busy} onClick={() => void openCanvas()}>{t('openCanvas')}</Button>
            <Button size="sm" variant="primary" onClick={() => openWith(chosen.id)}>{t('message', { name: chosen.name || chosen.email })}</Button>
          </div>
        )}
      </div>

      {error && <p role="alert" style={{ color: 'var(--coral-bright)', fontSize: 'var(--font-size-body)', marginBottom: 14 }}>{error}</p>}

      {report
        ? <SalesReportView report={report} window={window_} onWindowChange={setWindow} onSelectAssociate={setSelected} />
        : <p style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-muted)' }}>{t('loading')}</p>}
    </PageContainer>
  );
}
