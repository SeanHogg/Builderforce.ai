import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import { Icon } from '@/components/ui/Icon';
import { canvasBuildBinding } from '@/lib/canvasBuild';
import { canvasAppLocalKey } from '@/lib/canvasSessionApp';
import { canvasWebPageUrl } from '@/lib/canvasWebPage';
import { useModalityCopy } from '@/lib/useModalityCopy';
import type { CreationBodyProps } from './types';

/**
 * Builder tile — the Canvas face of a real build. It reports the binding
 * (type, workspace state, published URL) and leaves every capability to the App
 * surface it opens, so nothing here duplicates the builder itself. A workspace held in
 * this browser (a board with no account yet) reads as its own state, not as "not created".
 */
const TILE_STATE = { ready: 'tileReady', local: 'tileLocal', none: 'tileNotCreated' } as const;
const TILE_HINT = { ready: 'tileBoundHint', local: 'tileLocalHint', none: 'tileUnboundHint' } as const;

export function BuildBody({ data }: CreationBodyProps) {
  const t = useTranslations('creationCanvas.build');
  const modality = useModalityCopy()(typeof data.modality === 'string' ? data.modality : null);
  const binding = canvasBuildBinding(data);
  const local = !binding && canvasAppLocalKey(data) !== null;
  const state = binding ? 'ready' : local ? 'local' : 'none';
  const siteUrl = canvasWebPageUrl(data);
  return (
    <div className={styles.buildBody}>
      <div className={styles.buildType}>
        <span aria-hidden><Icon source={modality.icon} size={18} /></span>
        <strong>{modality.label}</strong>
        <em data-bound={state === 'none' ? 'false' : 'true'}>{t(TILE_STATE[state])}</em>
      </div>
      <p>{t(TILE_HINT[state])}</p>
      <div className={styles.pills}>
        {modality.showRunButton && <span>{t('pillDevServer')}</span>}
        {modality.showChecks && <span>{t('pillChecks')}</span>}
        <span>{t('pillPublish')}</span>
      </div>
      {siteUrl && <a className={styles.buildLink} href={siteUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{siteUrl}</a>}
    </div>
  );
}
