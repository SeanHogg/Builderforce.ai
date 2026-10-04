import { useTranslations } from 'next-intl';
import type { CreationNodeData } from '../types';
import styles from '../CreationCanvas.module.css';
import { creativePreviewImageUrl } from '@/lib/creationDeliverables';
import { formatBytes } from '@/lib/formatBytes';
import type { CreationBodyProps } from './types';
import { textValue } from './shared';

/** Non-tabular attachments. Tabular uploads become Dataset objects instead, so
 * this card only has to make an opaque file legible. */
/**
 * The card a dropped file gets BEFORE it has been read.
 *
 * Reading a document is synchronous CPU that can hold the main thread for
 * seconds, so the artifact cannot appear at the moment of the drop — but the
 * CARD can, and it says which file it is standing in for. Rendered by
 * {@link FileBody} because every import begins life as a `file` object and
 * becomes its real kind in place, so the stub and the thing it turns into are
 * one card that fills in rather than two that swap.
 */
function ImportPendingBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const size = Number(data.fileSize);
  return <div className={styles.importPending} role="status" aria-live="polite">
    <span className={styles.importSpinner} aria-hidden />
    <div>
      <b>{t('importReading')}</b>
      <small>{textValue(data.fileName, data.title)}{Number.isFinite(size) && size > 0 ? ` · ${formatBytes(size)}` : ''}</small>
    </div>
    {/* Three lines of the page that is coming, so the wait reads as a document
        arriving rather than as a card that failed to render. */}
    <div className={styles.importSkeleton} aria-hidden><i /><i /><i /></div>
  </div>;
}

export function FileBody({ data }: CreationBodyProps) {
  const t = useTranslations('creationCanvas.node');
  const name = textValue(data.fileName, data.title);
  const mimeType = textValue(data.mimeType, t('fileGeneric'));
  const size = Number(data.fileSize);
  if (data.importPending === true) return <ImportPendingBody data={data} />;
  const preview = textValue(data.content, textValue(data.markdown));
  const image = creativePreviewImageUrl(data);
  return <div className={styles.fileBody}>
    <div className={styles.widgetSettings}>
      <span><small>{t('fileType')}</small><b>{mimeType}</b></span>
      {Number.isFinite(size) && size > 0 && <span><small>{t('fileSize')}</small><b>{formatBytes(size)}</b></span>}
    </div>
    {image
      ? <img className={styles.filePreviewImage} src={image} alt={t('filePreviewAlt', { name })} width={440} height={330} style={{ height: 'auto' }} />
      : preview
        ? <pre className={`${styles.filePreview} nowheel nodrag`} tabIndex={0}>{preview.slice(0, 4_000)}</pre>
        : <p className={styles.filePreviewEmpty}>{t('filePreviewUnavailable')}</p>}
  </div>;
}
