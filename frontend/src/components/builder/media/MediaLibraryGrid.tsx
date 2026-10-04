import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/ui';
import { useConfirm } from '@/components/ConfirmProvider';
import { useDockedBrain } from '@/lib/brain/dockedBrain';
import type { ProjectMediaItem } from '@/lib/projectMediaApi';
import { MediaPreview } from './MediaPreview';
import styles from './MediaPanel.module.css';

/**
 * Everything generated for this project, newest first. A tile opens a full
 * preview; "Use in app" hands the chat a ready-made request (the person says
 * where, then sends) — placing an asset is the agent's job, not a guess here.
 */
export function MediaLibraryGrid({ items, loading, onRemove }: {
  items: ProjectMediaItem[];
  loading: boolean;
  onRemove: (id: string) => Promise<void>;
}) {
  const t = useTranslations('ide.media');
  const confirm = useConfirm();
  const docked = useDockedBrain();
  const [openId, setOpenId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const open = items.find((item) => item.id === openId) ?? null;

  const copy = async (item: ProjectMediaItem) => {
    if (!item.url) return;
    await navigator.clipboard.writeText(item.url);
    setCopiedId(item.id);
  };

  const remove = async (item: ProjectMediaItem) => {
    if (!(await confirm({ message: t('deleteConfirm'), confirmLabel: t('delete') }))) return;
    if (openId === item.id) setOpenId(null);
    await onRemove(item.id);
  };

  if (!loading && items.length === 0) {
    return <EmptyState icon="🖼" title={t('emptyTitle')} description={t('emptyBody')} />;
  }

  return (
    <section className={styles.section} aria-label={t('libraryTitle')}>
      <h3 className={styles.sectionTitle}>{t('libraryTitle')}</h3>
      {loading && <p className={styles.status}>{t('loading')}</p>}
      {open && (
        <div className={styles.section}>
          <MediaPreview item={open} variant="full" />
          <p className={styles.reviewLead}>{open.prompt}</p>
        </div>
      )}
      <div className={styles.grid}>
        {items.map((item) => (
          <article key={item.id} className={`${styles.tile} ${item.id === openId ? styles.tileSelected : ''}`}>
            <button
              type="button"
              className={styles.thumbButton}
              aria-label={t('openPreview', { prompt: item.prompt })}
              aria-pressed={item.id === openId}
              onClick={() => setOpenId(item.id === openId ? null : item.id)}
            >
              <MediaPreview item={item} variant="thumb" />
            </button>
            <p className={styles.tilePrompt} title={item.prompt}>{item.prompt}</p>
            {item.usedAt && <span className={styles.badge}>{t('inApp')}</span>}
            {item.status === 'ready' && item.url && (
              <div className={styles.tileActions}>
                {docked && (
                  <button type="button" onClick={() => docked.seedComposer(t(item.kind === 'video' ? 'useInAppVideoPrompt' : 'useInAppImagePrompt', { url: item.url ?? '' }))}>
                    {t('useInApp')}
                  </button>
                )}
                <button type="button" onClick={() => void copy(item)}>{copiedId === item.id ? t('copied') : t('copyLink')}</button>
                <button type="button" onClick={() => void remove(item)}>{t('delete')}</button>
              </div>
            )}
            {item.status === 'failed' && (
              <div className={styles.tileActions}>
                <button type="button" onClick={() => void remove(item)}>{t('delete')}</button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
