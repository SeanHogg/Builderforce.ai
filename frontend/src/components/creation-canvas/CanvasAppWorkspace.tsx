/*
 * No `'use client'` here, for the reason `CanvasAppSurface.tsx` gives: it is imported only
 * from inside the `CreationCanvas` client boundary.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CodeReadingIcon, ConsoleReadingIcon, PreviewReadingIcon } from '@/components/canvas/CanvasCommands';
import { Icon } from '@/components/ui/Icon';
import { VoiceGenerateButton } from '@/components/builder/VoiceGenerateButton';
import { WorkspaceCenter } from '@/components/builder/WorkspaceCenter';
import { WorkspaceOverlays } from '@/components/builder/WorkspaceOverlays';
import { WorkspaceSidePanels } from '@/components/builder/WorkspaceSidePanels';
import { useBuilderWorkspace } from '@/components/builder/useBuilderWorkspace';
import type { CenterView } from '@/components/builder/CenterViewSwitch';
import type { RunPhase } from '@/components/builder/useWorkspaceRun';
import { sendWorkspaceCommand } from '@/lib/workspace/workspaceCommands';
import { studioProjectPath } from '@/lib/studio/studioHost';
import type { SessionApp } from '@/lib/canvasSessionApp';
import type { FileEntry } from '@/lib/types';
import { CanvasBarGroup } from './CanvasBarGroup';
import { useCanvasSurfaceActions } from './canvasSurfaceActions';
import styles from './CreationCanvas.module.css';

const VIEW_ICON: Record<CenterView, () => React.ReactElement> = {
  preview: PreviewReadingIcon,
  code: CodeReadingIcon,
  database: () => <Icon name="database" size={15} />,
};

/** What the Run control says for each phase of the preview's life. */
const RUN_LABEL: Record<RunPhase, 'run' | 'restart' | 'starting'> = {
  idle: 'run',
  starting: 'starting',
  live: 'restart',
  failed: 'run',
  blocked: 'run',
};

export interface CanvasAppWorkspaceProps {
  app: SessionApp;
  initialFiles: FileEntry[];
  /** Every app on the board — the switcher appears only when there is more than one. */
  apps: readonly SessionApp[];
  onSelectApp: (nodeId: string) => void;
}

/**
 * The Builder workspace as the canvas App surface lays it out.
 *
 * Same workspace as Studio (`useBuilderWorkspace` and its shared regions) — the real files,
 * the in-browser runtime, the terminal, the database and publishing — inside the canvas's
 * OWN chrome. So there is no workspace header and no docked Brain: the canvas Brain is the
 * one that talks, through the build tools bound to this app, and this layout's controls go
 * into the ONE session bar the way every surface's do (`useCanvasSurfaceActions`).
 *
 * The shell's colour tokens the workspace regions use are remapped onto the canvas's own
 * palette by `.appWorkspace`, so the workspace reads as part of the canvas in light and dark.
 */
export function CanvasAppWorkspace({ app, initialFiles, apps, onSelectApp }: CanvasAppWorkspaceProps) {
  const t = useTranslations('creationCanvas.surface.app');
  const ws = useBuilderWorkspace({ store: app.store, name: app.title, modality: app.modality, initialFiles });
  const { runner, store, storageProjectId, modalityDef, modalityCopy, livePreview } = ws;
  const runLabel = RUN_LABEL[runner.phase];
  const filesOpen = ws.railOpen && ws.rightTab === 'files';
  const publishes = ws.rightTabs.includes('publish');
  const publishOpen = ws.railOpen && ws.rightTab === 'publish';
  // The switcher's content, as a value: `apps` is a fresh array on every board change.
  // The voice studio returns a fresh object every render; publishing on its identity would
  // re-render the bar, and with it this workspace, forever. Only what Generate reads matters,
  // and only for a type that has no live preview.
  const voiceState = livePreview ? '' : JSON.stringify([ws.voice.busy, ws.voice.selectedCloneId, ws.voice.text]);
  const appChoices = JSON.stringify(apps.map((candidate) => [candidate.nodeId, candidate.title]));

  useCanvasSurfaceActions(() => ({
    // ONE Publish door: while the app is open, the bar's own Publish ships the app's site
    // instead of a second glyph beside it (operator decision, 2026-10-04).
    publish: publishes ? { run: () => ws.openRail('publish'), active: publishOpen } : undefined,
    status: (
      <span className={styles.appAddress} data-running={runner.phase === 'live'} role="status" aria-live="polite">
        {t(`phase.${runner.phase}` as 'phase.idle')}
      </span>
    ),
    controls: (
      <CanvasBarGroup caption={t('label')} label={t('regionLabel')}>
        <div className={styles.appBarControls}>
          {livePreview && (
            <button
              type="button"
              className={styles.appRunButton}
              data-running={runner.phase === 'live'}
              disabled={runner.phase === 'starting'}
              onClick={() => { void runner.run(); }}
            >
              <span className={styles.appRunDot} aria-hidden />
              {t(runLabel)}
            </button>
          )}
          {/* A type with no live preview (Voice) keeps an explicit button for its one action. */}
          {modalityDef.showRunButton && !livePreview && <VoiceGenerateButton voice={ws.voice} label={modalityCopy.runLabel} />}

          {ws.centerViews.length > 0 && (
            <div className={styles.segmentedGroup} role="group" aria-label={t('readings')}>
              {ws.centerViews.map((view) => {
                const Glyph = VIEW_ICON[view];
                const name = t(`reading.${view}` as 'reading.preview');
                return (
                  <button key={view} type="button" onClick={() => ws.selectView(view)} aria-pressed={ws.centerView === view} aria-label={name} title={name}>
                    <Glyph />
                  </button>
                );
              })}
            </div>
          )}

          <div className={styles.segmentedGroup} role="group" aria-label={t('panels')}>
            <button type="button" aria-pressed={filesOpen} aria-label={t('files')} title={t('files')} onClick={() => (filesOpen ? ws.setRailOpen(false) : ws.openRail('files'))}>
              <Icon name="folder" size={15} />
            </button>
            {livePreview && (
              <button type="button" aria-label={t('terminal')} title={t('terminal')} onClick={() => sendWorkspaceCommand(store.id, { type: 'showPanel', panel: 'terminal' })}>
                <ConsoleReadingIcon />
              </button>
            )}
          </div>

          {/* The same app in Studio, in this tab; Studio's "Open on canvas" comes back. */}
          {storageProjectId !== null && (
            <Link className={styles.appStudioLink} href={studioProjectPath(storageProjectId)} title={t('openInStudio')}>
              <Icon name="external-link" size={14} />
              <span>{t('openInStudio')}</span>
            </Link>
          )}

          {apps.length > 1 && (
            <label className={styles.appSwitcher}>
              <span className="sr-only">{t('switchApp')}</span>
              <select value={app.nodeId} onChange={(event) => onSelectApp(event.target.value)} title={t('switchApp')}>
                {apps.map((candidate) => <option key={candidate.nodeId} value={candidate.nodeId}>{candidate.title}</option>)}
              </select>
            </label>
          )}
          {!ws.durable && <span className={styles.appLocalBadge} title={t('localHint')}>{t('localBadge')}</span>}
        </div>
      </CanvasBarGroup>
    ),
  }), [runner.phase, runLabel, ws.centerView, ws.centerViews, filesOpen, publishes, publishOpen, appChoices, app.nodeId, storageProjectId, store.id, ws.durable, livePreview, modalityDef.showRunButton, voiceState, runner.run, ws.selectView, ws.openRail, ws.setRailOpen, onSelectApp, t]);

  return (
    <div className={styles.appWorkspace} data-testid="canvas-app-workspace">
      <WorkspaceOverlays ws={ws} />
      <WorkspaceCenter ws={ws} hidden={ws.narrow && ws.railOpen} />
      <WorkspaceSidePanels ws={ws} visible />
    </div>
  );
}
