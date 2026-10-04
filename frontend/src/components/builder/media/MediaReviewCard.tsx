import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import type { MediaReview } from './useMediaStudio';
import { MediaPreview } from './MediaPreview';
import styles from './MediaPanel.module.css';

/**
 * The agent made something and is WAITING: the asset, its prompt (editable, for
 * "Try again"), and the three answers. Nothing reaches the app's code until the
 * person picks "Use it".
 */
export function MediaReviewCard({ review }: { review: MediaReview }) {
  const t = useTranslations('ide.media');
  const { item, decide } = review;
  const [prompt, setPrompt] = useState(item.prompt);
  return (
    <section className={`${styles.section} ${styles.review}`} aria-label={t('reviewTitle')}>
      <h3 className={styles.sectionTitle}>{t('reviewTitle')}</h3>
      <p className={styles.reviewLead}>{t(item.kind === 'video' ? 'reviewLeadVideo' : 'reviewLeadImage')}</p>
      <MediaPreview item={item} variant="full" />
      <label className={styles.field}>
        <span>{t('promptLabel')}</span>
        <textarea className={styles.textarea} rows={3} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
      </label>
      <div className={styles.actions}>
        <Button type="button" variant="primary" size="sm" disabled={item.status !== 'ready'} onClick={() => decide({ action: 'use' })}>{t('useIt')}</Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => decide({ action: 'retry', prompt })}>{t('tryAgain')}</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => decide({ action: 'discard' })}>{t('discard')}</Button>
      </div>
    </section>
  );
}
