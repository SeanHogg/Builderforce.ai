'use client';

// Required directive: this mounts from canvas surfaces and embedded apps as well
// as the employer pages, and several of those hosts are Server Components.

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { RATING_MAX } from '@/lib/ratingScale';
import styles from './employers.module.css';

/**
 * A star rating — read-only, or as an input.
 *
 * ── ONE COMPONENT FOR BOTH, DELIBERATELY ─────────────────────────────────────
 * The directory card, the review row, the summary and the form all draw the same
 * five stars. Written separately they drift: one rounds 4.6 up, another down, a
 * third renders four stars for a 4.5 and nobody notices which page is lying.
 * Read-only versus interactive is the presence of `onChange`, not a second file.
 *
 * ── THE INPUT IS A REAL RADIO GROUP ──────────────────────────────────────────
 * Not five click handlers on spans. A rating is a single choice from a fixed set,
 * which is what a radio group IS: it arrives in the tab order, arrows move
 * between options, and a screen reader announces "3 of 5" rather than reading out
 * five identical stars. The inputs are visually hidden by clip, never
 * `display:none`, which would remove them from the tab order entirely.
 */
export function RatingStars({
  value,
  onChange,
  label,
}: {
  /** 0–5. A fractional average is rounded for display; the number beside it
   *  carries the precision. */
  value: number;
  /** Omit for read-only. */
  onChange?: (next: number) => void;
  /** Accessible name for the group when interactive. */
  label?: string;
}) {
  const t = useTranslations('employers');
  const groupName = useId();
  const filled = Math.round(value);

  if (!onChange) {
    return (
      <span
        className={styles.stars}
        // One label carrying the number, rather than five stars a screen reader
        // reads out one at a time.
        role="img"
        aria-label={t('rating.outOf', { rating: value, max: RATING_MAX })}
      >
        {Array.from({ length: RATING_MAX }, (_, i) => (
          <span key={i} aria-hidden="true" className={`${styles.star} ${i < filled ? styles.starOn : ''}`}>
            ★
          </span>
        ))}
      </span>
    );
  }

  return (
    <span className={styles.stars} role="radiogroup" aria-label={label ?? t('rating.choose')}>
      {Array.from({ length: RATING_MAX }, (_, i) => {
        const score = i + 1;
        const id = `${groupName}-${score}`;
        return (
          <span key={score}>
            <input
              className={styles.starInput}
              type="radio"
              id={id}
              name={groupName}
              value={score}
              checked={value === score}
              onChange={() => onChange(score)}
            />
            <label
              className={`${styles.starLabel} ${score <= filled ? styles.starLabelOn : ''}`}
              htmlFor={id}
            >
              <span aria-hidden="true">★</span>
              <span className={styles.starInput}>{t('rating.score', { score })}</span>
            </label>
          </span>
        );
      })}
    </span>
  );
}
