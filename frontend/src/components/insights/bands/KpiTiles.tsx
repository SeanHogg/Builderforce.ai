/**
 * Numbers band (PRD 33 §4.1): six headline tiles over the window, each the
 * shared `StatTile` with a sparkline from `kpis.trend`. The tiles are the
 * `KPI_TILES` registry; a tile that opens a panel kind names it in `opens`
 * (only sessions → issues today; the `metric` kind arrives with S4c).
 * Choosing a release to compare adds that release's value as the hint.
 */

import { useTranslations } from 'next-intl';
import type { ReplayKpisDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { useFormat } from '@/i18n/useFormat';
import type { Formatter } from '@/i18n/format';
import { StatTile, useAdminData } from '@/components/admin/adminShared';
import { Sparkline } from '@/components/charts/Sparkline';
import { useInsightsScope } from '../insightsScope';
import { usePanel } from '../usePanel';
import type { InsightPanelKind } from '../panelKinds';

type Tone = 'success' | 'error' | 'warning' | undefined;
type T = (key: string, values?: Record<string, string | number>) => string;

export interface KpiTileDef {
  id: string;
  /** Under `insights.kpi`. */
  labelKey: string;
  value: (kpis: ReplayKpisDto, fmt: Formatter, t: T) => string;
  trend?: (kpis: ReplayKpisDto) => number[];
  tone?: (kpis: ReplayKpisDto) => Tone;
  /** A fixed hint (e.g. the score's "after the first page review"). */
  hintKey?: string;
  opens?: InsightPanelKind;
}

const LCP_POOR_MS = 4000;
const LCP_NEEDS_WORK_MS = 2500;

export const KPI_TILES: ReadonlyArray<KpiTileDef> = [
  { id: 'sessions', labelKey: 'sessions', value: (k, fmt) => fmt.number(k.sessions), trend: (k) => k.trend.map((d) => d.sessions), opens: 'issues' },
  { id: 'conversion', labelKey: 'conversion', value: (k, fmt) => fmt.percent(k.conversionRate, 1), trend: (k) => k.trend.map((d) => d.conversions) },
  {
    id: 'frustrated', labelKey: 'frustrated', value: (k, fmt) => fmt.number(k.frustratedSessions),
    trend: (k) => k.trend.map((d) => d.frustrated), tone: (k) => (k.frustratedSessions > 0 ? 'warning' : undefined),
  },
  { id: 'errors', labelKey: 'errorsPer1k', value: (k, fmt) => fmt.number(k.errorsPer1k, { maximumFractionDigits: 1 }), tone: (k) => (k.errorsPer1k > 0 ? 'error' : undefined) },
  {
    id: 'lcp', labelKey: 'lcp',
    value: (k, fmt, t) => (k.lcpP75 == null ? '—' : t('seconds', { value: fmt.number(k.lcpP75 / 1000, { maximumFractionDigits: 1 }) })),
    tone: (k) => (k.lcpP75 == null ? undefined : k.lcpP75 > LCP_POOR_MS ? 'error' : k.lcpP75 > LCP_NEEDS_WORK_MS ? 'warning' : 'success'),
  },
  { id: 'score', labelKey: 'score', value: () => '—', hintKey: 'scorePending' },
];

export function KpiTiles() {
  const t = useTranslations('insights.kpi');
  const fmt = useFormat();
  const { siteId, days, filter, compare } = useInsightsScope();
  const { push } = usePanel();
  const filterKey = JSON.stringify(filter);
  const { data, error } = useAdminData(() => replayApi.getKpis(siteId, { days, filter }), [siteId, days, filterKey]);
  const { data: versus } = useAdminData(
    () => (compare ? replayApi.getKpis(siteId, { days, filter, release: compare }) : Promise.resolve(null)),
    [siteId, days, filterKey, compare],
  );

  return (
    <div role="group" aria-label={t('aria')} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--space-2)', minWidth: 0 }}>
      {error && <p role="alert" style={{ gridColumn: '1 / -1', margin: 0, color: 'var(--error)' }}>{t('error')} {error}</p>}
      {KPI_TILES.map((tile) => {
        const label = t(tile.labelKey);
        const value = data ? tile.value(data, fmt, t) : '…';
        const hint = tile.hintKey
          ? t(tile.hintKey)
          : versus && data ? t('versus', { value: tile.value(versus, fmt, t) }) : undefined;
        const trend = data && tile.trend ? tile.trend(data) : [];
        const body = (
          <StatTile
            label={label}
            value={value}
            hint={hint}
            tone={data && tile.tone ? tile.tone(data) : undefined}
            footer={trend.length > 1 ? <Sparkline values={trend} width={96} height={20} color="var(--accent)" ariaLabel={t('trendAria', { label })} /> : undefined}
          />
        );
        const opens = tile.opens;
        return opens ? (
          <button
            key={tile.id}
            type="button"
            aria-label={t('openAria', { label })}
            onClick={() => push({ kind: opens, id: '' })}
            style={{ display: 'flex', padding: 0, border: 'none', background: 'none', textAlign: 'left', cursor: 'pointer', color: 'inherit', minWidth: 0 }}
          >
            {body}
          </button>
        ) : (
          <div key={tile.id} style={{ display: 'flex', minWidth: 0 }}>{body}</div>
        );
      })}
    </div>
  );
}
