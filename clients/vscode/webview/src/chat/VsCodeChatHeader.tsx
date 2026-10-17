/**
 * The editor chat's header — THE shared `SurfaceHeader`, bound to this surface: the
 * chat's project names it, the open chat's title is its context, and its own actions
 * are the triage pair (copy diagnostics, run connection diagnostics). The chat picker
 * is the standard History lever, which swaps the body to the shared history list.
 */

import { HeaderIcon, SurfaceHeader } from '@seanhogg/builderforce-brain-ui';
import { post } from '../vscodeBridge';
import type { CopyState } from './useCopyDiagnostics';

const COPY_ICON: Record<CopyState, string> = {
  idle: 'M9 9h11v11H9zM5 15H4V4h11v1',
  copied: 'M5 12l5 5 9-10',
  error: 'M12 8v5M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
};

export interface VsCodeChatHeaderProps {
  /** The chat's project (chat-first); the brand when it has none. */
  projectName: string | null;
  /** The open chat's title (or "New chat"). */
  chatTitle: string;
  running: boolean;
  copy: { state: CopyState; enabled: boolean; onCopy: () => void };
  history: { open: boolean; onToggle: () => void; controls: string };
  onNewChat: () => void;
  t: (key: string, fallback: string) => string;
}

export function VsCodeChatHeader({ projectName, chatTitle, running, copy, history, onNewChat, t }: VsCodeChatHeaderProps) {
  const title = projectName ?? 'BuilderForce';
  const copyLabel = copy.state === 'error'
    ? t('app.copyFailed', 'Could not build the chat diagnostics report.')
    : t('app.copyChat', 'Copy chat diagnostics (identity + Evermind state + transcript)');
  const diagnoseLabel = t('app.diagnostics', 'Run connection diagnostics');
  return (
    <SurfaceHeader
      title={<span title={title}>{title}</span>}
      running={running}
      context={<span className="bf-chat-context" title={chatTitle}>{chatTitle}</span>}
      actions={(
        <>
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
      labels={{
        newChat: t('app.newChat', 'New chat'),
        historyShow: t('app.historyShow', 'Chat history'),
        historyHide: t('app.historyHide', 'Back to the chat'),
      }}
    />
  );
}
