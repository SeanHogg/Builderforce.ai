// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon, type IconName } from '@/components/ui/Icon';
import { PreviewFrame } from '@/components/PreviewFrame';
import { useFormat } from '@/i18n/useFormat';
import { navigatePreview } from '@/lib/visualEditor';
import { previewDisplayAddress } from '@/lib/browserRuntime/previewAddress';
import { DevicePreview } from './DevicePreview';
import { PreviewStatus, type PreviewStatusState } from './PreviewStatus';
import { PreviewChangeToast } from './PreviewChangeToast';
import { usePreviewFreshness } from './usePreviewFreshness';
import type { PointAndEdit } from './usePointAndEdit';
import type { ProjectVersions } from './useProjectVersions';
import type { RunPhase, RunStep } from './useWorkspaceRun';
import styles from './workspaceChrome.module.css';
import type { WorkspaceId } from '@/lib/workspace/workspaceId';

/**
 * How a project type frames its preview:
 * - `frame`  a web page, resizable to desktop / tablet / phone widths
 * - `bezel`  a phone app, always in the device simulator (it has its own controls)
 * - `both`   one codebase shipped as web and phone: phone width uses the simulator
 */
export type PreviewFraming = 'frame' | 'bezel' | 'both';

type PreviewSize = 'desktop' | 'tablet' | 'phone';

const SIZES: ReadonlyArray<{ id: PreviewSize; icon: IconName; width: string }> = [
  { id: 'desktop', icon: 'monitor', width: '100%' },
  { id: 'tablet', icon: 'tablet', width: '820px' },
  { id: 'phone', icon: 'mobile', width: '390px' },
];

/**
 * The preview: a browser-like toolbar (back, forward, restart, the live address
 * and when it last changed, Select to edit, size, open in a tab) over the running
 * app, framed as a page on the workspace's ground — or, before there is one, a
 * status that says what is happening.
 */
export function PreviewPane({ projectId, projectName, url, phase, step, runnable, onRestart, onOpenVersions, versions, edit, framing, onOpenDevicePanel }: {
  projectId: WorkspaceId;
  /** Names the preview's address (`<project>-preview.builderforce.ai`). */
  projectName: string;
  url: string | undefined;
  phase: RunPhase;
  step: RunStep | null;
  /** Whether the project has anything a preview could start from. */
  runnable: boolean;
  onRestart: () => void;
  /** Opens the project's versions, when it has them (a durable project). */
  onOpenVersions?: () => void;
  /** The project's versions, when it has them: an agent turn landing shows "Preview updated · Undo". */
  versions?: ProjectVersions;
  edit: PointAndEdit;
  framing: PreviewFraming;
  onOpenDevicePanel?: () => void;
}) {
  const t = useTranslations('ide');
  const [size, setSize] = useState<PreviewSize>('desktop');
  const bezel = framing === 'bezel' || (framing === 'both' && size === 'phone');
  const starting = phase === 'starting';
  const width = SIZES.find((s) => s.id === size)?.width ?? '100%';
  const desktop = size === 'desktop';

  const status = previewStatusFor({ url, phase, runnable });

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div className={styles.previewToolbar}>
        {!bezel && (
          <>
            <ToolbarIcon icon="chevron-left" label={t('workspace.back')} disabled={!url} onClick={() => navigatePreview(edit.frameRef.current, 'back')} />
            <ToolbarIcon icon="chevron-right" label={t('workspace.forward')} disabled={!url} onClick={() => navigatePreview(edit.frameRef.current, 'forward')} />
          </>
        )}
        <ToolbarIcon icon="refresh" label={t('workspace.restart')} disabled={starting || !runnable} onClick={onRestart} />
        <AddressPill projectId={projectId} projectName={projectName} url={url} phase={phase} />
        {!bezel && (
          <button
            type="button"
            className={styles.toolbarButton}
            onClick={() => edit.arm(!edit.armed)}
            aria-pressed={edit.armed}
            disabled={!url}
            title={t('visualEditHint')}
          >
            <Icon name="cursor" size={15} />
            <span className={styles.toolbarButtonLabel}>{edit.armed ? t('visualEditOn') : t('visualEdit')}</span>
          </button>
        )}
        {framing !== 'bezel' && (
          <div role="group" aria-label={t('workspace.previewSize')} className={styles.segmented}>
            {SIZES.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={size === s.id}
                onClick={() => setSize(s.id)}
                aria-label={t(`workspace.size.${s.id}`)}
                title={t(`workspace.size.${s.id}`)}
                className={`${styles.segment} ${styles.segmentIcon}`}
              >
                <Icon name={s.icon} size={15} />
              </button>
            ))}
          </div>
        )}
        {!bezel && (
          <ToolbarIcon icon="external-link" label={t('workspace.openInTab')} disabled={!url} onClick={() => { if (url) window.open(url, '_blank'); }} />
        )}
      </div>

      {edit.unresolved && (
        <p role="status" style={{ margin: 0, padding: '6px 12px', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', background: 'var(--surface-interactive)', borderBottom: '1px solid var(--border-subtle)' }}>
          {t('previewPick.unresolved')}
        </p>
      )}
      <div className={styles.previewStage}>
        {bezel ? (
          <DevicePreview url={url} onOpenDevicePanel={onOpenDevicePanel ?? (() => {})} />
        ) : (
          <div className={styles.previewStageInner} data-size={size}>
            <div
              className={styles.previewPage}
              style={{ width }}
              data-desktop={desktop || undefined}
            >
              <PreviewFrame url={url} frameRef={edit.frameRef} />
            </div>
          </div>
        )}
        {!status && versions && <PreviewChangeToast versions={versions} />}
        {status && <PreviewStatus state={status} step={step} projectId={projectId} onRetry={onRestart} onOpenVersions={onOpenVersions} />}
      </div>
    </div>
  );
}

function ToolbarIcon({ icon, label, disabled, onClick }: { icon: IconName; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={styles.iconButton} onClick={onClick} disabled={disabled} aria-label={label} title={label}>
      <Icon name={icon} size={17} />
    </button>
  );
}

/** Which status (if any) covers the preview. */
function previewStatusFor({ url, phase, runnable }: { url: string | undefined; phase: RunPhase; runnable: boolean }): PreviewStatusState | null {
  if (phase === 'failed' || phase === 'blocked') return phase;
  if (url) return null;
  if (phase === 'starting') return 'starting';
  // Idle with something to run: the auto-runner is about to start it.
  return runnable ? 'starting' : 'empty';
}

function AddressPill({ projectId, projectName, url, phase }: { projectId: WorkspaceId; projectName: string; url: string | undefined; phase: RunPhase }) {
  const t = useTranslations('ide.workspace');
  const fmt = useFormat();
  const { updatedAt, now } = usePreviewFreshness(projectId, url);
  const live = !!url && phase === 'live';
  const label = phase === 'starting' ? t('statusStarting') : live ? t('statusLive') : phase === 'failed' || phase === 'blocked' ? t('statusStopped') : t('statusIdle');
  return (
    <div className={styles.addressPill}>
      <span role="status" className={styles.addressState} data-live={live || undefined}>
        <span className={styles.dot} data-muted={!live || undefined} />
        {label}
      </span>
      {url && <span title={url} className={styles.addressUrl}>{previewDisplayAddress(url, projectName)}</span>}
      {live && updatedAt != null && (
        <span className={styles.addressFresh}>{t('updatedAgo', { when: fmt.relative(updatedAt, new Date(now)) })}</span>
      )}
    </div>
  );
}
