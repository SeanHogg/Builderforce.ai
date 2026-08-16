/*
 * No `'use client'` here on purpose. This is imported only by `CreationCanvas.tsx`, which
 * already declares the boundary, so a directive would mark a second entry point that does
 * not exist — and `check-frontend-architecture` counts directives, not components.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  CANVAS_APP_FRAME_SANDBOX,
  CANVAS_APP_MESSAGE,
  CANVAS_APP_VIEWPORTS,
  canvasApp,
  type CanvasAppFile,
  type CanvasAppLogEntry,
  type CanvasAppViewport,
} from '@/lib/canvasApp';
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
 * ── WHY THE SHIP CONTROL IS A BUTTON AND NOT A RAIL ──────────────────────────────
 * Build → Stage → Live already exists, complete, in `CanvasReleasesPanel`: it snapshots,
 * runs the harness, refuses to publish while anything blocks, shows the buyer's own view
 * of the product and can revert. Redrawing any of that here would be a second copy of a
 * gate the server owns — the exact failure that panel's own header warns about. So this
 * surface adds a DOOR to it, scoped to the whole board, and owns none of the lifecycle.
 */

const READINGS = ['preview', 'code', 'console'] as const;
type AppReading = (typeof READINGS)[number];

/** How many lines the console keeps. A runaway `console.log` in a render loop must not
 *  grow this array without bound while the user watches the frame. */
const MAX_LOG_LINES = 200;

export interface CanvasAppSurfaceProps {
  nodes: ReadonlyArray<{ id: string; data: CreationNodeData }>;
  onExit: () => void;
  /** Open the release lifecycle for the whole board. Absent when the session cannot
   *  publish at all (a guest board with nothing persisted), in which case the control
   *  stands down rather than being drawn dead. */
  onPublish?: () => void;
  /** Send the reader to the card a file came from. */
  onOpenObject?: (nodeId: string) => void;
}

export function CanvasAppSurface({ nodes, onExit, onPublish, onOpenObject }: CanvasAppSurfaceProps) {
  const t = useTranslations('creationCanvas.surface.app');
  const tSurface = useTranslations('creationCanvas');
  const app = useMemo(() => canvasApp(nodes), [nodes]);
  const [reading, setReading] = useState<AppReading>('preview');
  const [viewport, setViewport] = useState<CanvasAppViewport>('desktop');
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<CanvasAppLogEntry[]>([]);
  const [openFile, setOpenFile] = useState<string | null>(null);
  // Bumping this remounts the frame, which is what "restart" means for a document that
  // has no server to reload from.
  const [runNonce, setRunNonce] = useState(0);

  // A rewritten card is a different app. Tearing the frame down rather than leaving it
  // is what stops the surface showing the previous build under the new file list.
  useEffect(() => { setRunning(false); setLog([]); }, [app.document]);

  useEffect(() => {
    if (!running) return;
    const onMessage = (event: MessageEvent) => {
      const payload = event.data as { tag?: unknown; level?: unknown; text?: unknown; at?: unknown } | null;
      if (!payload || payload.tag !== CANVAS_APP_MESSAGE) return;
      const level = payload.level;
      if (level !== 'log' && level !== 'warn' && level !== 'error' && level !== 'request') return;
      const entry: CanvasAppLogEntry = {
        level,
        text: typeof payload.text === 'string' ? payload.text : '',
        at: typeof payload.at === 'number' ? payload.at : 0,
      };
      setLog((current) => [...current, entry].slice(-MAX_LOG_LINES));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [running]);

  const run = useCallback(() => {
    setLog([]);
    setRunNonce((value) => value + 1);
    setRunning(true);
  }, []);

  const errors = log.filter((entry) => entry.level === 'error').length;
  const entryPath = app.entry?.path ?? '';
  const selected = app.files.find((file) => file.path === openFile) ?? app.files[0] ?? null;

  return (
    <section
      className={styles.appSurface}
      data-testid="canvas-app-surface"
      aria-label={t('regionLabel')}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onExit(); } }}
    >
      <header className={styles.appSurfaceHeader}>
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

        <div className={styles.appReadings} role="group" aria-label={t('readings')}>
          {READINGS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setReading(option)}
              aria-pressed={reading === option}
            >
              {t(`reading.${option}` as 'reading.preview')}
              {option === 'console' && errors > 0 && (
                <span className={styles.appErrorCount} aria-label={t('errorCount', { count: errors })}>{errors}</span>
              )}
            </button>
          ))}
        </div>

        {/* The width the READER is checking. Local and unpersisted for the same reason
            the site surface keeps its own: looking at a desktop app on a phone frame for
            a moment must not quietly re-author what the app is designed for. */}
        <div className={styles.appViewports} role="group" aria-label={t('viewport')}>
          {CANVAS_APP_VIEWPORTS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setViewport(option)}
              aria-pressed={viewport === option}
              title={t(`viewportName.${option}` as 'viewportName.desktop')}
            >
              {t(`viewportName.${option}` as 'viewportName.desktop')}
            </button>
          ))}
        </div>

        <span className={styles.appAddress} aria-live="polite">
          {running && entryPath ? entryPath : t('stopped')}
        </span>

        {onPublish && (
          <button type="button" className={styles.appPublishButton} onClick={onPublish}>
            {t('publish')}
          </button>
        )}
        <button type="button" className={styles.objectSurfaceExit} onClick={onExit}>
          {tSurface('surface.backToBoard')}
        </button>
      </header>

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
                  <iframe
                    key={runNonce}
                    className={styles.appFrame}
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
