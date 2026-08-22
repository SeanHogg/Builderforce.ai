'use client';

// Required directive — see the note in `RatingStars`.

import { useTranslations } from 'next-intl';
import { useFormat } from '@/i18n/useFormat';
import type { EmployerReview } from '@/lib/employersApi';
import { RatingStars } from './RatingStars';
import styles from './employers.module.css';

/**
 * What people said.
 *
 * Takes the reviews and nothing else. It resolves its own translations and its
 * own date formatter rather than accepting a `formatDate` or an `emptyLabel`
 * prop — those are things this component can work out for itself, and passing
 * them in is how the same list ends up formatting dates two ways depending on
 * which parent rendered it.
 *
 * Only ever handed APPROVED reviews: the server's `reviews` field excludes
 * pending and rejected rows, so there is no filter here to forget.
 */
export function ReviewList({ reviews }: { reviews: EmployerReview[] }) {
  const t = useTranslations('employers');
  const fmt = useFormat();

  return (
    <section className={`${styles.card} ${styles.wide}`} aria-labelledby="employer-reviews-heading">
      <h3 id="employer-reviews-heading" className={styles.cardTitle}>{t('detail.reviews')}</h3>

      {reviews.length === 0 ? (
        <p className={styles.empty}>{t('detail.noReviews')}</p>
      ) : (
        <div className={styles.scroller}>
          {reviews.map((review) => (
            <article key={review.id} className={`${styles.row} ${styles.rowStatic}`}>
              <div className={styles.rowBody}>
                <span className={styles.rowTitle}>{review.title}</span>
                <span className={styles.rowMeta}>
                  <RatingStars value={review.rating} />
                  <span className={styles.rowNote}>
                    {review.authorName ?? t('detail.anonymous')} · {fmt.date(review.createdAt)}
                  </span>
                  {review.verifiedAs && (
                    <span className={`${styles.badge} ${styles.badgeVerified}`}>
                      {t('detail.verified')}
                    </span>
                  )}
                </span>
                {review.body && <p className={styles.reviewBody}>{review.body}</p>}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
