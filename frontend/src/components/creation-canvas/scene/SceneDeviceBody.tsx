import { useTranslations } from 'next-intl';
import type { CanvasSceneSpec } from '@builderforce/creation-canvas-contract';
import { ModelPicker, ProgressFeedback, VideoPreview } from '@seanhogg/builderforce-studio-embedded';
import type { DiffusionModelId } from '@seanhogg/builderforce-studio';
import { useSceneGeneration } from '@/hooks/useSceneGeneration';
import styles from '../CreationCanvas.module.css';
import sceneStyles from './Scene.module.css';

/**
 * The ON-DEVICE scene body: the studio engine in this browser (WebGPU). Moved
 * verbatim out of `CanvasSceneGeneratorPanel` when the cloud engine arrived; all
 * orchestration stays in `useSceneGeneration`.
 */
export function SceneDeviceBody({ objectId, spec, onChange }: {
  objectId: string;
  spec: CanvasSceneSpec;
  onChange?: (patch: Partial<CanvasSceneSpec>) => void;
}) {
  const t = useTranslations('creationCanvas.scene');
  const tCommon = useTranslations('common');
  const generation = useSceneGeneration(objectId, spec, onChange);
  const editable = Boolean(onChange);

  return (
    <>
      <section className={styles.sceneGeneratorControls}>
        <label className={styles.sceneGeneratorField}>
          <span>{t('promptLabel')}</span>
          <textarea
            className={styles.sceneGeneratorPrompt}
            rows={4}
            placeholder={t('promptPlaceholder')}
            value={generation.prompt}
            onChange={(event) => generation.setPrompt(event.target.value)}
            disabled={!editable || generation.isGenerating}
          />
        </label>

        {/* `ModelPicker` reads `DiffusionModelId` and reports one back — the spec's
            own `modelId` stays a plain string (see `scene.ts`'s header), so the
            boundary narrows in both directions right here. A defensively-parsed
            legacy scene whose `modelId` came back empty falls back to the lightest
            always-available model. */}
        <ModelPicker
          value={(generation.modelId || 'lcm-tiny-sd') as DiffusionModelId}
          onChange={(next) => generation.setModelId(next)}
          disabled={!editable || generation.isGenerating}
        />

        <div className={styles.sceneGeneratorRow}>
          <label className={styles.sceneGeneratorField}>
            <span>{t('framesLabel')}</span>
            <input
              type="number"
              className={styles.sceneGeneratorNumber}
              min={1}
              max={120}
              value={generation.frames}
              onChange={(event) => generation.setFrames(Math.max(1, Math.min(120, Number(event.target.value) || 1)))}
              disabled={!editable || generation.isGenerating}
            />
          </label>
          <label className={styles.sceneGeneratorField}>
            <span>{t('fpsLabel')}</span>
            <input
              type="number"
              className={styles.sceneGeneratorNumber}
              min={1}
              max={60}
              value={generation.fps}
              onChange={(event) => generation.setFps(Math.max(1, Math.min(60, Number(event.target.value) || 1)))}
              disabled={!editable || generation.isGenerating}
            />
          </label>
        </div>

        {editable && (
          <div className={sceneStyles.actions}>
            {generation.isGenerating ? (
              <button type="button" className={sceneStyles.secondary} onClick={generation.cancel}>{tCommon('cancel')}</button>
            ) : (
              <button type="button" className={sceneStyles.primary} onClick={() => void generation.generate()} disabled={!generation.canGenerate}>
                {t('generate')}
              </button>
            )}
          </div>
        )}
      </section>

      <section className={styles.sceneGeneratorPreview}>
        <VideoPreview
          frames={generation.previewFrames}
          videoUrl={generation.videoUrl}
          width={512}
          height={512}
          loading={generation.isGenerating ? { label: generation.progressLabel || t('initializing'), framesDone: generation.previewFrames.length, framesTotal: generation.frames } : null}
        />
        <ProgressFeedback progressLabel={generation.progressLabel} error={generation.error} />
      </section>
    </>
  );
}
