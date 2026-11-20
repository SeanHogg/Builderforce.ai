/**
 * SAAS WIDGETS (PRD 25 Slice B5) — retention, payback and LTV:CAC tiles.
 *
 * NRR, GRR, CAC payback and LTV:CAC are scalar tiles over the shared
 * {@link ScalarMetricTile}; `growth.ltv-tranches` is the by-tranche breakdown
 * (plan / cohort / channel / segment) with a 3:1 reference line.
 *
 * A figure that could not be measured renders "Not measured", never 0.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { dashboardsApi, LTV_DIMENSIONS, type LtvDimension, type LtvTranchesResult } from '@/lib/dashboardsApi';
import { useSharedSource } from '@/lib/widgets/sharedSource';
import { WidgetMuted as Muted, useSourceState } from '@/components/widgets/widgetBody';
import type { ComponentSurfaceProps, ComponentDef, ComponentDrill } from '@/lib/components/types';
import { colorAt } from '@/components/charts/chartColors';
import { useFormat } from '@/i18n/useFormat';
import { ScalarMetricTile, type ScalarTileSpec } from './scalarMetricTile';

const SAAS_DRILL: ComponentDrill = { kind: 'panel', hub: 'finance', panel: 'finance' };
const SAAS_CAP = 'insights.finance' as const;

/** The healthy LTV:CAC floor — the reference line and the next-action threshold. */
const LTV_CAC_TARGET = 3;

function scalarCard(spec: ScalarTileSpec) {
  return function SaasScalarCard({ days }: ComponentSurfaceProps) {
    return <ScalarMetricTile spec={spec} days={days} />;
  };
}

const NrrCard = scalarCard({ metricKey: 'growth.nrr', format: 'percent', higherIsBetter: true, actionKey: 'nrr' });
const GrrCard = scalarCard({ metricKey: 'growth.grr', format: 'percent', higherIsBetter: true, actionKey: 'grr' });
const CacPaybackCard = scalarCard({ metricKey: 'growth.cacPayback', format: 'months', higherIsBetter: false, actionKey: 'cacPayback' });
const LtvCacCard = scalarCard({ metricKey: 'growth.ltvCac', format: 'ratio', higherIsBetter: true, actionKey: 'ltvCac' });

// ── LTV tranches ─────────────────────────────────────────────────────────────

function LtvTranchesCard(_: ComponentSurfaceProps) {
  const t = useTranslations('components');
  const fmt = useFormat();
  const [dimension, setDimension] = useState<LtvDimension>('plan');
  const [asTable, setAsTable] = useState(false);
  const src = useSharedSource<LtvTranchesResult>(`saas:ltv-tranches:${dimension}`, () => dashboardsApi.ltvTranches(dimension));
  const state = useSourceState(src);

  const controls = (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8, fontSize: 'var(--font-size-small)' }}>
      <label style={{ color: 'var(--text-muted)', display: 'flex', gap: 6, alignItems: 'center' }}>
        {t('saas.dimension.label')}
        <select
          value={dimension}
          onChange={(e) => setDimension(e.target.value as LtvDimension)}
          style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}
        >
          {LTV_DIMENSIONS.map((d) => (
            <option key={d} value={d}>{t(`saas.dimension.${d}`)}</option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={() => setAsTable((v) => !v)}
        aria-pressed={asTable}
        style={{ background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
      >
        {asTable ? t('saas.chartView') : t('saas.tableView')}
      </button>
    </div>
  );

  if (!src.data) return <div>{controls}{state}</div>;
  const { tranches, nextAction } = src.data;
  if (!tranches.length) return <div>{controls}<Muted>{t('saas.notMeasured')}</Muted></div>;

  const ratioText = (r: number | null) => (r == null ? t('saas.notMeasured') : t('saas.ratio', { value: String(Math.round(r * 10) / 10) }));
  const monthsText = (m: number | null) => (m == null ? t('saas.notMeasured') : t('saas.months', { count: Math.round(m * 10) / 10 }));
  const moneyText = (v: number | null) => (v == null ? t('saas.notMeasured') : fmt.money(v));

  const measured = tranches.map((r) => r.ratio).filter((r): r is number => r != null);
  // Scale so the 3:1 line always sits inside the plot.
  const axisMax = Math.max(LTV_CAC_TARGET * 1.5, ...measured);
  const targetPct = (LTV_CAC_TARGET / axisMax) * 100;

  const action = nextAction ? (
    <div style={{ marginTop: 8, fontSize: 'var(--font-size-eyebrow)', color: 'var(--warning)' }}>
      {t('saas.below3to1', { tranche: nextAction.tranche, ratio: ratioText(nextAction.ratio) })}
    </div>
  ) : null;

  if (asTable) {
    return (
      <div>
        {controls}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-small)' }}>
          <caption style={{ position: 'absolute', left: -9999 }}>{t('title.growthLtvTranches')}</caption>
          <thead>
            <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
              <th scope="col">{t('saas.col.tranche')}</th>
              <th scope="col">{t('saas.col.ltv')}</th>
              <th scope="col">{t('saas.col.cac')}</th>
              <th scope="col">{t('saas.col.ratio')}</th>
              <th scope="col">{t('saas.col.payback')}</th>
            </tr>
          </thead>
          <tbody>
            {tranches.map((r) => (
              <tr key={r.tranche} style={{ color: 'var(--text-primary)' }}>
                <th scope="row" style={{ textAlign: 'left', fontWeight: 500 }}>
                  {r.tranche}{r.declared ? ` (${t('saas.declared')})` : ''}
                </th>
                <td>{moneyText(r.ltv)}</td>
                <td>{moneyText(r.cac)}</td>
                <td>{ratioText(r.ratio)}</td>
                <td>{monthsText(r.paybackMonths)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {action}
      </div>
    );
  }

  return (
    <div>
      {controls}
      <div role="img" aria-label={t('title.growthLtvTranches')} style={{ position: 'relative', display: 'grid', gap: 6 }}>
        {tranches.map((r) => {
          const pct = r.ratio == null ? 0 : Math.min(100, (r.ratio / axisMax) * 100);
          const below = r.ratio != null && r.ratio < LTV_CAC_TARGET;
          return (
            <div key={r.tranche} style={{ display: 'grid', gridTemplateColumns: '84px 1fr 64px', alignItems: 'center', gap: 8, fontSize: 'var(--font-size-small)' }}>
              <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.tranche}{r.declared ? ` · ${t('saas.declared')}` : ''}
              </span>
              <div style={{ position: 'relative', height: 12, background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)' }}>
                {r.ratio != null && (
                  <div style={{ width: `${pct}%`, height: '100%', background: below ? 'var(--warning)' : colorAt(0), borderRadius: 'var(--radius-sm)' }} />
                )}
                <div
                  aria-hidden="true"
                  style={{ position: 'absolute', top: -2, bottom: -2, left: `${targetPct}%`, borderLeft: '1px dashed var(--text-muted)' }}
                />
              </div>
              <span style={{ color: 'var(--text-primary)', textAlign: 'right' }}>{ratioText(r.ratio)}</span>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 6, fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>{t('saas.target3to1')}</div>
      {action}
    </div>
  );
}

// ── Registry ─────────────────────────────────────────────────────────────────

export const SAAS_COMPONENTS: ComponentDef[] = [
  { id: 'growth.nrr', group: 'founder', titleKey: 'growthNrr', capability: SAAS_CAP, size: 'sm', Surface: NrrCard, drill: SAAS_DRILL },
  { id: 'growth.grr', group: 'founder', titleKey: 'growthGrr', capability: SAAS_CAP, size: 'sm', Surface: GrrCard, drill: SAAS_DRILL },
  { id: 'growth.cac-payback', group: 'founder', titleKey: 'growthCacPayback', capability: SAAS_CAP, size: 'sm', Surface: CacPaybackCard, drill: SAAS_DRILL },
  { id: 'growth.ltv-cac', group: 'founder', titleKey: 'growthLtvCac', capability: SAAS_CAP, size: 'sm', Surface: LtvCacCard, drill: SAAS_DRILL },
  { id: 'growth.ltv-tranches', group: 'founder', titleKey: 'growthLtvTranches', capability: SAAS_CAP, size: 'lg', Surface: LtvTranchesCard, drill: SAAS_DRILL },
];
