/*
 * No `'use client'` here on purpose. This is imported only by `CreationCanvas.tsx`, which
 * already declares the boundary, so a directive would mark a second entry point that does
 * not exist — and `check-frontend-architecture` counts directives, not components. Its own
 * header says it: the directive is sometimes the bug.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { GAME_FRAME_SANDBOX, gameDocumentFrom, gameRuntimeFor, gameWorldFrom } from '@/lib/gameTargets';
import { controlLabels, readGameControls } from '@/lib/gamePoster';
import styles from './CreationCanvas.module.css';
import { CanvasFullscreenAction } from './CanvasFullscreenAction';
import { CanvasObjectSurface } from './CanvasObjectSurface';
import type { CanvasRosterMember, CreationNodeData } from './types';

/**
 * A generated build, played at the size a game is played — the play runtime.
 *
 * ── TWO RUNTIMES, ONE SURFACE ────────────────────────────────────────────────────
 * A game has two artifact shapes and they run in different engines. A web game is an
 * HTML document and runs in a sandboxed frame. A Roblox game is a `.rbxlx` place, which
 * this browser genuinely cannot execute — but the WORLD inside it is positioned boxes
 * with sizes, colours and physical roles, which is exactly what this canvas's own
 * Three.js + Rapier runtime already walks. So a place is played here as the level it is
 * (`robloxWorld.ts` reads it; `WorldViewport` runs it), and the surface says plainly that
 * the Luau rules are the Roblox half.
 *
 * That distinction is the bug this surface shipped with. `gameDocumentFrom` returns `''`
 * for anything that is not `text/html`, and the empty string was read as "there is no
 * game" — so a place that demonstrably existed, was downloadable and was sitting on the
 * board reported "No game yet. Describe the game you want, then generate it." Which
 * runtime a game uses and whether a game EXISTS are two questions; `gameRuntimeFor`
 * answers the first, and this surface no longer conflates them.
 *
 * ── WHY THE SHIP PANEL IS NOT A SURFACE ──────────────────────────────────────────
 * `CanvasGamePanel` is about DISTRIBUTION: which targets a build ships to, its QR code,
 * its published URL. That is a panel, and it opens OVER this one. Playing is the other
 * half and it is not panel-shaped — a build in a 340px card is a build nobody can judge.
 *
 * ── THE SANDBOX IS LOAD-BEARING, AND IS NOT RESTATED HERE ────────────────────────
 * The document is model-authored code from a free-text brief. It runs with
 * `allow-scripts` and deliberately WITHOUT `allow-same-origin`, which gives the frame an
 * opaque origin so the game cannot reach this page's cookies, storage, session token or
 * DOM — the two together would let the frame drop its own sandbox and are equivalent to
 * no sandbox at all. That rule lives in `GAME_FRAME_SANDBOX` and is IMPORTED, never
 * retyped. The document goes in through `srcDoc` for the same reason a blob URL would not
 * do — a blob inherits this page's origin and would quietly undo the isolation.
 */

/**
 * WebGL has no server-side render, and a board full of web games must not pay for
 * Three.js to look at one. Loaded when a place is what is being played, never before.
 */
const WorldViewport = dynamic(
  () => import('./world3d/WorldViewport').then((module) => module.WorldViewport),
  { ssr: false },
);

export interface CanvasPlaySurfaceProps {
  data: CreationNodeData;
  onExit: () => void;
  /** Open the ship/publish panel over this surface. Absent when the board cannot ship. */
  onShip?: () => void;
  /** Everyone on this canvas right now. Playing is the moment people want to know. */
  players?: readonly CanvasRosterMember[];
  /** Open the canvas's own invite door. Absent when this visitor cannot invite. */
  onInvite?: () => void;
}

export function CanvasPlaySurface({ data, onExit, onShip, players = [], onInvite }: CanvasPlaySurfaceProps) {
  const t = useTranslations('creationCanvas');
  const tNode = useTranslations('creationCanvas.node');
  const stageRef = useRef<HTMLDivElement>(null);

  const document = useMemo(() => gameDocumentFrom(data), [data]);
  const world = useMemo(() => gameWorldFrom(data), [data]);
  const runtime = useMemo(() => gameRuntimeFor(data), [data]);
  const controls = useMemo(() => (document ? controlLabels(readGameControls(document)) : []), [document]);
  const [running, setRunning] = useState(true);

  // Regenerating replaces the artifact; the running runtime has to be torn down or the
  // surface keeps playing the previous build under the new title.
  useEffect(() => setRunning(true), [runtime, document, world]);

  const actions = <>
    {runtime && <button type="button" className={styles.objectSurfaceAction} onClick={() => setRunning((value) => !value)}>
      {running ? tNode('gameStop') : tNode('gamePlay')}
    </button>}
    {runtime && <CanvasFullscreenAction target={stageRef} />}
    {onShip && <button type="button" className={styles.objectSurfaceAction} onClick={onShip}>
      {t('surface.play.ship')}
    </button>}
  </>;

  return (
    <CanvasObjectSurface surface="play" data={data} onExit={onExit} actions={actions}>
      {runtime
        ? <div className={styles.playStage} ref={stageRef}>
          {running
            ? runtime === 'world' && world
              // Walk mode from the first frame: this surface was entered by pressing
              // Play, so dropping the player into Build mode would answer a different
              // question than the one they asked.
              ? <div className={styles.playWorld}><WorldViewport scene={world.scene} mode="walk" /></div>
              : <iframe
                className={styles.playFrame}
                title={tNode('gamePlayingAlt', { title: String(data.title ?? '') })}
                srcDoc={document}
                // No `allow-same-origin`. See the note above — with `allow-scripts` it
                // would let the frame escape the sandbox entirely.
                sandbox={GAME_FRAME_SANDBOX}
              />
            : <p className={styles.playStopped}>{tNode('gameReady')}</p>}

          <ul className={styles.playControls} aria-label={t('surface.play.controls')}>
            {runtime === 'world'
              // What the player is in, said plainly. The level is real and walkable; the
              // Luau that scores it runs in Roblox, and implying otherwise here would be
              // the same lie as a play button that does nothing.
              ? <>
                <li>{t('surface.play.worldRuntime')}</li>
                <li>{t('surface.play.worldParts', { count: world?.partCount ?? 0 })}</li>
                <li>{t('surface.play.robloxScriptsNote')}</li>
              </>
              : controls.map((control) => <li key={control}>{control}</li>)}
          </ul>

          {/* Playing is when a person wants to know who else is here, and it is the
              moment they want to ask someone in. The invite door is the canvas's own —
              this surface opens it rather than growing a second sharing model. */}
          {(players.length > 0 || onInvite) && <div className={styles.playPlayers}>
            {players.length > 0 && <span aria-label={t('surface.play.playersLabel', { count: players.length })}>
              {players.map((player) => <b key={player.userId}>{player.displayName || t('collaborator')}</b>)}
            </span>}
            {onInvite && <button type="button" onClick={onInvite}>{t('surface.play.invite')}</button>}
          </div>}
        </div>
        : <p className={styles.playStopped}>{tNode('gameNotGenerated')}</p>}
    </CanvasObjectSurface>
  );
}
