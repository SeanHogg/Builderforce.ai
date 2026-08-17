/*
 * No `'use client'` — mounted only inside surfaces that are themselves reached
 * through a `dynamic(..., { ssr: false })` import, since WebGL has no
 * server-side render. A second boundary here would mark an entry point that
 * does not exist.
 */
import { useEffect, useState, type DragEventHandler, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Canvas } from '@react-three/fiber';
import type { CanvasWorldScene } from '@builderforce/creation-canvas-contract';
import styles from '../CreationCanvas.module.css';
import Scene3D from './Scene3D';
import { DEFAULT_WALKER_COLOR } from './PlayerController';
import { useWorldPlay } from './useWorldPlay';

/**
 * The 3D runtime itself — the `<Canvas>`, the scene in it, and the chrome that
 * belongs to being INSIDE a space rather than to the surface around it.
 *
 * ── WHY IT WAS EXTRACTED ──────────────────────────────────────────────────
 * Two surfaces mount this runtime now: the 3D space, where you build a world
 * and walk it, and the play surface, where a Roblox place is the level you are
 * playing. Both need the same camera toggle, the same respawn, the same
 * pointer-lock hint and the same full-screen control. Written twice, they would
 * be two answers to "press V" and two places to fix a walker that spawns
 * inside the floor — so the runtime is one component and each surface
 * contributes only what is genuinely its own (a palette; a scoreboard's
 * meaning) through props.
 *
 * ── WHY FULL SCREEN IS NOT HERE ───────────────────────────────────────────
 * Because it is not about the viewport. On the 3D space it has to take the
 * palette and the properties rail with it, or the player goes full screen into
 * a space they can no longer edit. Both hosts put it in their surface header
 * (`CanvasFullscreenAction`), pointed at their own stage — the R3F canvas
 * resizes to whatever box it lands in, so nothing here has to know.
 */

export interface WorldViewportProps {
  scene: CanvasWorldScene;
  /**
   * `walk` PLAYS the level: the walker drops in and the level's own rules run
   * (`useWorldPlay`). There is no third mode for "walk but do not score" —
   * testing your own level is exactly the case where you want to know whether
   * the goal is reachable, and leaving walk mode ends the run.
   */
  mode: 'edit' | 'walk';
  selectedPropId?: string | null;
  onSelectProp?: (id: string | null) => void;
  /** Rendered INSIDE the R3F canvas — the edit-mode drop placer. */
  sceneExtras?: ReactNode;
  onDragOver?: DragEventHandler<HTMLDivElement>;
  onDrop?: DragEventHandler<HTMLDivElement>;
  /** What the bottom banner says while building. Absent draws no banner. */
  banner?: string;
}

export function WorldViewport({
  scene,
  mode,
  selectedPropId = null,
  onSelectProp,
  sceneExtras,
  onDragOver,
  onDrop,
  banner,
}: WorldViewportProps) {
  const t = useTranslations('creationCanvas.surface.world');
  const [cameraView, setCameraView] = useState<'first' | 'third'>('first');
  const [manualRespawn, setManualRespawn] = useState(0);

  const play = useWorldPlay(scene, mode === 'walk');

  // `V` flips first/third person, same as the on-canvas button.
  useEffect(() => {
    if (mode !== 'walk') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'KeyV') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      setCameraView((view) => (view === 'first' ? 'third' : 'first'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode]);

  const respawn = () => {
    setManualRespawn((value) => value + 1);
    play.restart();
  };

  const { state } = play;
  const scoreboard = mode === 'walk' && state.playable;

  return (
    <div
      className={styles.worldViewport}
      {...(onDragOver ? { onDragOver } : {})}
      {...(onDrop ? { onDrop } : {})}
    >
      <Canvas shadows camera={{ position: [12, 10, 12], fov: 60, near: 0.1, far: 500 }} tabIndex={mode === 'walk' ? 0 : -1}>
        <Scene3D
          scene={play.scene}
          mode={mode}
          selectedPropId={selectedPropId}
          onSelectProp={onSelectProp ?? (() => {})}
          respawnNonce={play.respawnNonce + manualRespawn}
          cameraView={cameraView}
          walkerColor={DEFAULT_WALKER_COLOR}
          onPlayerEnter={play.onPlayerEnter}
        />
        {mode === 'edit' && sceneExtras}
      </Canvas>

      {mode === 'edit' && banner && <div className={styles.worldBanner}>{banner}</div>}

      {mode === 'walk' && <>
        <div className={styles.worldBannerTop}>{t('walkHint')}</div>
        <button type="button" className={styles.worldRespawnAction} onClick={respawn} title={t('respawn')}>
          {t('respawn')}
        </button>
        <button
          type="button"
          className={styles.worldCameraAction}
          onClick={() => setCameraView((view) => (view === 'first' ? 'third' : 'first'))}
          title={cameraView === 'first' ? t('switchToThird') : t('switchToFirst')}
        >
          {cameraView === 'first' ? t('cameraThird') : t('cameraFirst')}
        </button>
      </>}

      {/* The scoreboard is a live region: a pickup is a thing that HAPPENED, and
          in first-person the player is looking at where it was, not at a number
          in the corner. */}
      {scoreboard && <div className={styles.worldScore} role="status" aria-live="polite">
        {state.total > 0 && <span>{t('play.score', { collected: state.collected.length, total: state.total })}</span>}
        {state.hits > 0 && <span>{t('play.hits', { count: state.hits })}</span>}
        {state.won && <strong>{t('play.won')}</strong>}
      </div>}
    </div>
  );
}

export default WorldViewport;
