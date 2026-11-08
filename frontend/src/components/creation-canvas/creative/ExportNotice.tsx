import { useTranslations } from 'next-intl';
import styles from '../styles/creativeEditors.module.css';
import type { ExportStatus } from './useExportArtifact';

/**
 * The note an export leaves when the file reached the person's downloads but could not
 * be kept on the object (`unsaved`). One wording for every creative editor.
 */
export function ExportNotice({ status }: { status: ExportStatus }) {
  const t = useTranslations('canvas.kinds.common');
  if (status !== 'unsaved') return null;
  return <span className={styles.status} role="alert">{t('exportNotSaved')}</span>;
}
