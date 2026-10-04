import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import { Icon } from '@/components/ui/Icon';
import { canvasBuildBinding } from '@/lib/canvasBuild';
import { canvasWebPageUrl } from '@/lib/canvasWebPage';
import { useModalityCopy } from '@/lib/useModalityCopy';
import type { CreationBodyProps } from './types';

/**
 * Builder tile — the Canvas face of a real build. It reports the binding
 * (type, workspace state, published URL) and leaves every capability to Builder
 * surface the inspector opens, so nothing here duplicates the builder itself.
 */
export function BuildBody({ data }: CreationBodyProps) {
  const t = useTranslations('creationCanvas.build');
  const modality = useModalityCopy()(typeof data.modality === 'string' ? data.modality : null);
  const binding = canvasBuildBinding(data);
  const siteUrl = canvasWebPageUrl(data);
  return (
    <div className={styles.buildBody}>
      <div className={styles.buildType}>
        <span aria-hidden><Icon source={modality.icon} size={18} /></span>
        <strong>{modality.label}</strong>
        <em data-bound={binding ? 'true' : 'false'}>{binding ? t('tileReady') : t('tileNotCreated')}</em>
      </div>
      <p>{binding ? t('tileBoundHint') : t('tileUnboundHint')}</p>
      <div className={styles.pills}>
        {modality.showRunButton && <span>{t('pillDevServer')}</span>}
        {modality.showChecks && <span>{t('pillChecks')}</span>}
        <span>{t('pillPublish')}</span>
      </div>
      {siteUrl && <a className={styles.buildLink} href={siteUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{siteUrl}</a>}
    </div>
  );
}
