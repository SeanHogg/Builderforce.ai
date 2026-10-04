import { useTranslations } from 'next-intl';
import type { ProjectMediaItem } from '@/lib/projectMediaApi';
import styles from './MediaPanel.module.css';

/** One media item as pixels: the image, the playable clip, or why there is none yet. */
export function MediaPreview({ item, variant }: { item: ProjectMediaItem; variant: 'thumb' | 'full' }) {
  const t = useTranslations('ide.media');
  const className = variant === 'full' ? styles.preview : styles.thumb;
  if (item.status === 'rendering') return <span className={styles.placeholder}>{t('rendering')}</span>;
  if (item.status === 'failed' || !item.url) return <span className={styles.placeholder}>{item.error || t('failed')}</span>;
  if (item.kind === 'video') {
    return variant === 'full'
      ? <video className={className} src={item.url} controls playsInline aria-label={item.prompt} />
      : <video className={className} src={item.url} muted playsInline preload="metadata" aria-label={item.prompt} />;
  }
  // A plain <img>: a generated asset can live on any vendor's host, which next/image would need allow-listed.
  return <img className={className} src={item.url} alt={item.prompt} loading="lazy" />;
}
