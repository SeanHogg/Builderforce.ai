'use client';

// Required directive — see the note in `RatingStars`.

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useFormat } from '@/i18n/useFormat';
import { useOptionalAuth } from '@/lib/AuthContext';
import {
  decideReview, fetchModerationQueue, type PendingReview,
} from '@/lib/employersApi';
import { RatingStars } from './RatingStars';
import styles from './employers.module.css';

/**
 * Reviews waiting for a decision.
 *
 * ── SELF-GATING ON THE ROLE, WITHOUT ASKING FOR IT ───────────────────────────
 * The queue endpoint is manager-gated, so a member without the role gets a 403
 * and this renders nothing. That is deliberate: the alternative is a `canModerate`
 * prop computed by whichever parent mounts it, which the second parent gets wrong.
 * A 403 here is not an error worth shouting about — it is the answer "you are not
 * a moderator", and the card simply has nothing to say.
 *
 * ── REJECTING TAKES A REASON, APPROVING DOES NOT ─────────────────────────────
 * An approved review explains itself by being published. A rejected one is
 * invisible to everyone but its author, who is owed a reason — otherwise the
 * refusal reads as a bug in submission and they write it again.
 *
 * ── THE FULL BODY IS SHOWN ───────────────────────────────────────────────────
 * Not a truncated preview with a "read more". Somebody is being asked to decide
 * whether a claim about a named company may be published; deciding that from the
 * first eighty characters is not deciding it.
 */
export function ReviewModerationQueue() {
  const t = useTranslations('employers');
  const fmt = useFormat();
  const hasTenant = useOptionalAuth()?.hasTenant ?? false;

  const [rows, setRows] = useState<PendingReview[] | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    fetchModerationQueue()
      .then((result) => { setRows(result.rows); setWaiting(result.waiting); })
      // 403 for a non-manager. Not an error state — just nothing to show.
      .catch(() => setRows([]));
  }, []);

  useEffect(() => { if (hasTenant) load(); }, [hasTenant, load]);

  // No session, still loading, not entitled, or an empty queue — all mean the
  // card has nothing to contribute to the page.
  if (!hasTenant || rows === null || rows.length === 0) return null;

  const decide = async (id: number, decision: 'published' | 'rejected') => {
    setBusyId(id); setError('');
    try {
      await decideReview(id, decision, reasons[id]?.trim() || undefined);
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('moderation.failed'));
    } finally { setBusyId(null); }
  };

  return (
    <section className={`${styles.card} ${styles.wide}`} aria-labelledby="review-moderation-heading">
      <h3 id="review-moderation-heading" className={styles.cardTitle}>
        {t('moderation.title', { count: waiting })}
      </h3>
      <p className={styles.cardHint}>{t('moderation.intro')}</p>

      <div className={styles.scroller}>
        {rows.map((row) => (
          <article key={row.id} className={`${styles.row} ${styles.rowStatic}`}>
            <div className={styles.rowBody}>
              <span className={styles.rowTitle}>{row.title}</span>
              <span className={styles.rowMeta}>
                <RatingStars value={row.rating} />
                <span className={styles.rowNote}>
                  {t('moderation.about', { subject: row.subjectTitle || row.subjectKind })}
                  {' · '}
                  {row.authorName ?? t('detail.anonymous')}
                  {' · '}
                  {fmt.dateTime(row.submittedAt)}
                </span>
                <span className={`${styles.badge} ${row.status === 'rejected' ? styles.badgeRejected : styles.badgePending}`}>
                  {t(`moderation.status.${row.status === 'rejected' ? 'rejected' : 'pending'}`)}
                </span>
              </span>

              {row.body && <p className={styles.reviewBody}>{row.body}</p>}

              <div className={styles.field}>
                <label className={styles.label} htmlFor={`moderation-reason-${row.id}`}>
                  {t('moderation.reason')}
                </label>
                <input
                  id={`moderation-reason-${row.id}`} className={styles.input}
                  value={reasons[row.id] ?? ''}
                  onChange={(e) => setReasons((prev) => ({ ...prev, [row.id]: e.target.value }))}
                  placeholder={t('moderation.reasonPlaceholder')}
                />
              </div>

              <div className={styles.buttonRow}>
                <button
                  type="button" className={styles.button}
                  disabled={busyId !== null}
                  onClick={() => void decide(row.id, 'published')}
                >
                  {busyId === row.id ? t('moderation.working') : t('moderation.approve')}
                </button>
                <button
                  type="button" className={styles.button}
                  // A rejection without a reason leaves the author with an
                  // invisible review and no explanation, so the button waits for one.
                  disabled={busyId !== null || !(reasons[row.id] ?? '').trim()}
                  onClick={() => void decide(row.id, 'rejected')}
                >
                  {t('moderation.reject')}
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>

      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}
