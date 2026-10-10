// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useCallback, useEffect, useRef, useState } from 'react';
import { previewErrorFrom, recordBuildFailure } from '@/lib/buildDiagnostics';
import { VISUAL_ARM_MESSAGE, isVisualUnresolved, visualSelectionFrom } from '@/lib/visualEditor';
import { clearPreviewPick, setPreviewPick } from '@/lib/workspace/previewPick';
import type { WorkspaceFileStore } from '@/lib/workspace/workspaceFileStore';

/**
 * The host half of the preview conversation.
 *
 * Two kinds of message come back from the overlay injected into the mounted
 * preview (`lib/visualEditor.ts`, `lib/buildDiagnostics.ts`): a runtime error
 * thrown inside the app — recorded so the agent can read it — and an element the
 * person pointed at, which becomes the ONE prompt's context (`lib/workspace/previewPick.ts`):
 * a chip in the composer, and the exact file and line the next request is about.
 * There is no edit form of its own any more; the request goes to the same Brain as
 * every other one.
 *
 * Picking disarms: one click chooses one element, and the app works normally again
 * until "Select to edit" is pressed once more.
 *
 * `event.source` is deliberately not checked against the preview iframe: the
 * dev server is a cross-origin document whose `contentWindow` this frame cannot
 * compare, so the message TYPE plus the shape checks are the identification.
 * Both are namespaced, and the payload is only ever read as strings, so a
 * hostile sender's best case is a spurious diagnostic line or a wrong chip.
 */
export function usePointAndEdit({ store, appName, previewUrl }: {
  store: WorkspaceFileStore;
  /** Names the app in the pick — which app, on a board that holds more than one. */
  appName: string;
  previewUrl: string | undefined;
}) {
  // Cross-origin preview: postMessage through this window is the only channel.
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [armed, setArmed] = useState(false);
  // The last click landed on an element React gave no source for — said out loud, so
  // the click does not look like it did nothing. Cleared when picking starts again.
  const [unresolved, setUnresolved] = useState(false);

  const arm = useCallback((next: boolean) => {
    setArmed(next);
    if (next) setUnresolved(false);
    frameRef.current?.contentWindow?.postMessage({ type: VISUAL_ARM_MESSAGE, armed: next }, '*');
  }, []);

  useEffect(() => {
    if (!previewUrl) return undefined;
    const onMessage = (event: MessageEvent) => {
      const failure = previewErrorFrom(event.data);
      if (failure) { recordBuildFailure(store.id, failure); return; }
      if (isVisualUnresolved(event.data)) { setUnresolved(true); arm(false); return; }
      const selected = visualSelectionFrom(event.data);
      if (!selected) return;
      setUnresolved(false);
      setPreviewPick({ ...selected, workspaceId: store.id, appName });
      arm(false);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [previewUrl, store.id, appName, arm]);

  // A pick never outlives the preview it points into.
  useEffect(() => () => clearPreviewPick({ workspaceId: store.id }), [store.id]);

  // Re-arm after a reload: the overlay is a fresh script in a fresh document and
  // has no memory of having been armed before the dev server restarted it.
  useEffect(() => {
    if (!armed || !previewUrl) return undefined;
    const id = window.setTimeout(
      () => frameRef.current?.contentWindow?.postMessage({ type: VISUAL_ARM_MESSAGE, armed: true }, '*'),
      400,
    );
    return () => window.clearTimeout(id);
  }, [armed, previewUrl]);

  return { frameRef, armed, arm, unresolved };
}

export type PointAndEdit = ReturnType<typeof usePointAndEdit>;
