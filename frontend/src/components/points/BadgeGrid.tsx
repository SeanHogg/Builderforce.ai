'use client';

import { useTranslations } from 'next-intl';
import { usePoints } from '@/lib/usePoints';
import styles from './points.module.css';

/**
 * Badges held, and — behind a toggle — the ones still to earn.
 *
 * The "still to earn" half is the difference between a trophy case and something
 * that tells you what to do next, and it is why the server returns `available`
 * alongside `badges` rather than leaving the client to diff two lists it would
 * have to fetch separately.
 *
 * Icons are emoji keyed by `iconKey` so a badge's glyph is DATA the server owns.
 * An unknown key falls back rather than rendering an empty box — a badge whose
 * definition was renamed must still appear on the profile of somebody holding it.
 */

const GLYPHS: Record<string, string> = {
  check: '✅', trophy: '🏆', send: '📨', sparkle: '✨', message: '💬',
  bookmark: '🔖', document: '📄', card: '💳', book: '📚', seal: '🎖️',
  route: '🧭', lectern: '🎓', palette: '🎨', calendar: '📅', headset: '🎧',
  quote: '💬', star: '⭐', eye: '👀', flame: '🔥', badge: '🏅',
};

const glyph = (key: string) => GLYPHS[key] ?? GLYPHS.badge;

export function BadgeGrid() {
  const t = useTranslations('points');
  const { summary } = usePoints();

  if (!summary) return null;

  return (
    <section className={styles.card} aria-labelledby="points-badges-heading">
      <h3 id="points-badges-heading" className={styles.cardTitle}>
        {t('badges.title', { count: summary.badges.length })}
      </h3>

      {summary.badges.length === 0 ? (
        <p className={styles.empty}>{t('badges.empty')}</p>
      ) : (
        <ul className={styles.badgeGrid}>
          {summary.badges.map((badge) => (
            <li key={badge.key} className={styles.badge} title={badge.description}>
              <span className={styles.badgeGlyph} aria-hidden="true">{glyph(badge.iconKey)}</span>
              <span className={styles.badgeName}>{badge.name}</span>
            </li>
          ))}
        </ul>
      )}

      {summary.available.length > 0 && (
        <details className={styles.details}>
          <summary className={styles.detailsSummary}>
            {t('badges.toEarn', { count: summary.available.length })}
          </summary>
          <ul className={styles.badgeGrid}>
            {summary.available.map((badge) => (
              <li key={badge.key} className={`${styles.badge} ${styles.badgeLocked}`} title={badge.description}>
                <span className={styles.badgeGlyph} aria-hidden="true">{glyph(badge.iconKey)}</span>
                <span className={styles.badgeName}>{badge.name}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
