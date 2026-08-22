'use client';

// Required directive — see the note in `RatingStars`.

import { useTranslations } from 'next-intl';
import { RATING_SCORES } from '@/lib/ratingScale';
import type { RatingSummary } from '@/lib/employersApi';
import { RatingStars } from './RatingStars';
import styles from './employers.module.css';

/**
 * The headline number, and the shape behind it.
 *
 * ── THE HISTOGRAM IS NOT DECORATION ──────────────────────────────────────────
 * An average of 4.2 built from forty 5s and ten 1s is a different employer from
 * one built from fifty 4s, and the single number cannot tell them apart. The
 * distribution is the only part of this card that answers "is this place
 * consistently decent, or is it great for some people and terrible for others" —
 * which is the actual question somebody reading employer reviews has.
 *
 * ── AN UNRATED EMPLOYER IS NOT A ZERO-STAR EMPLOYER ──────────────────────────
 * `average` is null when nobody has reviewed. Rendering that as "0.0 ★" beside a
 * real company's name is a false statement about a named organisation, so the
 * card says "not yet reviewed" instead.
 *
 * Takes its data as a prop rather than fetching: it is drawn both inside the
 * employer panel (which already has the summary) and on a directory card, and a
 * fetch here would be a second request for a number the parent is holding.
 */
export function RatingSummaryCard({ summary }: { summary: RatingSummary }) {
  const t = useTranslations('employers');

  if (summary.count === 0 || summary.average === null) {
    return <p className={styles.empty}>{t('summary.unrated')}</p>;
  }

  const peak = Math.max(...RATING_SCORES.map((score) => summary.distribution[score] ?? 0), 1);

  return (
    <div>
      <div className={styles.summaryHead}>
        <span className={styles.summaryAverage}>{summary.average.toFixed(1)}</span>
        <RatingStars value={summary.average} />
        <span className={styles.summaryCount}>{t('summary.count', { count: summary.count })}</span>
      </div>

      <div className={styles.histogram}>
        {/* Top-down from 5, the way every review histogram is read. */}
        {[...RATING_SCORES].reverse().map((score) => {
          const n = summary.distribution[score] ?? 0;
          return (
            <div key={score} className={styles.histogramRow}>
              <span>{t('rating.score', { score })}</span>
              {/* The bar is scaled to the BUSIEST bucket, not to the total, so a
                  distribution where every bucket is small is still legible. */}
              <span className={styles.histogramTrack}>
                <span
                  className={styles.histogramFill}
                  style={{ width: `${Math.round((n / peak) * 100)}%` }}
                />
              </span>
              <span className={styles.histogramCount}>{n}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
