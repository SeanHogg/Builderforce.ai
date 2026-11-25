/**
 * The Knowledge view's wiring to THIS webview's bridge: the transport the source messages
 * the host through, and the focus the host hands it (`builderforce.openKnowledgeGraph` —
 * Open in graph chips, `/graph`), taken once on mount and then followed live.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { EditorView, KnowledgeGraphSource, SourceLocation } from '@builderforce/knowledge-graph-view';
import { onHostMessage, request } from '../vscodeBridge';
import {
  KNOWLEDGE_CALL, KNOWLEDGE_EDITOR, KNOWLEDGE_EVENT, KNOWLEDGE_FOCUS, type KnowledgeEditorFrame, type KnowledgeEventFrame, type KnowledgeFocusFrame,
} from '../../../src/knowledge/knowledgeProtocol';
import { composeThrough, createHostKnowledgeGraphSource, reviewCount, type KnowledgeTransport } from './hostKnowledgeGraphSource';

/** `knowledge.call` round-trips and `knowledge.event` frames over the bridge. */
export const bridgeKnowledgeTransport: KnowledgeTransport = {
  call: (call) => request(KNOWLEDGE_CALL, call as unknown as Record<string, unknown>),
  onEvent: (cb) => onHostMessage<KnowledgeEventFrame>(KNOWLEDGE_EVENT, (frame) => { if (frame.event) cb(frame.event); }),
};

export interface KnowledgeHost {
  source: KnowledgeGraphSource;
  /** The focus asked for, and a counter that moves whenever it is asked again. */
  focus: KnowledgeFocusFrame | null;
  focusRequests: number;
  /** Fix with agent → the ONE composer (a chat seeded with the request). */
  compose(text: string): void;
  /** A review is in flight (planning, confirm or running): the panel holds its view still. */
  reviewing: boolean;
  /** "Open at line": the extension opens the file of the loaded root with the lines selected. */
  openSource(location: SourceLocation): void;
  /** What the editor shows of a file of the loaded root (the code band follows it); null until the editor says. */
  editor: EditorView | null;
}

/** The editor's latest `knowledge.editor` frame, as the view's `EditorView` (the host posts frames of the loaded root only). */
export function useEditorView(): EditorView | null {
  const [view, setView] = useState<EditorView | null>(null);
  useEffect(() => onHostMessage<KnowledgeEditorFrame>(KNOWLEDGE_EDITOR, (frame) => {
    setView({ path: frame.path, firstLine: frame.firstLine, lastLine: frame.lastLine, cursorLine: frame.cursorLine });
  }), []);
  return view;
}

export function useKnowledgeHost(overlay: (graph: KnowledgeGraph, changed: readonly string[]) => KnowledgeGraph): KnowledgeHost {
  // A COUNT of live reviews: a superseded review's end must not clear the flag of the one that replaced it.
  const [liveReviews, setLiveReviews] = useState(0);
  const reviewing = liveReviews > 0;
  const onReviewActive = useCallback((active: boolean) => setLiveReviews((n) => reviewCount(n, active)), []);
  // The root the view last loaded: a SourceLocation names a path, the extension also needs its root.
  const loadedRoot = useRef<string | null>(null);
  const onLoad = useCallback((rootId: string) => { loadedRoot.current = rootId; }, []);
  const source = useMemo(() => createHostKnowledgeGraphSource(bridgeKnowledgeTransport, { overlay, onReviewActive, onLoad }), [overlay, onReviewActive, onLoad]);
  const editor = useEditorView();
  const openSource = useCallback((location: SourceLocation) => {
    const rootId = loadedRoot.current;
    if (!rootId) return;
    bridgeKnowledgeTransport.call({
      op: 'openSource', rootId, path: location.path, startLine: location.startLine, endLine: location.endLine,
    // error-logging: a click handler has no caller to rethrow to; the editor simply does not open, the view stays as it was.
    }).catch((error: unknown) => console.error('[builderforce] open at line failed', error));
  }, []);
  const [focus, setFocus] = useState<KnowledgeFocusFrame | null>(null);
  const [focusRequests, setFocusRequests] = useState(0);

  useEffect(() => {
    const take = (frame: KnowledgeFocusFrame | null): void => {
      if (!frame) return;
      setFocus({ focus: Array.isArray(frame.focus) ? frame.focus : [], ...(frame.rootId ? { rootId: frame.rootId } : {}) });
      setFocusRequests((n) => n + 1);
    };
    // The host holds the focus until it is TAKEN, so a frame that lands before this view
    // mounted is not lost and one that lands after is not applied twice.
    const takeFocus = (): void => {
      void bridgeKnowledgeTransport.call<KnowledgeFocusFrame | null>({ op: 'takeFocus' }).then(take, () => undefined);
    };
    takeFocus();
    return onHostMessage<KnowledgeFocusFrame>(KNOWLEDGE_FOCUS, takeFocus);
  }, []);

  // The Agent runs drawer's Fix action composes a prompt into the host's ONE composer (a fresh Brain chat).
  return {
    source,
    focus,
    focusRequests,
    reviewing,
    compose: composeThrough(bridgeKnowledgeTransport),
    openSource,
    editor,
  };
}
