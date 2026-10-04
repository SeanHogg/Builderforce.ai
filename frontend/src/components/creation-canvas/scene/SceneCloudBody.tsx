import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CANVAS_SCENE_ASPECTS, canvasSceneShotsToRender, type CanvasSceneAspect, type CanvasSceneSpec } from '@builderforce/creation-canvas-contract';
import { useCloudScene, type SceneMovieDraft } from '@/hooks/useCloudScene';
import { CLOUD_SHOT_SECONDS } from '@/lib/sceneStoryboard';
import canvasStyles from '../CreationCanvas.module.css';
import styles from './Scene.module.css';
import { SceneShotList } from './SceneShotList';

/** Movie lengths offered for a planned scene, in seconds. */
const SCENE_LENGTHS = [15, 30, 60] as const;

const ASPECT_LABEL_KEY: Record<CanvasSceneAspect, 'aspectLandscape' | 'aspectPortrait' | 'aspectSquare'> = {
  '16:9': 'aspectLandscape',
  '9:16': 'aspectPortrait',
  '1:1': 'aspectSquare',
};

/**
 * The CLOUD scene body: a prompt becomes one clip, or a planned storyboard of
 * shots rendered by hosted video models; the rendered shots become a movie on a
 * `video` timeline. All orchestration lives in `useCloudScene`.
 */
export function SceneCloudBody({ title, spec, onChange, onCreateMovie }: {
  title: string;
  spec: CanvasSceneSpec;
  onChange?: (patch: Partial<CanvasSceneSpec>) => void;
  /** Puts the movie on the board as a `video` object. Absent where the viewer cannot add objects. */
  onCreateMovie?: (draft: SceneMovieDraft) => void;
}) {
  const t = useTranslations('creationCanvas.scene');
  const tCommon = useTranslations('common');
  const scene = useCloudScene(title, spec, onChange);
  const editable = Boolean(onChange);
  const busy = scene.activity !== 'idle';
  const [clipSeconds, setClipSeconds] = useState<number>(5);
  const [sceneSeconds, setSceneSeconds] = useState<number>(30);
  const toRender = canvasSceneShotsToRender({ shots: scene.shots }).length;
  const rendered = scene.shots.filter((shot) => shot.output).length;
  const hasPrompt = spec.prompt.trim().length > 0;

  const statusLine = scene.activity === 'planning'
    ? t('planning')
    : scene.activity === 'rendering' ? t('rendering', { done: rendered, total: scene.shots.length }) : null;

  return (
    <>
      <section className={canvasStyles.sceneGeneratorControls}>
        <label className={canvasStyles.sceneGeneratorField}>
          <span>{t('promptLabel')}</span>
          <textarea
            className={canvasStyles.sceneGeneratorPrompt}
            rows={4}
            placeholder={t('promptPlaceholder')}
            value={spec.prompt}
            onChange={(event) => onChange?.({ prompt: event.target.value })}
            disabled={!editable || busy}
          />
        </label>

        <div className={canvasStyles.sceneGeneratorRow}>
          <label className={canvasStyles.sceneGeneratorField}>
            <span>{t('aspectLabel')}</span>
            <select className={canvasStyles.sceneGeneratorNumber} value={scene.aspectRatio} disabled={!editable || busy}
              onChange={(event) => scene.setAspectRatio(event.target.value as CanvasSceneAspect)}>
              {CANVAS_SCENE_ASPECTS.map((aspect) => <option key={aspect} value={aspect}>{t(ASPECT_LABEL_KEY[aspect])}</option>)}
            </select>
          </label>
          <label className={canvasStyles.sceneGeneratorField}>
            <span>{t('clipLengthLabel')}</span>
            <select className={canvasStyles.sceneGeneratorNumber} value={clipSeconds} disabled={!editable || busy}
              onChange={(event) => setClipSeconds(Number(event.target.value))}>
              {CLOUD_SHOT_SECONDS.map((seconds) => <option key={seconds} value={seconds}>{t('secondsOption', { seconds })}</option>)}
            </select>
          </label>
          <label className={canvasStyles.sceneGeneratorField}>
            <span>{t('sceneLengthLabel')}</span>
            <select className={canvasStyles.sceneGeneratorNumber} value={sceneSeconds} disabled={!editable || busy}
              onChange={(event) => setSceneSeconds(Number(event.target.value))}>
              {SCENE_LENGTHS.map((seconds) => <option key={seconds} value={seconds}>{t('secondsOption', { seconds })}</option>)}
            </select>
          </label>
        </div>

        {editable && (
          <div className={styles.actions}>
            {busy ? (
              <button type="button" className={styles.secondary} onClick={scene.cancel}>{tCommon('cancel')}</button>
            ) : (
              <>
                <button type="button" className={styles.primary} disabled={!hasPrompt} onClick={() => void scene.generateClip(clipSeconds)}>{t('generateClip')}</button>
                <button type="button" className={styles.secondary} disabled={!hasPrompt} onClick={() => void scene.planScene(sceneSeconds)}>{t('planScene')}</button>
                {toRender > 0 && (
                  <button type="button" className={styles.secondary} onClick={() => void scene.renderShots()}>{t('renderShots', { count: toRender })}</button>
                )}
              </>
            )}
          </div>
        )}
        <p className={styles.hint}>{t('engineCloudHint')}</p>
        {statusLine && <p className={styles.status} role="status">{statusLine}</p>}
        {scene.error && <p className={styles.error} role="alert">{scene.error}</p>}
      </section>

      <section className={canvasStyles.sceneGeneratorPreview}>
        <div className={styles.shotsHeader}>
          <h3>{t('shotsTitle')}</h3>
          {onCreateMovie && scene.movie && (
            <button type="button" className={styles.primary} disabled={busy} onClick={() => scene.movie && onCreateMovie({ ...scene.movie, title: t('movieTitle', { title }) })}>{t('makeMovie')}</button>
          )}
        </div>
        {scene.movie && <p className={styles.hint}>{t('movieHint')}</p>}
        <SceneShotList
          shots={scene.shots}
          busy={busy}
          {...(editable ? { onEdit: scene.editShot, onRemove: scene.removeShot } : {})}
        />
      </section>
    </>
  );
}
