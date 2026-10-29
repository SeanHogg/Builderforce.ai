/**
 * The anonymous funnel as a graph — the flow half of Admin ▸ Growth ▸ Visitors.
 *
 * ONE flow view over two data sources (`FLOW_SOURCES`, data): Admin's
 * builderforce.ai `activity_log` journey (`admin`), and an Insights site's kept
 * recordings folded by the same graph fold (`replay`, PRD 33 §2.1 / the
 * `funnel` kind's Flow tab). The `source` prop picks the loader; the six
 * numbers, the graph and the selected step's strip are the same either way.
 *
 * The host owns the window (inside `source`) and what a step leads to: with
 * `onWatchStep` the strip's action calls it (the Insights panel opens the
 * step's issues); without it, a path step links to the Insights app filtered
 * to sessions that visited it (PRD 33 S5) — recordings live in the app, never
 * in Admin (D17). `onOpenVisitor` adds the "open one visitor" lookup.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { filterToQuery, type ReplayFilter } from '@builderforce/interaction-contract';
import { adminApi } from '@/lib/adminApi';
import { replayApi } from '@/lib/replayApi';
import type { FlowEdgeInput, FlowNodeInput } from '@/lib/visitorFlowLayout';
import { AdminError, AdminLoading, useAdminData, useAdminFormat } from '@/components/admin/adminShared';
import { StatTile } from '@/components/ui/StatTile';
import { VisitorFlowGraph } from '@/components/admin/visitor-flow/VisitorFlowGraph';

/** `/apps/insights?panel=issues&f.visitedPath.eq=<path>` — the step's sessions in the Insights app. */
export function flowStepInsightsHref(path: string): string {
  const filter = filterToQuery({ all: [{ field: 'visitedPath', op: 'eq', value: path }] });
  return `/apps/insights?panel=issues&${filter.toString()}`;
}

/** Where a flow comes from. Each kind is one row of `FLOW_SOURCES`. */
export type FlowSource =
  | { kind: 'admin'; days: number }
  | { kind: 'replay'; siteId: string; days: number; filter: ReplayFilter };

/** What every source answers (Admin's and the Insights flow share the graph fold's shape). */
export interface FlowData {
  nodes: FlowNodeInput[];
  edges: FlowEdgeInput[];
  totals: {
    visitors: number;
    visits: number;
    returningVisitors: number;
    visitsWithPrompt: number;
    visitsWithError: number;
    convertedVisitors: number;
  };
  /** The scan hit its ceiling (Admin's source says so; the Insights flow trims inside the fold). */
  truncated?: boolean;
}

export const FLOW_SOURCES: { readonly [K in FlowSource['kind']]: (source: Extract<FlowSource, { kind: K }>) => Promise<FlowData> } = {
  admin: (source) => adminApi.visitorFlow(source.days),
  replay: (source) => replayApi.flow(source.siteId, { days: source.days, filter: source.filter }),
};

export function loadFlow(source: FlowSource): Promise<FlowData> {
  return (FLOW_SOURCES[source.kind] as (s: FlowSource) => Promise<FlowData>)(source);
}

function FlowNodeStrip({ node, onClose, onWatchStep }: { node: FlowNodeInput; onClose: () => void; onWatchStep?: (path: string) => void }) {
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
      {isPath && onWatchStep && (
        <button type="button" className="btn-secondary" onClick={() => onWatchStep(node.label)}>
          {t('watchStep')}
        </button>
      )}
      {isPath && !onWatchStep && (
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

export interface FlowViewProps {
  source: FlowSource;
  /** Bump to re-read (the host's refresh). */
  reloadKey?: number;
  /** Adds the "open one visitor" lookup (Admin's journey drawer). */
  onOpenVisitor?: (visitorId: string) => void;
  /** What a path step's action does; omitted, it links to the Insights app. */
  onWatchStep?: (path: string) => void;
}

export function FlowView({ source, reloadKey = 0, onOpenVisitor, onWatchStep }: FlowViewProps) {
  const t = useTranslations('admin.visitorFlow');
  const { fmtNum } = useAdminFormat();
  const { data, loading, error } = useAdminData<FlowData>(() => loadFlow(source), [JSON.stringify(source), reloadKey]);
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
          {selected && <FlowNodeStrip node={selected} onClose={() => setSelected(null)} onWatchStep={onWatchStep} />}

          {onOpenVisitor && (
            <>
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
        </>
      )}
    </section>
  );
}

function rate(part: number | undefined, whole: number | undefined): string | undefined {
  if (!whole || part === undefined) return undefined;
  return `${Math.round((part / whole) * 100)}%`;
}
