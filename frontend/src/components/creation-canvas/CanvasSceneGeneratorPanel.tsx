/*
 * No `'use client'` here on purpose — same reason `CanvasWorldView.tsx` states it: this
 * is imported only by `CreationCanvas.tsx` via a `dynamic(..., { ssr: false })` import
 * (WebGPU has no server-side render), which already declares the boundary.
 */
import { useTranslations } from 'next-intl';
import { canvasSceneEngine, canvasSceneSpecFrom, type CanvasSceneEngine, type CanvasSceneSpec } from '@builderforce/creation-canvas-contract';
import '@seanhogg/builderforce-studio-embedded/styles.css';
import { getStoredTenantToken } from '@/lib/auth';
import type { SceneMovieDraft } from '@/hooks/useCloudScene';
import { useLatestRef } from './hooks/useLatestRef';
import styles from './CreationCanvas.module.css';
import sceneStyles from './scene/Scene.module.css';
import { CanvasObjectSurface } from './CanvasObjectSurface';
import { SceneCloudBody } from './scene/SceneCloudBody';
import { SceneDeviceBody } from './scene/SceneDeviceBody';
import type { CreationNodeData } from './types';

/**
 * CanvasSceneGeneratorPanel — the `scene3d` surface: a `scene` object at full size.
 *
 * Two engines behind one switch (see `CanvasSceneEngine`):
 *   - CLOUD  (`scene/SceneCloudBody`)  — hosted video models: a clip, or a planned
 *            storyboard of shots, then a movie on a `video` timeline
 *   - DEVICE (`scene/SceneDeviceBody`) — the studio engine in this browser
 * This file only chooses between them and owns the one write path: every scene
 * patch merges onto the LATEST spec (a synchronously-updated ref), because the
 * cloud engine commits several patches in one tick as shots finish, and merging
 * each onto the spec of the last render would let them overwrite one another.
 */

export interface CanvasSceneGeneratorPanelProps {
  /** The bound `scene` object's own node id — `CanvasObjectData` carries no id of its
   *  own (it lives on the graph node), so the host passes it explicitly. */
  objectId: string;
  data: CreationNodeData;
  onExit: () => void;
  /** Absent on a board the viewer cannot drive; the panel renders read-only. */
  onEdit?: (patch: Partial<CreationNodeData>) => void;
  /** Adds the scene's movie to the board as a `video` object. */
  onCreateMovie?: (draft: SceneMovieDraft) => void;
}

/** The canvas's theme tokens mapped onto the borrowed studio-embedded components'
 *  `--bfs-*` properties, so they follow the canvas's light or dark palette. */
const STUDIO_THEME_BRIDGE = {
  ['--bfs-bg' as string]: 'var(--canvas-panel)',
  ['--bfs-bg-deep' as string]: 'var(--canvas-board-background)',
  ['--bfs-fg' as string]: 'var(--canvas-ink)',
  ['--bfs-fg-muted' as string]: 'var(--canvas-muted)',
  ['--bfs-accent' as string]: 'var(--canvas-brain-accent)',
  ['--bfs-accent-2' as string]: 'var(--canvas-brain-accent)',
  ['--bfs-border' as string]: 'var(--canvas-line)',
  ['--bfs-danger' as string]: 'var(--error-text)',
};

export function CanvasSceneGeneratorPanel({ objectId, data, onExit, onEdit, onCreateMovie }: CanvasSceneGeneratorPanelProps) {
  const t = useTranslations('creationCanvas.scene');
  const spec = canvasSceneSpecFrom(data.scene);
  const latest = useLatestRef<CanvasSceneSpec>(spec);
  const onChange = onEdit
    ? (patch: Partial<CanvasSceneSpec>) => {
      const next = { ...latest.current, ...patch };
      latest.current = next;
      onEdit({ scene: next });
    }
    : undefined;
  const engine = canvasSceneEngine(spec);
  // Cloud video runs on the server against the workspace's budget, so it needs an
  // account; a guest board renders on the device.
  const cloudAvailable = Boolean(getStoredTenantToken());

  const engineSwitch = onChange ? (
    <div className={sceneStyles.engineSwitch} role="group" aria-label={t('engineLabel')}>
      {(['cloud', 'device'] as const satisfies readonly CanvasSceneEngine[]).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={engine === option}
          disabled={option === 'cloud' && !cloudAvailable}
          title={option === 'cloud' && !cloudAvailable ? t('cloudNeedsAccount') : t(option === 'cloud' ? 'engineCloudHint' : 'engineDeviceHint')}
          onClick={() => onChange({ engine: option })}
        >
          {t(option === 'cloud' ? 'engineCloud' : 'engineDevice')}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <CanvasObjectSurface surface="scene3d" data={data} onExit={onExit} actions={engineSwitch}>
      <div className={styles.sceneGeneratorStage} style={STUDIO_THEME_BRIDGE}>
        {engine === 'cloud' && cloudAvailable ? (
          <SceneCloudBody
            title={data.title}
            spec={spec}
            {...(onChange ? { onChange } : {})}
            {...(onCreateMovie ? { onCreateMovie } : {})}
          />
        ) : (
          <SceneDeviceBody objectId={objectId} spec={spec} {...(onChange ? { onChange } : {})} />
        )}
      </div>
    </CanvasObjectSurface>
  );
}
