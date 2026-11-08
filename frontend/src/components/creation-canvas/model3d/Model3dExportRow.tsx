import { useTranslations } from 'next-intl';
import { MODEL3D_EXPORT_ORDER, type Model3dExportFormat } from '@/lib/creation/model3d/model3dExport';
import type { ExportStatus } from '../creative/useExportArtifact';
import { ExportNotice } from '../creative/ExportNotice';
import styles from '../styles/creativeEditors.module.css';

export interface Model3dExportRowProps {
  status: ExportStatus;
  /** Whether there is anything to export. */
  hasParts: boolean;
  /** Difference/intersection operations the last export wrote as unions. */
  approximated: number;
  onExport: (format: Model3dExportFormat) => void;
}

const LABEL: Record<Model3dExportFormat, string> = { stl: 'STL', step: 'STEP' };

/** The export buttons and their outcome. A group that was exported as a union says so, instead of the file quietly differing from the part. */
export function Model3dExportRow({ status, hasParts, approximated, onExport }: Model3dExportRowProps) {
  const t = useTranslations('canvas.kinds.model3d.export');
  const busy = status === 'busy';
  return <>
    <div className={styles.toolbar}>
      <div className={styles.group} role="group" aria-label={t('label')}>
        {MODEL3D_EXPORT_ORDER.map((format) => <button key={format} type="button" className={styles.button} disabled={busy || !hasParts} onClick={() => onExport(format)}>{LABEL[format]}</button>)}
      </div>
      <span className={styles.status} role="status" aria-live="polite">
        {busy ? t('busy') : status === 'done' ? t('done') : status === 'failed' ? t('failed') : ''}
      </span>
      <ExportNotice status={status} />
    </div>
    {status === 'done' && approximated > 0 && <span className={styles.hint}>{t('approximated', { count: approximated })}</span>}
  </>;
}
