/*
 * No `'use client'` here on purpose — same reason `CanvasWorldView.tsx` states it: this
 * is imported only by `CreationCanvas.tsx` via a `dynamic(..., { ssr: false })` import
 * (WebGPU has no server-side render), which already declares the boundary.
 */
import { useTranslations } from 'next-intl';
import { canvasSceneSpecFrom, type CanvasSceneSpec } from '@builderforce/creation-canvas-contract';
import { ModelPicker, ProgressFeedback, VideoPreview } from '@seanhogg/builderforce-studio-embedded';
import '@seanhogg/builderforce-studio-embedded/styles.css';
import type { DiffusionModelId } from '@seanhogg/builderforce-studio';
import { useSceneGeneration } from '@/hooks/useSceneGeneration';
import styles from './CreationCanvas.module.css';
import { CanvasObjectSurface } from './CanvasObjectSurface';
import type { CreationNodeData } from './types';

/**
 * CanvasSceneGeneratorPanel — the `scene3d` surface's OTHER half.
 *
 * `Canvas3DView` (the surface's board-scoped default) projects the flat board in 3D;
 * this is what the same surface shows instead when it is entered bound to a `scene`
 * object — a prompt, a model, and a Generate action that calls the studio engine
 * directly. See `CreationCanvas.tsx`'s `scene3d` entry in its `surfaces` map for the
 * fork, and `creationObjectSurfaces.ts` for why `scene` maps here rather than to
 * `timeline` (the unrelated, untouched multi-track editor for imported/screen/camera
 * clips).
 *
 * Composed from `studio-embedded`'s own sub-components rather than the all-in-one
 * `<StudioPanel>` — this canvas's persistence (a JSON patch through `onEdit`), its own
 * theme tokens, and its own object-scoped chrome (`CanvasObjectSurface`) all differ
 * from what `<StudioPanel>` assumes about its host, so composing the parts is what lets
 * this panel be a first-class, theme-aware canvas surface instead of a re-skinned copy
 * of the retired video-modality panel.
 *
 * All orchestration (engine lifecycle, generate/cancel, persisting the finished clip)
 * lives in `useSceneGeneration` — this file is presentation and layout only, which is
 * what keeps it well under the file's own size budget.
 */

export interface CanvasSceneGeneratorPanelProps {
  /** The bound `scene` object's own node id — `CanvasObjectData` carries no id of its
   *  own (it lives on the graph node), so the host passes it explicitly, the same way
   *  `CanvasFacilitateSurface` takes `objectId`. */
  objectId: string;
  data: CreationNodeData;
  onExit: () => void;
  /** Absent on a board the viewer cannot drive; the panel renders read-only (no
   *  prompt/model controls, no Generate) — same convention `CanvasWorldView`/
   *  `CanvasTimelineSurface` use for their own `onEdit`. */
  onEdit?: (patch: Partial<CreationNodeData>) => void;
}

export function CanvasSceneGeneratorPanel({ objectId, data, onExit, onEdit }: CanvasSceneGeneratorPanelProps) {
  const t = useTranslations('creationCanvas.scene');
  const tCommon = useTranslations('common');
  const spec = canvasSceneSpecFrom(data.scene);
  const onChange = onEdit
    ? (patch: Partial<CanvasSceneSpec>) => onEdit({ scene: { ...spec, ...patch } })
    : undefined;
  const generation = useSceneGeneration(objectId, spec, onChange);
  const editable = Boolean(onEdit);

  const actions = editable ? (
    generation.isGenerating ? (
      <button type="button" className={styles.objectSurfaceAction} onClick={generation.cancel}>
        {tCommon('cancel')}
      </button>
    ) : (
      <button
        type="button"
        className={styles.objectSurfaceAction}
        onClick={() => void generation.generate()}
        disabled={!generation.canGenerate}
      >
        {t('generate')}
      </button>
    )
  ) : null;

  return (
    <CanvasObjectSurface surface="scene3d" data={data} onExit={onExit} actions={actions}>
      {/* The bridge between this surface's own theme tokens and the borrowed
          `studio-embedded` components (`ModelPicker`/`VideoPreview`/`ProgressFeedback`),
          whose stylesheet reads its own `--bfs-*` custom properties rather than this
          canvas's `--canvas-*` palette — see "canvas owns its palette". Defined directly
          here (not via `.bfs-root`, which this panel never applies — its own padding/
          min-height/background chrome is built for a full-screen host, not one surface
          body among several) so every borrowed component underneath, in both columns,
          resolves the canvas's current light or dark theme instead of the `styles.css`
          package's own hardcoded dark fallbacks. */}
      <div
        className={styles.sceneGeneratorStage}
        style={{
          ['--bfs-bg' as string]: 'var(--canvas-panel)',
          ['--bfs-bg-deep' as string]: 'var(--canvas-board-background)',
          ['--bfs-fg' as string]: 'var(--canvas-ink)',
          ['--bfs-fg-muted' as string]: 'var(--canvas-muted)',
          ['--bfs-accent' as string]: 'var(--canvas-brain-accent)',
          ['--bfs-accent-2' as string]: 'var(--canvas-brain-accent)',
          ['--bfs-border' as string]: 'var(--canvas-line)',
          ['--bfs-danger' as string]: 'var(--error-text)',
        }}
      >
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
              own `modelId` stays a plain string (see `scene.ts`'s header for why), so
              the boundary narrows in both directions right here. */}
          <ModelPicker
            // Falls back to the lightest always-available model for a defensively-parsed
            // legacy/malformed `scene` whose stored `modelId` came back empty — the
            // freshly-created shape already seeds a real one (see the registry entry).
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
      </div>
    </CanvasObjectSurface>
  );
}
