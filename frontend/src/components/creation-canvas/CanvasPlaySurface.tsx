/*
 * No `'use client'` here on purpose. This is imported only by `CreationCanvas.tsx`, which
 * already declares the boundary, so a directive would mark a second entry point that does
 * not exist — and `check-frontend-architecture` counts directives, not components. Its own
 * header says it: the directive is sometimes the bug.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { GAME_FRAME_SANDBOX, gameDocumentFrom } from '@/lib/gameTargets';
import { controlLabels, readGameControls } from '@/lib/gamePoster';
import styles from './CreationCanvas.module.css';
import { CanvasObjectSurface } from './CanvasObjectSurface';
import type { CreationNodeData } from './types';

/**
 * A generated build, played at the size a game is played — the play runtime.
 *
 * ── WHY THIS IS A SURFACE AND THE SHIP PANEL IS NOT ──────────────────────────────
 * `CanvasGamePanel` was reached through a bespoke `gameFocus` boolean and is a slide-out
 * about DISTRIBUTION: which targets a build can ship to, its QR code, its published URL.
 * That is a panel, and it stays one. Playing is the other half and it is not panel-shaped
 * — a build in a 340px card (or a 620px drawer) is a build nobody can actually judge. So
 * `play` is the surface, and shipping opens over it from the header.
 *
 * ── THE SANDBOX IS LOAD-BEARING, AND IS NOT RESTATED HERE ────────────────────────
 * The document is model-authored code from a free-text brief. It runs with
 * `allow-scripts` and deliberately WITHOUT `allow-same-origin`, which gives the frame an
 * opaque origin so the game cannot reach this page's cookies, storage, session token or
 * DOM — the two together would let the frame drop its own sandbox and are equivalent to
 * no sandbox at all. That rule lives in `GAME_FRAME_SANDBOX` and is IMPORTED, never
 * retyped: a second copy of a security-critical string is a second place for it to be
 * wrong, and this surface runs the same untrusted document the node body does. The
 * document goes in through `srcDoc` for the same reason a blob URL would not do — a blob
 * inherits this page's origin and would quietly undo the isolation.
 */

export interface CanvasPlaySurfaceProps {
  data: CreationNodeData;
  onExit: () => void;
  /** Open the ship/publish panel over this surface. Absent when the board cannot ship. */
  onShip?: () => void;
}

export function CanvasPlaySurface({ data, onExit, onShip }: CanvasPlaySurfaceProps) {
  const t = useTranslations('creationCanvas');
  const tNode = useTranslations('creationCanvas.node');
  const document = useMemo(() => gameDocumentFrom(data), [data]);
  const controls = useMemo(() => (document ? controlLabels(readGameControls(document)) : []), [document]);
  const [running, setRunning] = useState(true);

  // Regenerating replaces the document; the running frame has to be torn down or the
  // surface keeps playing the previous build under the new title.
  useEffect(() => setRunning(true), [document]);

  const actions = <>
    {document && <button type="button" className={styles.objectSurfaceAction} onClick={() => setRunning((value) => !value)}>
      {running ? tNode('gameStop') : tNode('gamePlay')}
    </button>}
    {onShip && <button type="button" className={styles.objectSurfaceAction} onClick={onShip}>
      {t('surface.play.ship')}
    </button>}
  </>;

  return (
    <CanvasObjectSurface surface="play" data={data} onExit={onExit} actions={actions}>
      {document
        ? <div className={styles.playStage}>
          {running
            ? <iframe
              className={styles.playFrame}
              title={tNode('gamePlayingAlt', { title: String(data.title ?? '') })}
              srcDoc={document}
              // No `allow-same-origin`. See the note above — with `allow-scripts` it
              // would let the frame escape the sandbox entirely.
              sandbox={GAME_FRAME_SANDBOX}
            />
            : <p className={styles.playStopped}>{tNode('gameReady')}</p>}
          {controls.length > 0 && <ul className={styles.playControls} aria-label={t('surface.play.controls')}>
            {controls.map((control) => <li key={control}>{control}</li>)}
          </ul>}
        </div>
        : <p className={styles.playStopped}>{tNode('gameNotGenerated')}</p>}
    </CanvasObjectSurface>
  );
}
