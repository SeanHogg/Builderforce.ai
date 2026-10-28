/**
 * The Knowledge view's wiring to THIS webview's bridge: the transport the source messages
 * the host through, and the focus the host hands it (`builderforce.openKnowledgeGraph` —
 * Open in graph chips, `/graph`), taken once on mount and then followed live.
 */

import { useEffect, useMemo, useState } from 'react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeGraphSource } from '@builderforce/knowledge-graph-view';
import { onHostMessage, request } from '../vscodeBridge';
import {
  KNOWLEDGE_CALL, KNOWLEDGE_EVENT, KNOWLEDGE_FOCUS, type KnowledgeEventFrame, type KnowledgeFocusFrame,
} from '../../../src/knowledge/knowledgeProtocol';
import { createHostKnowledgeGraphSource, type KnowledgeTransport } from './hostKnowledgeGraphSource';

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
}

export function useKnowledgeHost(overlay: (graph: KnowledgeGraph, changed: readonly string[]) => KnowledgeGraph): KnowledgeHost {
  const source = useMemo(() => createHostKnowledgeGraphSource(bridgeKnowledgeTransport, { overlay }), [overlay]);
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

  return {
    source,
    focus,
    focusRequests,
    compose: (text) => { void bridgeKnowledgeTransport.call({ op: 'compose', text }).catch(() => undefined); },
  };
}
