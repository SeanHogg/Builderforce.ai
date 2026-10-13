/**
 * The anonymous funnel as a graph — the flow half of Admin ▸ Growth ▸ Visitors.
 *
 * The host owns the window and the recording drawer. This owns the six numbers,
 * the graph, the selected step's detail strip, and the "open one visitor"
 * lookup, so the same view can sit on another surface without taking the panel
 * chrome with it. A step that is a path links to the Insights app's issues,
 * filtered to sessions that visited it (PRD 33 S5) — recordings live in the
 * app, never in Admin (D17).
 */

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { filterToQuery } from '@builderforce/interaction-contract';
import { type AdminVisitorFlow } from '@/lib/adminApi';
import type { FlowNodeInput } from '@/lib/visitorFlowLayout';
import { AdminError, AdminLoading, StatTile, useAdminFormat } from '@/components/admin/adminShared';
import { VisitorFlowGraph } from '@/components/admin/visitor-flow/VisitorFlowGraph';

/** `/apps/insights?panel=issues&f.visitedPath.eq=<path>` — the step's sessions in the Insights app. */
export function flowStepInsightsHref(path: string): string {
  const filter = filterToQuery({ all: [{ field: 'visitedPath', op: 'eq', value: path }] });
  return `/apps/insights?panel=issues&${filter.toString()}`;
}

function FlowNodeStrip({ node, onClose }: { node: FlowNodeInput; onClose: () => void }) {
  const t = useTranslations('admin.insights');
  const { fmtNum } = useAdminFormat();
  const isPath = node.label.startsWith('/');
  return (
    <div
      role="region"
      aria-label={t('nodeStripAria', { step: node.label })}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 12,
        marginTop: 12,
        padding: '10px 12px',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--surface-card)',
      }}
    >
      <strong style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{node.label}</strong>
      <span className="text-muted">{t('nodeVisitors', { count: fmtNum(node.visitors) })}</span>
      <span className="text-muted">{t('nodeEvents', { count: fmtNum(node.events) })}</span>
      <span className="text-muted">{t('nodeExits', { count: fmtNum(node.exits) })}</span>
      {isPath && (
        <Link href={flowStepInsightsHref(node.label)} className="btn-secondary">
          {t('watchStep')}
        </Link>
      )}
      <button type="button" className="btn-ghost" onClick={onClose} aria-label={t('nodeStripClose')} style={{ marginLeft: 'auto' }}>
        {t('nodeStripClose')}
      </button>
    </div>
  );
}

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
  const [selected, setSelected] = useState<FlowNodeInput | null>(null);
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

          <VisitorFlowGraph nodes={data.nodes} edges={data.edges} onSelectNode={setSelected} />
          {selected && <FlowNodeStrip node={selected} onClose={() => setSelected(null)} />}

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
