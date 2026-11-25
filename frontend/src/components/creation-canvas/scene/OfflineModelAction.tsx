import { useTranslations } from 'next-intl';
import type { UseOfflineModelResult } from '@/hooks/useOfflineModel';
import { formatBytes } from '@/lib/formatBytes';
import sceneStyles from './Scene.module.css';

/**
 * "Make available offline" for the on-device scene model: not downloaded →
 * downloading (progress, cancel) → available offline (size) → error (retry).
 * Presentational: `useOfflineModel` owns the download.
 */
export function OfflineModelAction({ offline }: { offline: UseOfflineModelResult }) {
  const t = useTranslations('creationCanvas.scene');
  const tCommon = useTranslations('common');
  const { state, fraction, sizeBytes, error, signedIn } = offline;

  if (state === 'checking') return null;

  if (state === 'available') {
    return (
      <p className={sceneStyles.status} role="status">
        {sizeBytes ? t('offlineReadySize', { size: formatBytes(sizeBytes) }) : t('offlineReady')}
      </p>
    );
  }

  if (state === 'downloading') {
    const percent = fraction === null ? null : Math.round(fraction * 100);
    return (
      <div className={sceneStyles.offline}>
        <div className={sceneStyles.offlineRow}>
          <progress
            className={sceneStyles.offlineBar}
            max={100}
            value={percent ?? undefined}
            aria-label={t('offlineDownloading')}
          />
          <button type="button" className={sceneStyles.secondary} onClick={offline.cancel}>{tCommon('cancel')}</button>
        </div>
        <p className={sceneStyles.status} role="status">
          {percent === null ? t('offlineDownloading') : t('offlineProgress', { percent })}
        </p>
      </div>
    );
  }

  return (
    <div className={sceneStyles.offline}>
      <button
        type="button"
        className={sceneStyles.secondary}
        onClick={() => void offline.start()}
        disabled={!signedIn}
        title={signedIn ? t('offlineHint') : t('offlineNeedsAccount')}
      >
        {state === 'error' ? t('offlineRetry') : t('offlineAction')}
      </button>
      {!signedIn && <p className={sceneStyles.hint}>{t('offlineNeedsAccount')}</p>}
      {state === 'error' && error && <p className={sceneStyles.error} role="alert">{t('offlineFailed', { message: error })}</p>}
      {signedIn && state === 'idle' && <p className={sceneStyles.hint}>{t('offlineHint')}</p>}
    </div>
  );
}
