'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import {
  getCanvasHost,
  subscribeCanvasHost,
  type CanvasHostCapture,
  type CanvasHostRange,
} from '@/lib/canvasHost';
import type { CreationFlowNode } from './CreationNode';
import styles from './CreationCanvas.module.css';

/**
 * The editor-only actions in the Canvas session bar.
 *
 * Renders NOTHING unless an editor host has registered itself (see
 * `@/lib/canvasHost`) — so the web app is untouched and this component decides
 * its own visibility rather than taking a `isVsCode` prop to interpret. Inside
 * the VS Code webview the host contributes capture actions (active file, current
 * selection, problems, repository, terminal output, local preview) plus a way
 * back into the editor for any object that carries a `path`.
 *
 * Action labels arrive already localized FROM the host, which translates them
 * through `vscode.l10n` — the catalog the rest of the extension uses. Only the
 * strings this component owns come from the web catalogs.
 */
export function CanvasHostActions({
  selectedNode,
  disabled,
  onCapture,
  onError,
}: {
  /** The single selected object, if exactly one is selected. */
  selectedNode: CreationFlowNode | null;
  /** True when the session role (or an editing lock) forbids changes. */
  disabled: boolean;
  /** Place a captured object on the board. */
  onCapture: (capture: CanvasHostCapture) => void;
  /** Surface a failed capture using the canvas's own notice channel. */
  onError: (message: string) => void;
}) {
  const t = useTranslations('creationCanvas');
  const host = useSyncExternalStore(subscribeCanvasHost, getCanvasHost, () => null);
  const [busy, setBusy] = useState<string | null>(null);

  // A capture can outlive this component (the user is picking a file, pasting
  // terminal output). Drop the result instead of setting state after unmount.
  const mounted = useMountedRef();

  const run = useCallback(
    async (actionId: string) => {
      const action = host?.actions.find((candidate) => candidate.id === actionId);
      if (!action) return;
      setBusy(actionId);
      try {
        const capture = await action.run();
        if (!mounted.current) return;
        // null is "the user cancelled" / "nothing to capture" — not a failure.
        if (capture) onCapture(capture);
      } catch (error) {
        if (mounted.current) onError(error instanceof Error ? error.message : String(error));
      } finally {
        if (mounted.current) setBusy(null);
      }
    },
    [host, mounted, onCapture, onError],
  );

  if (!host) return null;

  const path = typeof selectedNode?.data.path === 'string' ? selectedNode.data.path : null;
  const range = selectedNode?.data.range as CanvasHostRange | undefined;

  return (
    <div className={styles.hostActions} role="group" aria-label={t('editorActions')}>
      {host.actions.map((action) => (
        <button
          key={action.id}
          type="button"
          className={styles.secondaryButton}
          disabled={disabled || busy !== null}
          aria-label={action.label}
          title={action.label}
          aria-busy={busy === action.id}
          onClick={() => void run(action.id)}
        >
          <span aria-hidden>{action.icon}</span>
        </button>
      ))}
      {path && (
        <button
          type="button"
          className={styles.secondaryButton}
          aria-label={t('openInEditor')}
          title={t('openInEditor')}
          onClick={() => host.openFile(path, range)}
        >
          <span aria-hidden>↗</span>
        </button>
      )}
    </div>
  );
}

/** Tracks mount state so an in-flight capture never sets state after teardown. */
function useMountedRef() {
  const [ref] = useState(() => ({ current: true }));
  useEffect(() => {
    ref.current = true;
    return () => {
      ref.current = false;
    };
  }, [ref]);
  return ref;
}
