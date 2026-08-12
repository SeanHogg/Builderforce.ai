'use client';

/**
 * THE sales report, rendered once.
 *
 * An associate reading their own week and the platform owner reading the whole
 * programme are looking at the same four things in the same order, so they look
 * at the same component. The ONLY difference is population, and that arrives as
 * data (`report.associateUserId` set or null, `report.associates` empty or not)
 * rather than as a `variant` prop — a prop would be the seam along which "an
 * admin's conversion rate" quietly became a different number from "a rep's".
 *
 * The four bands, in the order a revenue leader asks for them:
 *   1. Did we win?          → the window tiles.
 *   2. Will we win next?    → the funnel, and how much of it is stalled.
 *   3. Is the motion healthy? → conversion rate and days-to-convert, which move
 *                             before revenue does.
 *   4. Who needs help?      → the leaderboard (aggregate view only; it renders
 *                             nothing in a rep's own report because there is
 *                             nobody else in it).
 */

import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { BarChart } from '@/components/charts/BarChart';
import { SALES_REPORT_WINDOWS, type SalesReport, type SalesReportWindow } from '@/lib/salesApi';

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
};

const captionStyle: React.CSSProperties = {
  fontSize: 'var(--font-size-eyebrow)', fontWeight: 700, letterSpacing: '.08em',
  textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 10px',
};

export interface SalesReportViewProps {
  report: SalesReport;
  /** Which window the tiles headline. The rest stay visible as context. */
  window?: SalesReportWindow;
  onWindowChange?: (next: SalesReportWindow) => void;
  /** Called when a leaderboard row is chosen — the aggregate view's drill-down. */
  onSelectAssociate?: (associateUserId: string) => void;
}

export function SalesReportView({ report, window = 'month', onWindowChange, onSelectAssociate }: SalesReportViewProps) {
  const t = useTranslations('salesHub.report');
  const locale = useLocale();

  const money = useMemo(
    () => (cents: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100),
    [locale],
  );
  const number = useMemo(() => (value: number) => new Intl.NumberFormat(locale).format(value), [locale]);

  const current = report.windows.find((row) => row.window === window) ?? report.windows[0];

  const tiles = current ? [
    { key: 'signups', label: t('signups'), value: number(current.signups) },
    { key: 'conversions', label: t('conversions'), value: number(current.conversions) },
    { key: 'rate', label: t('conversionRate'), value: `${current.conversionRatePercent}%` },
    { key: 'revenue', label: t('revenue'), value: money(current.revenueCents) },
    { key: 'commission', label: t('commission'), value: money(current.commissionCents) },
    {
      key: 'speed',
      label: t('daysToConvert'),
      // `null` is "nothing converted in this window", which is a real answer and
      // not a zero — printing 0 days would claim instant conversions.
      value: current.averageDaysToConvert == null ? '—' : t('days', { days: current.averageDaysToConvert }),
    },
  ] : [];

  // A stage is a server value, so the catalog may not have caught up with a new
  // one — `t.has` is what keeps an unknown stage readable instead of printing a
  // missing-key marker into a revenue report.
  const funnel = report.funnel.map((row) => ({
    key: row.stage,
    label: t.has(`stage.${row.stage}`) ? t(`stage.${row.stage}`) : row.stage,
    value: row.count,
  }));

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {/* 1 — did we win? */}
      <section style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <p style={{ ...captionStyle, margin: 0 }}>{t('resultsTitle')}</p>
          <div className="ui-index" data-orientation="horizontal" role="group" aria-label={t('windowLabel')} style={{ margin: 0, paddingBottom: 0 }}>
            {SALES_REPORT_WINDOWS.map((option) => (
              <button
                key={option}
                type="button"
                className="ui-index__item"
                aria-current={option === window ? 'page' : undefined}
                onClick={() => onWindowChange?.(option)}
                style={{ cursor: onWindowChange ? 'pointer' : 'default' }}
              >
                {t(`window.${option}`)}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))', gap: 12 }}>
          {tiles.map((tile) => (
            <div key={tile.key}>
              <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.15 }}>{tile.value}</div>
              <div style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', marginTop: 2 }}>{tile.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 2 — will we win next? */}
      <section style={cardStyle}>
        <p style={captionStyle}>{t('funnelTitle')}</p>
        {funnel.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('funnelEmpty')}</p>
        ) : (
          <BarChart data={funnel} ariaLabel={t('funnelTitle')} formatValue={(value) => number(value)} labelWidth={110} />
        )}
        <p style={{ fontSize: 13, color: report.stalledContacts > 0 ? 'var(--coral-bright)' : 'var(--text-muted)', margin: '12px 0 0' }}>
          {report.stalledContacts > 0 ? t('stalled', { count: report.stalledContacts }) : t('noStalled')}
        </p>
      </section>

      {/* 4 — who needs help? Self-hiding: a rep's own report has no leaderboard. */}
      {report.associates.length > 0 && (
        <section style={cardStyle}>
          <p style={captionStyle}>{t('leaderboardTitle')}</p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 520 }}>
              <thead>
                <tr>
                  {[t('colAssociate'), t('colSignups'), t('colConversions'), t('colRevenue'), t('colCommission')].map((heading, index) => (
                    <th
                      key={heading}
                      style={{ textAlign: index === 0 ? 'left' : 'right', padding: '6px 10px 6px 0', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.associates.map((line) => (
                  <tr key={line.associateUserId} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '8px 10px 8px 0' }}>
                      {onSelectAssociate ? (
                        <button
                          type="button"
                          onClick={() => onSelectAssociate(line.associateUserId)}
                          style={{ background: 'none', border: 'none', padding: 0, color: 'var(--coral-bright)', fontWeight: 650, cursor: 'pointer', textAlign: 'left' }}
                        >
                          {line.name || line.email}
                        </button>
                      ) : (line.name || line.email)}
                    </td>
                    <td style={{ padding: '8px 10px 8px 0', textAlign: 'right' }}>{number(line.signups)}</td>
                    <td style={{ padding: '8px 10px 8px 0', textAlign: 'right' }}>{number(line.conversions)}</td>
                    <td style={{ padding: '8px 10px 8px 0', textAlign: 'right' }}>{money(line.revenueCents)}</td>
                    <td style={{ padding: '8px 10px 8px 0', textAlign: 'right', fontWeight: 650, color: 'var(--text-primary)' }}>{money(line.commissionCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

export default SalesReportView;
