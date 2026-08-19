/*
 * No `'use client'` here on purpose. This is imported only by `CreationCanvas.tsx`, which
 * already declares the boundary, so a directive would mark a second entry point that does
 * not exist — and `check-frontend-architecture` counts directives, not components.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CodeReadingIcon, ConsoleReadingIcon, PreviewReadingIcon } from '@/components/canvas/CanvasCommands';
import { CANVAS_APP_FRAME_SANDBOX, canvasApp, type CanvasAppFile } from '@/lib/canvasApp';
import type { CanvasViewport } from '@builderforce/creation-canvas-contract';
import { CanvasDeviceFrame } from './CanvasDeviceFrame';
import { CanvasViewportSwitcher } from './CanvasViewportSwitcher';
import { useCanvasSurfaceActions } from './canvasSurfaceActions';
import { useCanvasPreviewLog } from './useCanvasPreviewLog';
import styles from './CreationCanvas.module.css';
import type { CreationNodeData } from './types';

/**
 * The session as one running application — the app runtime.
 *
 * ── WHY THIS IS A BOARD SURFACE ──────────────────────────────────────────────────
 * `page`, `play`, `site` and `timeline` each open ONE card at full size. An application
 * is not one card: ask Brain for an SMS sender and you get `backend/server.js`,
 * `frontend/index.html` and the page they render — three objects that are one artifact.
 * There is no card to enter it from, so the surface is about the session, and it sits in
 * the rail beside Chat and Board where pressing it with nothing selected has an answer.
 *
 * ── THREE READINGS, ONE ARTIFACT ─────────────────────────────────────────────────
 * Preview, Code and Console are the same app read three ways, which is the shape every
 * comparable builder converged on. The Console is not decoration: this frame runs with an
 * opaque origin, so without the instrumentation `canvasApp` injects, a page that throws
 * inside it fails invisibly and the user concludes their credentials are wrong.
 *
 * ── WHAT IT DOES NOT PRETEND ─────────────────────────────────────────────────────
 * A browser frame cannot run a Node server. `canvasApp` separates those files out by
 * ROLE, this surface names them, and every call the front end makes to a host that is not
 * attached is reported in the console with that reason. A preview that swallowed them
 * would be worse than none.
 *
 * ── WHY ITS CONTROLS ARE NOT DRAWN HERE ──────────────────────────────────────────
 * Run/Stop, the three readings and the preview width used to be a toolbar of this
 * surface's own, drawn directly under the session bar — two rows of controls that looked
 * alike, sat 40px apart, and disagreed about which one you press to do something. A third
 * surface with a runtime would have made three. They are now PUBLISHED into the one
 * session bar through `useCanvasSurfaceActions`, so the canvas has a single bar whose
 * contents follow the surface. The host never learns what an app surface is; this surface
 * never learns where the bar is.
 *
 * ── WHY THE SHIP CONTROL IS A BUTTON AND NOT A RAIL ──────────────────────────────
 * Build → Stage → Live already exists, complete, in `CanvasReleasesPanel`: it snapshots,
 * runs the harness, refuses to publish while anything blocks, shows the buyer's own view
 * of the product and can revert. Redrawing any of that here would be a second copy of a
 * gate the server owns — the exact failure that panel's own header warns about. So this
 * surface adds a DOOR to it, scoped to the whole board, and owns none of the lifecycle.
 */

const READINGS = ['preview', 'code', 'console'] as const;
type AppReading = (typeof READINGS)[number];

/** One glyph per reading. Icons rather than words for the reason the width switcher gives:
 *  this group renders INSIDE the one command bar, where everything else is a 15px mark, and
 *  six worded buttons in that row wrapped the bar onto a second line that then covered the
 *  prompt floating above it. The word is still the button's accessible name. */
const READING_ICON: Record<AppReading, () => React.ReactElement> = {
  preview: PreviewReadingIcon,
  code: CodeReadingIcon,
  console: ConsoleReadingIcon,
};

export interface CanvasAppSurfaceProps {
  nodes: ReadonlyArray<{ id: string; data: CreationNodeData }>;
  /** Escape hands the board back. There is no exit BUTTON here, unlike the object
   *  surfaces: this one is in the rail, so pressing "App" again is the way out — and a
   *  second control for a decision the switcher already owns is the thing the surface
   *  registry exists to prevent. */
  onExit: () => void;
  /** Send the reader to the card a file came from. */
  onOpenObject?: (nodeId: string) => void;
}

export function CanvasAppSurface({ nodes, onExit, onOpenObject }: CanvasAppSurfaceProps) {
  const t = useTranslations('creationCanvas.surface.app');
  const app = useMemo(() => canvasApp(nodes), [nodes]);
  const [reading, setReading] = useState<AppReading>('preview');
  const [viewport, setViewport] = useState<CanvasViewport>('desktop');
  const [running, setRunning] = useState(false);
  const [openFile, setOpenFile] = useState<string | null>(null);
  // Bumping this remounts the frame, which is what "restart" means for a document that
  // has no server to reload from.
  const [runNonce, setRunNonce] = useState(0);
  const frameRef = useRef<HTMLIFrameElement>(null);

  // What the running document says about itself, over the ONE preview wire — scoped to
  // this surface's own frame, which a listener of its own could not do.
  const { log, summary, reset } = useCanvasPreviewLog(frameRef, running);

  // A rewritten card is a different app. Tearing the frame down rather than leaving it
  // is what stops the surface showing the previous build under the new file list.
  useEffect(() => { setRunning(false); reset(); }, [app.document, reset]);

  const run = useCallback(() => {
    reset();
    setRunNonce((value) => value + 1);
    setRunning(true);
  }, [reset]);

  const errors = summary.errors;
  const entryPath = app.entry?.path ?? '';
  const selected = app.files.find((file) => file.path === openFile) ?? app.files[0] ?? null;

  // Into the ONE session bar, for as long as this surface is mounted. See the header:
  // these used to be a second toolbar of this surface's own.
  //
  // Split into what you PRESS and what the runtime REPORTS, because the bar folds away
  // the first and keeps the second — an app that is running has to keep saying so even
  // when its Run button is hidden.
  useCanvasSurfaceActions(() => ({
    status: (
      <span
        className={styles.appAddress}
        data-running={running}
        role="status"
        aria-live="polite"
      >
        {running && entryPath ? entryPath : t('stopped')}
      </span>
    ),
    controls: (
    <div className={styles.appBarControls} role="group" aria-label={t('regionLabel')}>
      <button
        type="button"
        className={styles.appRunButton}
        data-running={running}
        disabled={!app.document}
        onClick={() => (running ? setRunning(false) : run())}
      >
        <span className={styles.appRunDot} aria-hidden />
        {running ? t('stop') : t('run')}
      </button>

      <div className={styles.segmentedGroup} role="group" aria-label={t('readings')}>
        {READINGS.map((option) => {
          const Glyph = READING_ICON[option];
          const name = t(`reading.${option}` as 'reading.preview');
          return (
            <button
              key={option}
              type="button"
              onClick={() => setReading(option)}
              aria-pressed={reading === option}
              aria-label={name}
              title={name}
            >
              <Glyph />
              {option === 'console' && errors > 0 && (
                <span className={styles.appErrorCount} aria-label={t('errorCount', { count: errors })}>{errors}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* The width the READER is checking — the ONE switcher, shared with the site
          surface. Local and unpersisted: looking at a desktop app on a phone frame for a
          moment must not quietly re-author what the app is designed for. */}
      <CanvasViewportSwitcher value={viewport} onChange={setViewport} />

    </div>
    ),
  }), [running, reading, viewport, errors, entryPath, app.document, t]);

  return (
    <section
      className={styles.appSurface}
      data-testid="canvas-app-surface"
      aria-label={t('regionLabel')}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onExit(); } }}
    >
      <div className={styles.appSurfaceBody}>
        {app.files.length === 0 ? (
          <div className={styles.appEmpty} role="status">
            <strong>{t('emptyTitle')}</strong>
            <p>{t('emptyBody')}</p>
          </div>
        ) : (
          <>
            {reading === 'preview' && (
              <div className={styles.appStage} data-viewport={viewport}>
                {app.document && running ? (
                  /* Laid out at the width the reader picked and scaled into the stage —
                     never capped to the stage, which would hand the app's own media
                     queries the stage's width and make all three readings identical.
                     See `CanvasDeviceFrame`; that was this surface's defect. */
                  <CanvasDeviceFrame
                    frameRef={frameRef}
                    reloadKey={runNonce}
                    className={styles.appFrame}
                    viewport={viewport}
                    title={t('frameTitle', { path: entryPath })}
                    srcDoc={app.document}
                    // No `allow-same-origin`. See `CANVAS_APP_FRAME_SANDBOX` — with
                    // `allow-scripts` it would let the frame escape the sandbox entirely.
                    sandbox={CANVAS_APP_FRAME_SANDBOX}
                  />
                ) : (
                  <div className={styles.appIdle} role="status">
                    <strong>{app.document ? t('idleTitle') : t('noEntryTitle')}</strong>
                    <p>{app.document ? t('idleBody') : t('noEntryBody')}</p>
                  </div>
                )}
              </div>
            )}

            {reading === 'code' && (
              <div className={styles.appCode}>
                <nav className={styles.appTree} aria-label={t('files')}>
                  {app.files.map((file) => (
                    <button
                      key={file.path}
                      type="button"
                      onClick={() => setOpenFile(file.path)}
                      aria-current={selected?.path === file.path}
                      data-role={file.role}
                    >
                      <span>{file.path}</span>
                      {file.role === 'server' && <em>{t('role.server')}</em>}
                    </button>
                  ))}
                </nav>
                <div className={styles.appSource}>
                  {selected && (
                    <>
                      <div className={styles.appSourceBar}>
                        <b>{selected.path}</b>
                        {onOpenObject && (
                          <button type="button" onClick={() => onOpenObject(selected.nodeId)}>
                            {t('openCard')}
                          </button>
                        )}
                      </div>
                      <pre>{selected.source}</pre>
                    </>
                  )}
                </div>
              </div>
            )}

            {reading === 'console' && (
              <div className={styles.appConsole}>
                {app.server.length > 0 && (
                  <p className={styles.appServerNote} role="note">
                    {t('serverNote', { files: app.server.map((file) => file.path).join(', ') })}
                  </p>
                )}
                {log.length === 0 ? (
                  <p className={styles.appConsoleEmpty}>{running ? t('consoleQuiet') : t('consoleStopped')}</p>
                ) : (
                  <ol className={styles.appConsoleLines}>
                    {log.map((entry, index) => (
                      <li key={`${entry.at}-${index}`} data-level={entry.level}>
                        <span className={styles.appConsoleTime}>{(entry.at / 1000).toFixed(1)}s</span>
                        <span className={styles.appConsoleLevel}>{t(`level.${entry.level}` as 'level.log')}</span>
                        <span className={styles.appConsoleText}>{entry.text}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/** Exported for the test that reads the file list back — the surface renders it, and a
 *  projection nobody can name is a projection nobody can assert on. */
export type { CanvasAppFile };
