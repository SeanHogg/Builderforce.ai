/*
 * No `'use client'` — mounted only inside surfaces that are themselves reached
 * through a `dynamic(..., { ssr: false })` import, since WebGL has no
 * server-side render. A second boundary here would mark an entry point that
 * does not exist.
 */
import { useEffect, useRef, useState, type DragEventHandler, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Canvas } from '@react-three/fiber';
import type { CanvasWorldScene } from '@builderforce/creation-canvas-contract';
import { isTypingTarget } from '@/lib/keyboardTarget';
import styles from '../CreationCanvas.module.css';
import { useSpacePresence } from '../canvasSpacePresence';
import Scene3D from './Scene3D';
import { DEFAULT_WALKER_COLOR } from './PlayerController';
import { useDragLook } from './useDragLook';
import { useWorldPlay } from './useWorldPlay';
import { WalkerTouchControls } from './WalkerTouchControls';

/**
 * The 3D runtime itself — the `<Canvas>`, the scene in it, and the chrome that
 * belongs to being INSIDE a space rather than to the surface around it.
 *
 * ── WHY IT WAS EXTRACTED ──────────────────────────────────────────────────
 * Three places mount this runtime: the 3D space, where you build a world and walk
 * it; the play surface, where a Roblox place is the level you are playing; and the
 * room, which plays that same level without leaving the room. All need the same
 * camera toggle, the same respawn, the same pointer-lock hint, the same touch pad —
 * so the runtime is one component and each host contributes only what is genuinely
 * its own through props.
 *
 * ── WHO ELSE IS HERE ──────────────────────────────────────────────────────
 * Pass `spaceId` (the object being walked) and the walker is announced in that
 * space and everyone else walking it is drawn — through `useSpacePresence`, which
 * reads the canvas's own presence channel. Two people playing one level see each
 * other AND share one tally (collectibles fold through the same presence frames);
 * a level played in the room and the same level on its own surface are the
 * same space, because they are the same object.
 *
 * ── WHY FULL SCREEN IS NOT HERE ───────────────────────────────────────────
 * Because it is not about the viewport. On the 3D space it has to take the
 * palette and the properties rail with it. Both hosts put it in their surface
 * header (`CanvasFullscreenAction`), pointed at their own stage.
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
  /** The object this space IS — see the header. Absent: the walker walks alone. */
  spaceId?: string;
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
  spaceId,
}: WorldViewportProps) {
  const t = useTranslations('creationCanvas.surface.world');
  const [cameraView, setCameraView] = useState<'first' | 'third'>('first');
  const [manualRespawn, setManualRespawn] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const walking = mode === 'walk';

  const presence = useSpacePresence(walking ? spaceId : undefined);
  const play = useWorldPlay(scene, walking, presence?.peerCollected);
  const announcePlayRef = useRef(presence?.announcePlay);
  announcePlayRef.current = presence?.announcePlay;
  // A finger turns the head — the mouse is pointer-locked here, so only touch.
  useDragLook(viewportRef, { buttons: 'touch', enabled: walking });

  // `V` flips first/third person, same as the on-canvas button.
  useEffect(() => {
    if (!walking) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'KeyV') return;
      if (isTypingTarget(event.target)) return;
      setCameraView((view) => (view === 'first' ? 'third' : 'first'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [walking]);

  const respawn = () => {
    setManualRespawn((value) => value + 1);
    play.restart();
  };

  useEffect(() => {
    if (!walking) {
      announcePlayRef.current?.(null);
      return;
    }
    announcePlayRef.current?.({
      collected: [...play.state.collected],
      ...(play.state.won ? { won: true } : {}),
    });
  }, [walking, play.state.collected, play.state.won]);

  const { state } = play;
  const collectedCount = new Set([...state.collected, ...(presence?.peerCollected ?? [])]).size;
  const won = state.won || !!presence?.peerWon;
  const scoreboard = walking && state.playable;

  return (
    <div
      ref={viewportRef}
      className={styles.worldViewport}
      {...(onDragOver ? { onDragOver } : {})}
      {...(onDrop ? { onDrop } : {})}
    >
      <Canvas shadows camera={{ position: [12, 10, 12], fov: 60, near: 0.1, far: 500 }} tabIndex={walking ? 0 : -1}>
        <Scene3D
          scene={play.scene}
          mode={mode}
          selectedPropId={selectedPropId}
          onSelectProp={onSelectProp ?? (() => {})}
          respawnNonce={play.respawnNonce + manualRespawn}
          cameraView={cameraView}
          walkerColor={DEFAULT_WALKER_COLOR}
          onPlayerEnter={play.onPlayerEnter}
          {...(presence ? { peers: presence.peers, walkerFaceUrl: presence.selfAvatarUrl, onMove: presence.onMove } : {})}
        />
        {mode === 'edit' && sceneExtras}
      </Canvas>

      {mode === 'edit' && banner && <div className={styles.worldBanner}>{banner}</div>}

      {walking && <>
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
        <WalkerTouchControls />
      </>}

      {/* The scoreboard is a live region: a pickup is a thing that HAPPENED, and
          in first-person the player is looking at where it was, not at a number
          in the corner. */}
      {scoreboard && <div className={styles.worldScore} role="status" aria-live="polite">
        {state.total > 0 && <span>{t('play.score', { collected: collectedCount, total: state.total })}</span>}
        {state.hits > 0 && <span>{t('play.hits', { count: state.hits })}</span>}
        {won && <strong>{t('play.won')}</strong>}
      </div>}
    </div>
  );
}

export default WorldViewport;
