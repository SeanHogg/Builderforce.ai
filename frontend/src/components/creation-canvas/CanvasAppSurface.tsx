/*
 * No `'use client'` here on purpose. This is imported only by `CreationCanvas.tsx`, which
 * already declares the boundary, so a directive would mark a second entry point that does
 * not exist — and `check-frontend-architecture` counts directives, not components.
 */
import { useEffect, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { ChunkErrorBoundary } from '@/components/ChunkErrorBoundary';
import { useStoreFiles } from '@/components/builder/useStoreFiles';
import { canvasAppFiles } from '@/lib/canvasApp';
import { appCardSignature, type SessionApp } from '@/lib/canvasSessionApp';
import type { ProjectModality } from '@/lib/modality';
import { CanvasAppStart } from './CanvasAppStart';
import type { CanvasSessionAppActions } from './hooks/useCanvasSessionApp';
import styles from './CreationCanvas.module.css';
import type { CreationNodeData } from './types';

// The editor, the runtime client and the panels are the heaviest code on the canvas, and
// most boards never open App — so they load when it opens, not with the board.
const CanvasAppWorkspace = dynamic(() => import('./CanvasAppWorkspace').then((module) => module.CanvasAppWorkspace), { ssr: false });

/**
 * The session's app — the App surface.
 *
 * ── WHAT IT RUNS ─────────────────────────────────────────────────────────────────
 * The real Builder workspace (files, the in-browser runtime, terminal, database,
 * publishing), embedded in the canvas's own chrome — see `CanvasAppWorkspace`. It used to
 * run the board's code cards as one inlined document in an opaque frame, which could show
 * a front end and could only NAME a server. That runner is gone; the cards are now brought
 * into the app's files instead (below), where the runtime can run all of them.
 *
 * ── WHICH APP ────────────────────────────────────────────────────────────────────
 * The session's primary Builder object (`lib/canvasSessionApp.ts`). A board with none is
 * offered a choice of what to make — unless it already holds code cards, in which case an
 * app is created for them without asking, because those cards ARE the app the person
 * opened this surface to run.
 *
 * ── THE BOARD'S CODE CARDS ───────────────────────────────────────────────────────
 * Brought in silently while the surface is open: on arrival, and again whenever a card is
 * added or edited, so a card Brain writes on the board shows up in the running app.
 *
 * ── NO ACCOUNT ───────────────────────────────────────────────────────────────────
 * The same workspace, over files held in this browser. "Keep your work" makes the board
 * durable, and the session's app follows it into a real project.
 */
export interface CanvasAppSurfaceProps {
  nodes: ReadonlyArray<{ id: string; data: CreationNodeData }>;
  session: CanvasSessionAppActions;
  persistence: 'local' | 'server';
  /** What the board is called — the name an app created from here starts with. */
  sessionTitle: string;
  /** The lens that opened this surface is creating the board's app (`useCanvasEntryApp`):
   *  say so rather than offering the chooser it is about to make moot. */
  entryAppPending?: boolean;
  /** Escape hands the board back. Pressing "App" again in the switcher is the other way out. */
  onExit: () => void;
}

export function CanvasAppSurface({ nodes, session, persistence, sessionTitle, entryAppPending = false, onExit }: CanvasAppSurfaceProps) {
  const t = useTranslations('creationCanvas.surface.app');
  const { app, apps, createApp, importCards, selectApp } = session;
  // Recomputed only when a card's content changes, never on a drag (see `appCardSignature`).
  const cards = appCardSignature(nodes);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `cards` is the dependency: it changes exactly when these cards do.
  const hasCodeCards = useMemo(() => canvasAppFiles(nodes).length > 0, [cards]);
  const title = sessionTitle.trim() || t('defaultAppTitle');

  // A board of code cards and no app: make the app those cards are, once.
  const autoCreated = useRef(false);
  useEffect(() => {
    if (app || !hasCodeCards || autoCreated.current) return;
    autoCreated.current = true;
    void createApp({ title, modality: 'designer' }).catch(() => { autoCreated.current = false; });
  }, [app, hasCodeCards, createApp, title]);

  // New or edited code cards follow the app while it is open.
  // Read through a ref: `app` is a fresh object on every board change, and keying the
  // import on it would run a pass on every drag. Its id and the cards are what matter.
  const appRef = useRef(app);
  useEffect(() => { appRef.current = app; });
  const appId = app?.nodeId ?? null;
  useEffect(() => {
    if (appRef.current) void importCards(appRef.current);
  }, [appId, cards, importCards]);

  const create = async (modality: ProjectModality) => { await createApp({ title, modality }); };

  return (
    <section
      className={styles.appSurface}
      data-testid="canvas-app-surface"
      aria-label={t('regionLabel')}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onExit(); } }}
    >
      <div className={styles.appSurfaceBody}>
        {app ? (
          <SessionAppWorkspace app={app} apps={apps} onSelectApp={selectApp} />
        ) : hasCodeCards || entryAppPending ? (
          <div className={styles.appEmpty} role="status"><strong>{t('preparing')}</strong></div>
        ) : (
          <CanvasAppStart durable={persistence === 'server'} onCreate={create} />
        )}
      </div>
    </section>
  );
}

/** One app's workspace, once its files are read. Keyed by store, so switching apps remounts. */
function SessionAppWorkspace({ app, apps, onSelectApp }: { app: SessionApp; apps: readonly SessionApp[]; onSelectApp: (nodeId: string) => void }) {
  const t = useTranslations('creationCanvas.surface.app');
  const { files, error } = useStoreFiles(app.store, t('loadFailed'));
  if (error) return <div className={styles.appEmpty} role="alert"><strong>{error}</strong></div>;
  if (!files) return <div className={styles.appEmpty} role="status"><strong>{t('loading')}</strong></div>;
  return (
    <ChunkErrorBoundary>
      <CanvasAppWorkspace key={String(app.store.id)} app={app} initialFiles={files} apps={apps} onSelectApp={onSelectApp} />
    </ChunkErrorBoundary>
  );
}
