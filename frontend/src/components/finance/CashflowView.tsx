/**
 * Cashflow — BurnRateOS's Cashflow Visualizer: inflows, outflows, net and the
 * ending balance, month by month, as a chart and as a table.
 *
 * Two series, never blended: the OBSERVED months the rollup produced, and the
 * DECLARED projection ("at this burn, where does the balance go") computed from
 * the founder's numbers by the shared formula. Which one is on screen is a
 * toggle the reader sees, and the chart's caption names it.
 *
 * No `'use client'`: the boundary is `FinanceClient.tsx`.
 */

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CashflowPoint } from '@builderforce/creation-canvas-contract';
import { TrendChart } from '@/components/charts/TrendChart';
import { useMoneyFormat } from '@/lib/useMoneyFormat';
import type { RunwayReport } from '@/lib/financeApi';
import {
  buttonStyle, cardStyle, emptyStyle, gapChipStyle, mutedStyle, primaryButtonStyle, rowStyle, sectionStyle,
  tableStyle, tableWrapStyle, tdStyle, thStyle,
} from './financeStyles';

type Source = 'observed' | 'declared';

export function CashflowView({ report }: { report: RunwayReport }) {
  const t = useTranslations('financeHub.cashflow');
  const { formatMoney } = useMoneyFormat();
  const hasObserved = report.observed.cashflow.length > 0;
  const hasDeclared = (report.declared?.projection.length ?? 0) > 0;
  const [source, setSource] = useState<Source>(hasObserved ? 'observed' : 'declared');

  // The series and its totals are ONE derivation from (report, source), so the
  // memo's inputs are the two facts that can change rather than a value picked
  // differently per branch.
  const { series, totals } = useMemo(() => {
    const points: CashflowPoint[] = source === 'observed' ? report.observed.cashflow : report.declared?.projection ?? [];
    const inflows = points.reduce((sum, p) => sum + p.inflows, 0);
    const outflows = points.reduce((sum, p) => sum + p.outflows, 0);
    return { series: points, totals: { inflows, outflows, net: inflows - outflows, ending: points.at(-1)?.endingBalance ?? null } };
  }, [report, source]);

  const money = (n: number | null) => (n == null ? '—' : formatMoney({ amount: n, currency: 'USD' }, { compact: false }));

  return (
    <div style={sectionStyle}>
      <div style={rowStyle}>
        <div>
          <h2 style={{ margin: 0, fontSize: 'var(--font-size-card-title)' }}>{t('title')}</h2>
          <p style={mutedStyle}>{t('blurb')}</p>
        </div>
        <div role="group" aria-label={t('source')} style={{ display: 'flex', gap: 6 }}>
          <button type="button" aria-pressed={source === 'observed'} style={source === 'observed' ? primaryButtonStyle : buttonStyle} onClick={() => setSource('observed')} disabled={!hasObserved}>{t('observed')}</button>
          <button type="button" aria-pressed={source === 'declared'} style={source === 'declared' ? primaryButtonStyle : buttonStyle} onClick={() => setSource('declared')} disabled={!hasDeclared}>{t('declared')}</button>
        </div>
      </div>

      {series.length === 0 ? (
        <p style={emptyStyle}>{source === 'observed' ? t('observedEmpty') : t('declaredEmpty')}</p>
      ) : (
        <>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(160px, 100%), 1fr))' }}>
            <Stat label={t('inflows')} value={money(totals.inflows)} tone="var(--success-text)" />
            <Stat label={t('outflows')} value={money(totals.outflows)} tone="var(--error-text)" />
            <Stat label={t('net')} value={money(totals.net)} tone={totals.net >= 0 ? 'var(--success-text)' : 'var(--error-text)'} />
            <Stat label={t('ending')} value={money(totals.ending)} />
          </div>

          <div style={{ ...cardStyle, display: 'grid', gap: 8 }}>
            <div style={rowStyle}>
              <h3 style={{ margin: 0, fontSize: 'var(--font-size-body)' }}>{t('chart')}</h3>
              <span style={gapChipStyle}>{source === 'observed' ? t('observedCaption') : t('declaredCaption')}</span>
            </div>
            <TrendChart
              labels={series.map((p) => p.month)}
              series={[
                { key: 'inflows', label: t('inflows'), values: series.map((p) => p.inflows) },
                { key: 'outflows', label: t('outflows'), values: series.map((p) => p.outflows) },
                { key: 'ending', label: t('ending'), values: series.map((p) => p.endingBalance) },
              ]}
              height={220}
              formatValue={(v) => formatMoney({ amount: v, currency: 'USD' }, { compact: false })}
              ariaLabel={t('chart')}
            />
          </div>

          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>{t('col.month')}</th>
                  <th style={thStyle}>{t('inflows')}</th>
                  <th style={thStyle}>{t('outflows')}</th>
                  <th style={thStyle}>{t('net')}</th>
                  <th style={thStyle}>{t('ending')}</th>
                  <th style={thStyle}>{t('col.status')}</th>
                </tr>
              </thead>
              <tbody>
                {series.map((point) => (
                  <tr key={point.month}>
                    <td style={tdStyle}>{point.month}</td>
                    <td style={{ ...tdStyle, color: 'var(--success-text)' }}>{money(point.inflows)}</td>
                    <td style={{ ...tdStyle, color: 'var(--error-text)' }}>{money(point.outflows)}</td>
                    <td style={{ ...tdStyle, color: point.net >= 0 ? 'var(--success-text)' : 'var(--error-text)' }}>{money(point.net)}</td>
                    <td style={tdStyle}>{money(point.endingBalance)}</td>
                    <td style={tdStyle}>
                      <span className={`ui-badge ${point.endingBalance < 0 ? 'ui-badge--danger' : point.net >= 0 ? 'ui-badge--success' : 'ui-badge--warning'}`}>
                        {point.endingBalance < 0 ? t('status.out') : point.net >= 0 ? t('status.positive') : t('status.burning')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={mutedStyle}>{source === 'observed' ? t('observedNote') : t('declaredNote')}</p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 'var(--font-size-eyebrow)', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary)' }}>{label}</div>
      <div style={{ fontSize: 'var(--font-size-card-title)', fontWeight: 700, color: tone ?? 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}
