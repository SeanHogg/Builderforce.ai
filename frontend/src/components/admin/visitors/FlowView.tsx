/**
 * The anonymous funnel as a graph — the flow half of Admin ▸ Growth ▸ Visitors.
 *
 * The host owns the window and the recording drawer. This owns the six numbers,
 * the graph, and the "open one visitor" lookup, so the same view can sit on
 * another surface without taking the panel chrome with it.
 */

import { useTranslations } from 'next-intl';
import { type AdminVisitorFlow } from '@/lib/adminApi';
import { AdminError, AdminLoading, StatTile, useAdminFormat } from '@/components/admin/adminShared';
import { VisitorFlowGraph } from '@/components/admin/visitor-flow/VisitorFlowGraph';

export function FlowView({
  data,
  loading,
  error,
  onOpenVisitor,
}: {
  data: AdminVisitorFlow | null;
  loading: boolean;
  error: string;
  onOpenVisitor: (visitorId: string) => void;
}) {
  const t = useTranslations('admin.visitorFlow');
  const { fmtNum } = useAdminFormat();
  const totals = data?.totals;
  const promptRate = rate(totals?.visitsWithPrompt, totals?.visits);
  const conversionRate = rate(totals?.convertedVisitors, totals?.visitors);

  return (
    <section aria-labelledby="insights-flow-heading">
      <h2 id="insights-flow-heading" style={{ fontSize: 'var(--font-size-body)', margin: '0 0 12px' }}>
        {t('title')}
      </h2>
      {loading && <AdminLoading />}
      <AdminError message={error} />

      {data && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
            <StatTile label={t('stat.visitors')} value={fmtNum(totals?.visitors ?? 0)} />
            <StatTile label={t('stat.visits')} value={fmtNum(totals?.visits ?? 0)} />
            <StatTile
              label={t('stat.returning')}
              value={fmtNum(totals?.returningVisitors ?? 0)}
              hint={t('stat.returningHint')}
            />
            <StatTile
              label={t('stat.withPrompt')}
              value={fmtNum(totals?.visitsWithPrompt ?? 0)}
              hint={promptRate}
            />
            <StatTile
              label={t('stat.withError')}
              value={fmtNum(totals?.visitsWithError ?? 0)}
              hint={t('stat.withErrorHint')}
              tone={(totals?.visitsWithError ?? 0) > 0 ? 'error' : undefined}
            />
            <StatTile
              label={t('stat.converted')}
              value={fmtNum(totals?.convertedVisitors ?? 0)}
              hint={conversionRate}
              tone="success"
            />
          </div>

          {data.truncated && (
            <p
              className="text-muted"
              style={{ fontSize: 'var(--font-size-small)', margin: '0 0 12px', color: 'var(--warning-text, var(--warning))' }}
            >
              {t('truncated')}
            </p>
          )}

          <VisitorFlowGraph nodes={data.nodes} edges={data.edges} />

          <p className="text-muted" style={{ fontSize: 'var(--font-size-small)', marginTop: 12 }}>
            {t('drillHint')}
          </p>
          <form
            style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}
            onSubmit={(e) => {
              e.preventDefault();
              const value = new FormData(e.currentTarget).get('visitorId');
              if (typeof value === 'string' && value.trim()) onOpenVisitor(value.trim());
            }}
          >
            <input
              name="visitorId"
              className="input"
              placeholder={t('visitorPlaceholder')}
              aria-label={t('visitorPlaceholder')}
              style={{ flex: '1 1 240px', minWidth: 0 }}
            />
            <button type="submit" className="btn-secondary">{t('openJourney')}</button>
          </form>
        </>
      )}
    </section>
  );
}

function rate(part: number | undefined, whole: number | undefined): string | undefined {
  if (!whole || part === undefined) return undefined;
  return `${Math.round((part / whole) * 100)}%`;
}
