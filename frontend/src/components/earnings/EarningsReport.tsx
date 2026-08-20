/**
 * THE STATEMENT — what was earned, what the platform took, what is left, and every
 * movement behind it.
 *
 * ── WHY GROSS, FEE AND NET ARE THREE COLUMNS AND NOT ONE ─────────────────────────
 * They are three different facts and a person needs all three. "Gross" is what the work
 * was worth, "fee" is what the platform took, "net" is what landed — and a statement
 * that shows only the last is the one that makes somebody suspect the first two.
 * `SellerEarnings` learned the same lesson about earned/paid/available and this follows
 * it deliberately rather than inventing a second way to present money.
 *
 * ── HELD IS NOT EARNED, AND SAYING SO IS THE POINT ───────────────────────────────
 * Escrow money that is funded but not released belongs to nobody yet. It is shown
 * because a freelancer asking "what have I made" is also asking "what is coming", and
 * it is shown SEPARATELY because folding it into a balance would be telling somebody
 * they have money they cannot draw.
 *
 * ── EVERY CLASSIFICATION COMES FROM THE SERVER ───────────────────────────────────
 * `EarningsTransaction.kind` is decided by `classifyLedgerEntry`, because `entry_kind`
 * alone cannot tell an escrow release from a bank withdrawal — both are `payout` on the
 * same account, and only the reference separates them. A copy of that rule here would
 * be the one that eventually shows somebody their earnings as withdrawals.
 */

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { BarChart } from '@/components/charts/BarChart';
import { InsightStat } from '@/components/dashboard/InsightStat';
import { useMoneyFormat } from '@/lib/useMoneyFormat';
import { useFormat } from '@/i18n/useFormat';
import { EARNINGS_PERIODS, type EarningKind, type EarningsPeriod, type EarningsReport as Report } from '@/lib/earningsApi';
import { PlatformFeeCard } from './PlatformFeeCard';

const KIND_TONE: Record<EarningKind, string> = {
  sale: 'var(--success)',
  escrow_release: 'var(--success)',
  refund: 'var(--danger)',
  withdrawal: 'var(--text-secondary)',
  adjustment: 'var(--text-muted)',
};

export function EarningsReportView({
  report,
  period,
  onPeriodChange,
  busy,
}: {
  report: Report;
  period: EarningsPeriod;
  onPeriodChange: (next: EarningsPeriod) => void;
  busy?: boolean;
}) {
  const t = useTranslations('earnings');
  const { formatCents } = useMoneyFormat();
  const fmt = useFormat();

  const bars = useMemo(
    () => report.buckets.map((bucket) => ({
      key: bucket.period,
      label: bucket.period,
      value: bucket.netCents,
      // The faint track behind each bar is GROSS, so the platform's cut is visible as
      // the gap rather than as a number somebody has to subtract in their head.
      secondary: bucket.grossCents,
    })),
    [report.buckets],
  );

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{
        display: 'grid', gap: 12,
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(160px, 100%), 1fr))',
      }}>
        <InsightStat label={t('gross')} value={formatCents(report.summary.grossCents)} sub={t('grossSub')} />
        <InsightStat label={t('platformFee')} value={formatCents(report.summary.platformFeeCents)} sub={t('platformFeeSub')} />
        <InsightStat label={t('net')} value={formatCents(report.summary.netCents)} sub={t('netSub')} />
        <InsightStat label={t('held')} value={formatCents(report.summary.heldCents)} sub={t('heldSub')} />
        <InsightStat label={t('withdrawn')} value={formatCents(report.summary.withdrawnCents)} sub={t('withdrawnSub')} />
        <InsightStat label={t('available')} value={formatCents(report.summary.availableCents)} sub={t('availableSub')} />
      </div>

      {report.settlement === 'manual' && (
        // Honest degradation, stated rather than hidden: with no payout provider the
        // books are still correct and an operator completes the transfer.
        <p role="status" style={{
          margin: 0, padding: '10px 12px', borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-subtle)', background: 'var(--bg-base)',
          color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)',
        }}>{t('settlementManual')}</p>
      )}

      <PlatformFeeCard quote={report.fee} schedule={null} />

      <section aria-label={t('byPeriod')} style={{
        display: 'grid', gap: 12, padding: 18, borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-subtle)', background: 'var(--surface-card)',
      }}>
        <header style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <h2 style={{
            margin: 0, fontSize: 'var(--font-size-card-title)', fontWeight: 700,
            color: 'var(--text-primary)',
          }}>{t('byPeriod')}</h2>
          <div role="group" aria-label={t('periodLabel')} style={{ marginInlineStart: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {EARNINGS_PERIODS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => onPeriodChange(option)}
                disabled={busy}
                aria-pressed={option === period}
                className={option === period ? 'btn btn-primary' : 'btn btn-secondary'}
                style={{ fontSize: 'var(--font-size-eyebrow)', padding: '4px 10px' }}
              >{t(`period.${option}`)}</button>
            ))}
          </div>
        </header>

        {bars.length === 0
          ? <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('noMovements')}</p>
          : <BarChart data={bars} ariaLabel={t('byPeriod')} formatValue={(v) => formatCents(v)} monochrome labelWidth={88} />}
      </section>

      <section aria-label={t('transactions')} style={{
        display: 'grid', gap: 10, padding: 18, borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-subtle)', background: 'var(--surface-card)',
      }}>
        <h2 style={{
          margin: 0, fontSize: 'var(--font-size-card-title)', fontWeight: 700,
          color: 'var(--text-primary)',
        }}>{t('transactions')}</h2>

        {report.transactions.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('noMovements')}</p>
        ) : (
          // Scrolls inside its own container: a wide table must never make the PAGE
          // scroll sideways at 360px.
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 620, borderCollapse: 'collapse', fontSize: 'var(--font-size-small)' }}>
              <thead>
                <tr>
                  {[t('colDate'), t('colWhat'), t('colWorkspace'), t('colFee'), t('colAmount')].map((heading, index) => (
                    <th key={heading} scope="col" style={{
                      textAlign: index >= 3 ? 'end' : 'start',
                      padding: '6px 8px', color: 'var(--text-secondary)',
                      fontSize: 'var(--font-size-eyebrow)', textTransform: 'uppercase',
                      letterSpacing: '.08em', borderBottom: '1px solid var(--border-subtle)',
                    }}>{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.transactions.map((row) => (
                  <tr key={row.id}>
                    <td style={cell}>{fmt.date(new Date(row.occurredAtISO))}</td>
                    <td style={cell}>
                      <span style={{ color: KIND_TONE[row.kind], fontWeight: 600 }}>{t(`kind.${row.kind}`)}</span>
                      {row.memo && (
                        <span style={{ display: 'block', color: 'var(--text-secondary)' }}>{row.memo}</span>
                      )}
                      {/* The reference IS the idempotency key the ledger is unique on —
                          the string a person quotes when they ask about a payment. */}
                      {row.reference && (
                        <code style={{ display: 'block', color: 'var(--text-muted)', fontSize: 'var(--font-size-eyebrow)' }}>
                          {row.reference}
                        </code>
                      )}
                    </td>
                    <td style={cell}>{row.workspaceName ?? t('unknownWorkspace')}</td>
                    <td style={{ ...cell, textAlign: 'end' }}>
                      {row.feeCents > 0 ? formatCents(row.feeCents) : '—'}
                    </td>
                    <td style={{ ...cell, textAlign: 'end', color: row.amountCents < 0 ? 'var(--danger)' : 'var(--text-primary)' }}>
                      {formatCents(row.amountCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {report.transactionsTruncated && (
          // Said out loud rather than left to be inferred: a person who believes a page
          // is the whole history will conclude money is missing.
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-eyebrow)' }}>
            {t('truncated', { count: report.transactions.length })}
          </p>
        )}
      </section>
    </div>
  );
}

const cell: React.CSSProperties = {
  padding: '8px', verticalAlign: 'top',
  borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-primary)',
};
