import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { PmEmpty, PmError } from '@/components/pm/pmShared';
import {
  tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle,
} from '@/components/dataTableStyles';
import {
  COMPARED_METRICS, MIN_ARM_CALLS, MIN_ARM_RUNS, deltaTone, isThinSample,
  type ComparedMetric, type LeverComparison,
} from '@/lib/costMetricsApi';
import { useInsightFormat } from '../format';
import { TONE_COLOR, useCostMetricFormat } from './costMetricFormat';

/**
 * Each partially rolled-out cost lever: its on-arm against its off-arm, metric by
 * metric. One row per (lever × metric) so the table reads top-to-bottom at 360px
 * without a dozen columns; a delta resting on a thin arm is withheld and labelled
 * "insufficient sample" rather than printed as if it were evidence.
 */
export function LeverComparisonTable({ levers, error }: { levers: LeverComparison[] | null; error: string | null }) {
  const { int } = useInsightFormat();
  const f = useCostMetricFormat();
  const t = useTranslations('insights.cost');
  const tc = useTranslations('common');

  let body: ReactNode;
  if (error) body = <PmError message={t('loadFailed')} />;
  else if (!levers) body = <PmEmpty message={tc('loading')} />;
  else if (levers.length === 0) body = <PmEmpty message={t('lever.empty')} />;
  else {
    body = (
      <div style={tableWrapStyle}>
        <table style={tableStyle}>
          <thead>
            <tr style={theadRowStyle}>
              <th style={thStyle}>{t('col.metric')}</th>
              <th style={thStyle}>{t('lever.colOn')}</th>
              <th style={thStyle}>{t('lever.colOff')}</th>
              <th style={thStyle}>{t('lever.colDelta')}</th>
            </tr>
          </thead>
          {levers.map((lv) => (
            <tbody key={lv.lever}>
              <tr style={{ ...trStyle, background: 'var(--bg-base)' }}>
                <th scope="rowgroup" colSpan={4} style={{ ...thStyle, color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                  {lv.requirement ? t('lever.nameWithReq', { lever: lv.lever, req: lv.requirement }) : lv.lever}
                  <span style={{ marginLeft: 8, fontWeight: 400, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>
                    {t('lever.sample', { on: int(lv.on?.calls ?? 0), off: int(lv.off?.calls ?? 0) })}
                  </span>
                </th>
              </tr>
              {COMPARED_METRICS.map((m) => <LeverMetricRow key={m} lever={lv} metric={m} />)}
            </tbody>
          ))}
        </table>
      </div>
    );
  }

  return (
    <section aria-labelledby="cost-lever-title" style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <h3 id="cost-lever-title" style={{ margin: 0, fontSize: 'var(--font-size-body)', fontWeight: 700 }}>{t('lever.title')}</h3>
      <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
        {t('lever.desc', { calls: MIN_ARM_CALLS, runs: MIN_ARM_RUNS })}
      </p>
      {body}
    </section>
  );
}

function LeverMetricRow({ lever, metric }: { lever: LeverComparison; metric: ComparedMetric }) {
  const f = useCostMetricFormat();
  const t = useTranslations('insights.cost');
  const thin = isThinSample(lever.on, metric) || isThinSample(lever.off, metric);
  const d = lever.delta[metric];
  const tone = deltaTone(metric, d);
  return (
    <tr style={trStyle}>
      <td style={tdStyle}>{f.label(metric)}</td>
      <td style={tdStyle}>{f.value(metric, lever.on?.[metric])}</td>
      <td style={tdMutedStyle}>{f.value(metric, lever.off?.[metric])}</td>
      {thin ? (
        <td style={{ ...tdMutedStyle, fontStyle: 'italic' }}>{t('lever.insufficient')}</td>
      ) : (
        <td style={{ ...tdStyle, color: TONE_COLOR[tone], whiteSpace: 'nowrap' }} title={d != null ? f.tone(tone) : undefined}>
          {f.delta(metric, d)}
        </td>
      )}
    </tr>
  );
}
