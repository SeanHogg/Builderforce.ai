'use client';

// Required directive — see the note in `RatingStars`.

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import {
  fetchEmployer, submitEmployerReview, withdrawEmployerReview,
  type EmployerDetail,
} from '@/lib/employersApi';
import { RATING_MIN } from '@/lib/ratingScale';
import { RatingStars } from './RatingStars';
import { RatingSummaryCard } from './RatingSummaryCard';
import { ReviewList } from './ReviewList';
import styles from './employers.module.css';

/**
 * One employer: what it scores, what people said, and the form to say something.
 *
 * ── A PENDING REVIEW IS SHOWN TO ITS AUTHOR ──────────────────────────────────
 * Employer reviews are held for approval, so between submitting and being
 * approved the author sees nothing of their own on the public list. Without this,
 * that reads as "it did not save" and they write it again — which the one-review-
 * per-person index then turns into a silent overwrite. So `mine` comes back in
 * any state and is rendered with its status.
 *
 * ── SUBMIT IS ALSO EDIT ──────────────────────────────────────────────────────
 * There is no separate edit mode because there is no separate row: the server
 * upserts on (object, author). The button says "update" when a review exists,
 * and the form is pre-filled from it.
 */
export function EmployerReviewPanel({ employerId }: { employerId: number }) {
  const t = useTranslations('employers');
  const confirm = useConfirm();

  const [detail, setDetail] = useState<EmployerDetail | null>(null);
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [axisScores, setAxisScores] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    fetchEmployer(employerId)
      .then((next) => {
        setDetail(next);
        // Pre-fill from the caller's existing review, so "update" starts from
        // what they actually wrote rather than from an empty form.
        if (next.mine) {
          setRating(next.mine.rating);
          setTitle(next.mine.title);
          setBody(next.mine.body);
          setAxisScores(next.mine.subRatings ?? {});
        }
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : t('detail.failed')));
  }, [employerId, t]);

  useEffect(() => { load(); }, [load]);

  if (!detail) return null;

  const save = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      await submitEmployerReview(employerId, {
        rating, title: title.trim(), body: body.trim(), subRatings: axisScores,
      });
      // Moderated, so it does NOT appear on the public list yet. Saying so here
      // is the difference between "nothing happened" and "it is with a reviewer".
      setNotice(t('form.submittedPending'));
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('form.failed'));
    } finally { setBusy(false); }
  };

  const withdraw = async () => {
    const ok = await confirm({
      title: t('form.withdrawTitle'),
      message: t('form.withdrawMessage', { name: detail.employer.name }),
      confirmLabel: t('form.withdrawAction'),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await withdrawEmployerReview(employerId);
      setRating(0); setTitle(''); setBody(''); setAxisScores({});
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('form.withdrawFailed'));
    } finally { setBusy(false); }
  };

  const { employer, mine } = detail;

  return (
    <>
      <section className={styles.card} aria-labelledby="employer-summary-heading">
        <h3 id="employer-summary-heading" className={styles.cardTitle}>{employer.name}</h3>
        <p className={styles.cardHint}>
          {[employer.sector, employer.country, employer.headcount ? t('detail.headcount', { count: employer.headcount }) : null]
            .filter(Boolean).join(' · ')}
        </p>
        {employer.website && (
          <p className={styles.rowNote}>
            {/* `noopener` on an outbound link to a company site — without it the
                opened tab can navigate this one through `window.opener`. */}
            <a href={employer.website} target="_blank" rel="noopener noreferrer">{employer.website}</a>
          </p>
        )}
        <RatingSummaryCard summary={detail.summary} />
      </section>

      <section className={styles.card} aria-labelledby="employer-form-heading">
        <h3 id="employer-form-heading" className={styles.cardTitle}>
          {mine ? t('form.updateTitle') : t('form.title')}
        </h3>

        {mine && mine.status !== 'published' && (
          <p className={styles.notice} role="status">
            {mine.status === 'pending' ? t('form.yoursPending') : t('form.yoursRejected')}
          </p>
        )}

        <div className={styles.form}>
          <div className={styles.field}>
            <span className={styles.label}>{t('form.rating')}</span>
            <RatingStars value={rating} onChange={setRating} label={t('form.rating')} />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="employer-review-title">{t('form.headline')}</label>
            <input
              id="employer-review-title" className={styles.input} value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('form.headlinePlaceholder')} maxLength={120}
            />
          </div>

          {/* Driven by the SERVER's axis registry — never a list typed here, which
              would let the form collect an axis the submit path drops. */}
          {detail.axes.map((axis) => (
            <div key={axis.key} className={styles.field}>
              <span className={styles.label}>{t(`axis.${axis.labelKey}`)}</span>
              <RatingStars
                value={axisScores[axis.key] ?? 0}
                onChange={(next) => setAxisScores((prev) => ({ ...prev, [axis.key]: next }))}
                label={t(`axis.${axis.labelKey}`)}
              />
            </div>
          ))}

          <div className={styles.field}>
            <label className={styles.label} htmlFor="employer-review-body">{t('form.body')}</label>
            <textarea
              id="employer-review-body" className={styles.textarea} value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t('form.bodyPlaceholder')}
            />
          </div>

          <div className={styles.buttonRow}>
            <button
              type="button" className={styles.button}
              disabled={busy || rating < RATING_MIN || title.trim().length === 0}
              onClick={() => void save()}
            >
              {busy ? t('form.saving') : mine ? t('form.update') : t('form.submit')}
            </button>
            {mine && (
              <button type="button" className={styles.button} disabled={busy} onClick={() => void withdraw()}>
                {t('form.withdraw')}
              </button>
            )}
          </div>

          <p className={styles.cardHint}>{t('form.moderationNote')}</p>
        </div>

        {notice && <p className={styles.notice} role="status">{notice}</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
      </section>

      {/* Takes the rows and nothing else — it resolves its own copy and its own
          date formatter. */}
      <ReviewList reviews={detail.reviews} />
    </>
  );
}
