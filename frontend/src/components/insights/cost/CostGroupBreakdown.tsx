import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { BarChart } from '@/components/charts/BarChart';
import { PmEmpty, PmError } from '@/components/pm/pmShared';
import {
  tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle,
} from '@/components/dataTableStyles';
import { COST_GROUPINGS, type CostGrouping, type CostMetricsReport } from '@/lib/costMetricsApi';
import { useInsightFormat } from '../format';
import { lensSelectStyle } from '../LensShell';
import { useCostMetricFormat } from './costMetricFormat';

/** i18n key (under `insights.cost`) per grouping-switch option. */
export const GROUPING_LABEL_KEY: Record<CostGrouping, string> = {
  actionType: 'grouping.actionType',
  role: 'grouping.role',
  model: 'grouping.model',
  route: 'grouping.route',
};

/** The pipeline routes the wire names, and their labels (under `insights.cost`). */
export const ROUTE_LABEL_KEY: Readonly<Record<string, string>> = { full: 'route.full', quick: 'route.quick' };

/** The wire's "no attribution" bucket — the one group key the UI names itself. */
const UNATTRIBUTED = 'unattributed';

/**
 * Where the spend goes, by work type, role, model or pipeline route: the spend bars answer "which group
 * is the money", the table beside them answers "is that group efficient" — cache hit
 * rate, context size and cost per merged PR on the same row as the spend.
 */
export function CostGroupBreakdown({
  report, error, grouping, onGroupingChange,
}: {
  report: CostMetricsReport | null;
  error: string | null;
  grouping: CostGrouping;
  onGroupingChange: (g: CostGrouping) => void;
}) {
  const { int } = useInsightFormat();
  const f = useCostMetricFormat();
  const t = useTranslations('insights.cost');
  const tc = useTranslations('common');
  const nameOf = (g: string): string => {
    if (g === UNATTRIBUTED) return t('unattributed');
    const routeKey = grouping === 'route' ? ROUTE_LABEL_KEY[g] : undefined;
    return routeKey ? t(routeKey as never) : g;
  };

  let body: ReactNode;
  if (error) body = <PmError message={t('loadFailed')} />;
  else if (!report) body = <PmEmpty message={tc('loading')} />;
  else if (report.groups.length === 0) body = <PmEmpty message={t('empty')} />;
  else {
    const bars = report.groups.map((g) => ({ key: g.group, label: nameOf(g.group), value: g.costUsd }));
    body = (
      <>
        <BarChart data={bars} maxRows={8} labelWidth={120} formatValue={(v) => f.approxUsd(v)} ariaLabel={t('group.aria')} />
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr style={theadRowStyle}>
                <th style={thStyle}>{t(GROUPING_LABEL_KEY[grouping] as never)}</th>
                <th style={thStyle}>{t('col.calls')}</th>
                <th style={thStyle}>{t('col.spend')}</th>
                <th style={thStyle}>{f.label('cacheHitRate')}</th>
                <th style={thStyle}>{f.label('medianContextTokens')}</th>
                <th style={thStyle}>{f.label('medianTurnsPerCompletedRun')}</th>
                <th style={thStyle}>{f.label('costPerMergedPrUsd')}</th>
              </tr>
            </thead>
            <tbody>
              {report.groups.map((g) => (
                <tr key={g.group} style={trStyle}>
                  <td style={{ ...tdStyle, wordBreak: 'break-word' }}>{nameOf(g.group)}</td>
                  <td style={tdMutedStyle}>{int(g.calls)}</td>
                  <td style={tdStyle}>{f.approxUsd(g.costUsd)}</td>
                  <td style={tdStyle}>{f.value('cacheHitRate', g.cacheHitRate)}</td>
                  <td style={tdMutedStyle}>{f.value('medianContextTokens', g.medianContextTokens)}</td>
                  <td style={tdMutedStyle}>{f.value('medianTurnsPerCompletedRun', g.medianTurnsPerCompletedRun)}</td>
                  <td style={tdStyle}>{f.value('costPerMergedPrUsd', g.costPerMergedPrUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {report.truncated && (
          <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>
            {t('group.truncated', { n: int(report.groups.length) })}
          </p>
        )}
      </>
    );
  }

  return (
    <section aria-labelledby="cost-group-title" style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <h3 id="cost-group-title" style={{ margin: 0, fontSize: 'var(--font-size-body)', fontWeight: 700 }}>{t('group.title')}</h3>
        <Select
          style={lensSelectStyle}
          value={grouping}
          onChange={(e) => onGroupingChange(e.target.value as CostGrouping)}
          aria-label={t('grouping.label')}
        >
          {COST_GROUPINGS.map((g) => <option key={g} value={g}>{t(GROUPING_LABEL_KEY[g] as never)}</option>)}
        </Select>
      </div>
      {body}
    </section>
  );
}
