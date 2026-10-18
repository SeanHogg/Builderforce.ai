/**
 * The editor chat's header — THE shared `SurfaceHeader`, bound to this surface: the
 * chat's project names it, the open chat's title is its context, and its own actions
 * are the triage pair (copy diagnostics, run connection diagnostics). The chat picker
 * is the standard History lever, which swaps the body to the shared history list.
 */

import { useMemo } from 'react';
import { HeaderIcon, InlineChatTitle, SurfaceHeader } from '@seanhogg/builderforce-brain-ui';
import { post, type LabelBundle } from '../vscodeBridge';
import { makeT, surfaceHeaderLabels } from './chatLabels';
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
  /** The open chat's id — null while there is no chat yet, so nothing offers to rename. */
  chatId: number | null;
  /** Persist an inline edit of the title (the shared `useBrainChats.rename`). */
  onRename: (id: number, title: string) => Promise<unknown> | void;
  running: boolean;
  copy: { state: CopyState; enabled: boolean; onCopy: () => void };
  history: { open: boolean; onToggle: () => void; controls: string };
  onNewChat: () => void;
  /** The host's label bundle. */
  bundle: LabelBundle;
}

export function VsCodeChatHeader({ projectName, chatTitle, chatId, onRename, running, copy, history, onNewChat, bundle }: VsCodeChatHeaderProps) {
  const t = makeT(bundle);
  const headerLabels = useMemo(() => surfaceHeaderLabels(bundle), [bundle]);
  const title = projectName ?? 'BuilderForce';
  const copyLabel = copy.state === 'error'
    ? t('app.copyFailed', 'Could not build the chat diagnostics report.')
    : t('app.copyChat', 'Copy chat diagnostics (identity + Evermind state + transcript)');
  const diagnoseLabel = t('app.diagnostics', 'Run connection diagnostics');
  return (
    <SurfaceHeader
      title={<span title={title}>{title}</span>}
      running={running}
      context={(
        // The CHAT's own name, editable in place — not the brand row above it.
        <InlineChatTitle
          title={chatTitle}
          chatId={chatId}
          onRename={onRename}
          titleClassName="bf-chat-context"
          labels={{
            edit: t('app.editTitle', 'Edit chat title'),
            label: t('app.titleLabel', 'Chat title'),
            save: t('app.saveTitle', 'Save chat title'),
            cancel: t('app.cancelTitle', 'Cancel'),
          }}
        />
      )}
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
      labels={headerLabels}
    />
  );
}
