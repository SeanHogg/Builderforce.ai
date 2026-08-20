/**
 * THE PLATFORM FEE, SAID OUT LOUD.
 *
 * The fee was real and invisible: priced correctly at the instant of sale, stamped on
 * the order line, recorded in the ledger — and never shown to the person paying it. A
 * fee nobody can inspect is indistinguishable from a fee nobody agreed to.
 *
 * Three facts, in the order a seller asks for them:
 *   1. WHAT it is right now (0% under the threshold is the answer most sellers have).
 *   2. WHY it is that — the lifetime-volume threshold, with the distance still to go.
 *   3. WHERE it applies, which is the fact an implicit fee model hides best: the take
 *      rate is charged on catalogue sales and NOT on escrow releases, and before there
 *      was anything to inspect two people would have guessed two different answers.
 *
 * Every number arrives resolved from the server. Nothing here multiplies anything by a
 * basis-point figure — a second calculation in the browser would be a second answer to
 * "what does this cost", shown to the person paying it.
 */

import { useTranslations } from 'next-intl';
import { useMoneyFormat } from '@/lib/useMoneyFormat';
import type { PlatformFeeQuote, PlatformFeeSchedule } from '@/lib/earningsApi';

/** Basis points as a trimmed percentage — whole for a round rate, two decimals
 *  otherwise, so 1500 reads "15" and 1050 reads "10.50". */
function bpsLabel(bps: number): string {
  return (bps / 100).toFixed(bps % 100 === 0 ? 0 : 2);
}

export function PlatformFeeCard({
  quote,
  schedule,
}: {
  quote: PlatformFeeQuote;
  schedule: PlatformFeeSchedule | null;
}) {
  const t = useTranslations('earnings');
  const { formatCents } = useMoneyFormat();

  const progress = quote.thresholdCents > 0
    ? Math.min(100, Math.max(0, (quote.lifetimeCents / quote.thresholdCents) * 100))
    : 100;

  return (
    <section
      aria-label={t('feeHeading')}
      style={{
        display: 'grid', gap: 12, padding: 18, borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-subtle)', background: 'var(--surface-card)',
      }}
    >
      <header style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
        <h2 style={{
          margin: 0, fontSize: 'var(--font-size-card-title)', fontWeight: 700,
          color: 'var(--text-primary)',
        }}>{t('feeHeading')}</h2>
        <span style={{
          marginInlineStart: 'auto',
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--font-size-card-title)',
          color: quote.waived ? 'var(--success)' : 'var(--text-primary)',
        }}>{t('feeRate', { rate: bpsLabel(quote.feeBps) })}</span>
      </header>

      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>
        {quote.reason === 'under_threshold'
          ? t('feeWhyUnderThreshold', {
            rate: bpsLabel(quote.configuredBps),
            threshold: formatCents(quote.thresholdCents),
            remaining: formatCents(quote.remainingToThresholdCents),
          })
          : quote.reason === 'platform_listing'
            ? t('feeWhyPlatformListing', { rate: bpsLabel(quote.feeBps) })
            : t('feeWhyStandard', {
              rate: bpsLabel(quote.feeBps),
              threshold: formatCents(quote.thresholdCents),
            })}
      </p>

      {quote.reason === 'under_threshold' && (
        // The progress bar is the argument, not decoration: "you are paying nothing"
        // means little without showing how much runway is left before that changes.
        <div style={{ display: 'grid', gap: 6 }}>
          <div
            role="progressbar"
            aria-valuenow={Math.round(progress)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('feeProgressLabel')}
            style={{
              height: 8, borderRadius: 'var(--radius-full)', overflow: 'hidden',
              background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ width: `${progress}%`, height: '100%', background: 'var(--success)' }} />
          </div>
          <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-secondary)' }}>
            {t('feeProgress', {
              earned: formatCents(quote.lifetimeCents),
              threshold: formatCents(quote.thresholdCents),
            })}
          </span>
        </div>
      )}

      {schedule && (
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-eyebrow)' }}>
          {/* The asymmetry an implicit fee model hides: escrow releases are not charged. */}
          {schedule.appliesTo.includes('escrow_release')
            ? t('feeAppliesEverywhere')
            : t('feeAppliesCatalogueOnly')}
        </p>
      )}
    </section>
  );
}
