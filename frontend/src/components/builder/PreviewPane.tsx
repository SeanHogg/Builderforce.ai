// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon, type IconName } from '@/components/ui/Icon';
import { PreviewFrame } from '@/components/PreviewFrame';
import { DevicePreview } from './DevicePreview';
import { PreviewStatus, type PreviewStatusState } from './PreviewStatus';
import { PointAndEditPanel } from './PointAndEditPanel';
import type { PointAndEdit } from './usePointAndEdit';
import type { RunPhase, RunStep } from './useWorkspaceRun';
import styles from './workspaceChrome.module.css';

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
 * The preview: a toolbar (restart, the live address, point & edit, size, open in
 * a tab) over the running app — or, before there is one, a status that says
 * what is happening. The app gets every pixel the toolbar does not use.
 */
export function PreviewPane({ projectId, url, phase, step, runnable, onRestart, edit, framing, onOpenDevicePanel }: {
  projectId: number;
  url: string | undefined;
  phase: RunPhase;
  step: RunStep | null;
  /** Whether the project has anything a preview could start from. */
  runnable: boolean;
  onRestart: () => void;
  edit: PointAndEdit;
  framing: PreviewFraming;
  onOpenDevicePanel?: () => void;
}) {
  const t = useTranslations('ide');
  const [size, setSize] = useState<PreviewSize>('desktop');
  const bezel = framing === 'bezel' || (framing === 'both' && size === 'phone');
  const starting = phase === 'starting';
  const width = SIZES.find((s) => s.id === size)?.width ?? '100%';

  const status = previewStatusFor({ url, phase, runnable });

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', flexWrap: 'wrap',
          background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0,
        }}
      >
        <button
          type="button"
          className={styles.iconButton}
          onClick={onRestart}
          disabled={starting || !runnable}
          aria-label={t('workspace.restart')}
          title={t('workspace.restart')}
        >
          <Icon name="refresh" size={17} />
        </button>
        <AddressPill url={url} phase={phase} />
        {!bezel && (
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => edit.arm(!edit.armed)}
            aria-pressed={edit.armed}
            disabled={!url}
            aria-label={edit.armed ? t('visualEditOn') : t('visualEdit')}
            title={t('visualEditHint')}
          >
            <Icon name="cursor" size={17} />
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
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => { if (url) window.open(url, '_blank'); }}
            disabled={!url}
            aria-label={t('workspace.openInTab')}
            title={t('workspace.openInTab')}
          >
            <Icon name="external-link" size={17} />
          </button>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', background: 'var(--bg-deep)' }}>
        {bezel ? (
          <DevicePreview url={url} onOpenDevicePanel={onOpenDevicePanel ?? (() => {})} />
        ) : (
          <div style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'center', padding: size === 'desktop' ? 0 : 16 }}>
            <div
              style={{
                width, maxWidth: '100%', height: '100%', overflow: 'hidden',
                borderRadius: size === 'desktop' ? 0 : 'var(--radius-lg)',
                border: size === 'desktop' ? 'none' : '1px solid var(--border-subtle)',
                background: 'var(--bg-surface)',
              }}
            >
              <PreviewFrame url={url} frameRef={edit.frameRef} />
            </div>
          </div>
        )}
        {status && <PreviewStatus state={status} step={step} projectId={projectId} onRetry={onRestart} />}
      </div>

      <PointAndEditPanel edit={edit} />
    </div>
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

function AddressPill({ url, phase }: { url: string | undefined; phase: RunPhase }) {
  const t = useTranslations('ide.workspace');
  const live = !!url && phase === 'live';
  const label = phase === 'starting' ? t('statusStarting') : live ? t('statusLive') : phase === 'failed' || phase === 'blocked' ? t('statusStopped') : t('statusIdle');
  return (
    <div
      style={{
        flex: '1 1 200px', minWidth: 0, height: 32, margin: '0 4px', display: 'flex', alignItems: 'center', gap: 8,
        padding: '0 12px', borderRadius: 'var(--radius-md)', background: 'var(--bg-deep)', border: '1px solid var(--border-subtle)',
      }}
    >
      <span
        role="status"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-size-small)', fontWeight: 600, flexShrink: 0, color: live ? 'var(--success-text)' : 'var(--text-muted)' }}
      >
        <span className={styles.dot} style={live ? undefined : { background: 'var(--text-muted)' }} />
        {label}
      </span>
      {url && (
        <span title={url} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono, monospace)', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
          {url}
        </span>
      )}
    </div>
  );
}
