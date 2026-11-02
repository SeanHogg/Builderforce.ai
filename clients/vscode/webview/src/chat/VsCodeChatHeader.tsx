/**
 * The editor chat's header — THE shared `SurfaceHeader`, bound to this surface. It
 * carries no title (the chat's name lives in the history list), and its own actions
 * are the triage pair (copy diagnostics, run connection diagnostics). The chat picker
 * is the standard History lever, which swaps the body to the shared history list.
 */

import { useMemo } from 'react';
import { HeaderIcon, SurfaceHeader } from '@seanhogg/builderforce-brain-ui';
import { post, type LabelBundle } from '../vscodeBridge';
import { makeT, surfaceHeaderLabels } from './chatLabels';
import type { CopyState } from './useCopyDiagnostics';

const COPY_ICON: Record<CopyState, string> = {
  idle: 'M9 9h11v11H9zM5 15H4V4h11v1',
  copied: 'M5 12l5 5 9-10',
  error: 'M12 8v5M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
};

export interface VsCodeChatHeaderProps {
  running: boolean;
  copy: { state: CopyState; enabled: boolean; onCopy: () => void };
  history: { open: boolean; onToggle: () => void; controls: string };
  onNewChat: () => void;
  /** The host's label bundle. */
  bundle: LabelBundle;
  /** The installed extension's version, shown so "do I have the fix?" is answered at a glance. */
  version?: string;
  /** Opens the visualization beside the chat — given only where the board is not drawn here. */
  onVisualize?: () => void;
}

export function VsCodeChatHeader({ running, copy, history, onNewChat, bundle, version, onVisualize }: VsCodeChatHeaderProps) {
  const t = makeT(bundle);
  const headerLabels = useMemo(() => surfaceHeaderLabels(bundle), [bundle]);
  const copyLabel = copy.state === 'error'
    ? t('app.copyFailed', 'Could not build the chat diagnostics report.')
    : t('app.copyChat', 'Copy chat diagnostics (identity + Evermind state + transcript)');
  const diagnoseLabel = t('app.diagnostics', 'Run connection diagnostics');
  const visualizeLabel = t('app.visualize', 'Open the visualization beside the chat');
  const versionLabel = version ? t('app.version', 'BuilderForce extension version {version}').replace('{version}', version) : '';
  return (
    <SurfaceHeader
      title={null}
      running={running}
      actions={(
        <>
          {version && (
            <span className="bf-shead__version" title={versionLabel} aria-label={versionLabel}>v{version}</span>
          )}
          {onVisualize && (
            <button
              type="button"
              className="bf-shead__btn"
              title={visualizeLabel}
              aria-label={visualizeLabel}
              onClick={onVisualize}
            >
              <HeaderIcon d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" />
            </button>
          )}
          <button
            type="button"
            className="bf-shead__btn"
            title={copyLabel}
            aria-label={copyLabel}
            disabled={!copy.enabled}
            onClick={copy.onCopy}
          >
            <HeaderIcon d={COPY_ICON[copy.state]} />
          </button>
          <button
            type="button"
            className="bf-shead__btn"
            title={diagnoseLabel}
            aria-label={diagnoseLabel}
            onClick={() => post('diagnose')}
          >
            <HeaderIcon d="M3 12h4l3-8 4 16 3-8h4" />
          </button>
        </>
      )}
      history={history}
      onNewChat={onNewChat}
      labels={headerLabels}
    />
  );
}
