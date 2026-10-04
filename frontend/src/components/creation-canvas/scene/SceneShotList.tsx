import { useTranslations } from 'next-intl';
import type { CanvasSceneShot } from '@builderforce/creation-canvas-contract';
import { CLOUD_SHOT_SECONDS } from '@/lib/sceneStoryboard';
import styles from './Scene.module.css';

/**
 * A cloud scene's shots — each with its prompt, length, render state and clip.
 * Presentational: every change goes back through the two callbacks, and both are
 * absent on a board the viewer cannot drive (the list then renders read-only).
 */
export function SceneShotList({ shots, busy, onEdit, onRemove }: {
  shots: readonly CanvasSceneShot[];
  busy: boolean;
  onEdit?: (shotId: string, patch: Pick<Partial<CanvasSceneShot>, 'prompt' | 'durationSeconds'>) => void;
  onRemove?: (shotId: string) => void;
}) {
  const t = useTranslations('creationCanvas.scene');
  if (shots.length === 0) return <p className={styles.empty}>{t('emptyShots')}</p>;
  return (
    <ol className={styles.shotList} aria-label={t('shotsTitle')}>
      {shots.map((shot, index) => (
        <li key={shot.id} className={styles.shot} data-status={shot.status}>
          <div className={styles.shotHead}>
            <span className={styles.shotIndex}>{index + 1}</span>
            <span className={styles.shotAction}>{shot.action || shot.prompt.slice(0, 60)}</span>
            <span className={styles.shotStatus}>{t(`shotStatus.${shot.status}`)}</span>
          </div>
          <div className={styles.shotBody}>
            {shot.output ? (
              <video className={styles.shotClip} src={shot.output.url} controls muted playsInline preload="metadata" />
            ) : (
              <div className={styles.shotClipPlaceholder} aria-hidden="true">{shot.status === 'rendering' ? '…' : '▶'}</div>
            )}
            <div className={styles.shotFields}>
              <label className={styles.field}>
                <span>{t('shotPromptLabel', { index: index + 1 })}</span>
                <textarea
                  rows={3}
                  value={shot.prompt}
                  disabled={!onEdit || busy}
                  onChange={(event) => onEdit?.(shot.id, { prompt: event.target.value })}
                />
              </label>
              <div className={styles.shotRow}>
                <label className={styles.field}>
                  <span>{t('shotDuration')}</span>
                  <select
                    value={shot.durationSeconds}
                    disabled={!onEdit || busy}
                    onChange={(event) => onEdit?.(shot.id, { durationSeconds: Number(event.target.value) })}
                  >
                    {CLOUD_SHOT_SECONDS.map((seconds) => <option key={seconds} value={seconds}>{t('secondsOption', { seconds })}</option>)}
                  </select>
                </label>
                {onRemove && (
                  <button type="button" className={styles.linkButton} disabled={busy} onClick={() => onRemove(shot.id)}>
                    {t('removeShot')}
                  </button>
                )}
              </div>
              {shot.error && <p className={styles.shotError} role="alert">{shot.error}</p>}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
