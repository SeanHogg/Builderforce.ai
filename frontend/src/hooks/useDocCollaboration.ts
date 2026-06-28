'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

/**
 * Document-scoped real-time collaboration for the Knowledge editor.
 *
 * Reuses the same opt-in transport as {@link useCollaboration} (the shared
 * CollaborationRoom Durable Object in the `worker/` deployment): set
 * NEXT_PUBLIC_COLLAB_WS_URL to enable. When unset the hook is inert — the editor
 * falls back to plain local editing with autosave, no WS attempted, no spam.
 *
 * When enabled, the document body is a shared Y.Text bound to the editor via
 * `value` / `setValue`, and `peers` reflects awareness (who else is editing).
 */

export interface CollabPeer {
  userId: string;
  name: string;
  color: string;
}

interface Options {
  userId: string;
  name: string;
  /** Seed content from the API; written into the shared doc only if it is empty. */
  initialContent: string;
}

function getCollabWsUrl(): string | null {
  const explicit = process.env.NEXT_PUBLIC_COLLAB_WS_URL;
  if (explicit && explicit.trim()) return explicit.replace(/\/+$/, '');
  return null;
}

function colorFor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360}, 65%, 55%)`;
}

/** Apply the minimal prefix/suffix diff so mid-document edits don't clobber peers. */
function applyTextDiff(ytext: Y.Text, oldStr: string, newStr: string): void {
  if (oldStr === newStr) return;
  let start = 0;
  const minLen = Math.min(oldStr.length, newStr.length);
  while (start < minLen && oldStr[start] === newStr[start]) start++;
  let endOld = oldStr.length;
  let endNew = newStr.length;
  while (endOld > start && endNew > start && oldStr[endOld - 1] === newStr[endNew - 1]) {
    endOld--;
    endNew--;
  }
  const delCount = endOld - start;
  const insert = newStr.slice(start, endNew);
  if (delCount > 0) ytext.delete(start, delCount);
  if (insert.length > 0) ytext.insert(start, insert);
}

export interface DocCollaboration {
  /** True when collaboration is configured AND a room is active. */
  enabled: boolean;
  connected: boolean;
  /** Other participants (excludes self). */
  peers: CollabPeer[];
  /** The shared text — only meaningful when enabled; null otherwise. */
  value: string | null;
  /** Push a local edit into the shared doc. No-op when disabled. */
  setValue: (next: string) => void;
}

export function useDocCollaboration(docId: string, opts: Options): DocCollaboration {
  const { userId, name, initialContent } = opts;
  const docRef = useRef<Y.Doc | null>(null);
  const textRef = useRef<Y.Text | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const localValueRef = useRef<string>(initialContent);

  const [enabled, setEnabled] = useState(false);
  const [connected, setConnected] = useState(false);
  const [peers, setPeers] = useState<CollabPeer[]>([]);
  const [value, setValueState] = useState<string | null>(null);

  // Keep the latest seed available to the synced handler without re-subscribing.
  const seedRef = useRef(initialContent);
  useEffect(() => {
    seedRef.current = initialContent;
  }, [initialContent]);

  useEffect(() => {
    if (!docId || !userId) return;
    const wsBase = getCollabWsUrl();
    if (!wsBase) {
      // Collaboration not configured for this environment — stay inert.
      return;
    }

    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('content');
    docRef.current = ydoc;
    textRef.current = ytext;
    setEnabled(true);

    const provider = new WebsocketProvider(wsBase, `knowledge:${docId}`, ydoc, { connect: true });
    providerRef.current = provider;

    provider.on('status', ({ status }: { status: string }) => setConnected(status === 'connected'));

    provider.on('sync', (isSynced: boolean) => {
      if (!isSynced) return;
      // First writer seeds the shared doc from the API content; later joiners
      // just adopt whatever the room already holds.
      if (ytext.length === 0 && seedRef.current) {
        ydoc.transact(() => ytext.insert(0, seedRef.current), 'seed');
      }
      const current = ytext.toString();
      localValueRef.current = current;
      setValueState(current);
    });

    const observer = (_e: Y.YTextEvent, tr: Y.Transaction) => {
      // Ignore our own local edits (already reflected in state).
      if (tr.origin === 'local') return;
      const current = ytext.toString();
      localValueRef.current = current;
      setValueState(current);
    };
    ytext.observe(observer);

    provider.awareness.setLocalState({ userId, name, color: colorFor(userId) });
    const onAwareness = () => {
      const states = Array.from(provider.awareness.getStates().entries());
      const self = provider.awareness.clientID;
      const list: CollabPeer[] = [];
      const seen = new Set<string>();
      for (const [clientId, state] of states) {
        if (clientId === self) continue;
        const s = state as Partial<CollabPeer>;
        if (!s.userId || seen.has(s.userId)) continue;
        seen.add(s.userId);
        list.push({ userId: s.userId, name: s.name ?? 'Teammate', color: s.color ?? '#888' });
      }
      setPeers(list);
    };
    provider.awareness.on('change', onAwareness);

    return () => {
      ytext.unobserve(observer);
      provider.awareness.off('change', onAwareness);
      provider.destroy();
      ydoc.destroy();
      docRef.current = null;
      textRef.current = null;
      providerRef.current = null;
      setEnabled(false);
      setConnected(false);
      setPeers([]);
      setValueState(null);
    };
    // name is intentionally not a dep — awareness updates would re-init the room.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, userId]);

  const setValue = useCallback((next: string) => {
    const ytext = textRef.current;
    const ydoc = docRef.current;
    if (!ytext || !ydoc) return;
    const prev = localValueRef.current;
    localValueRef.current = next;
    setValueState(next);
    ydoc.transact(() => applyTextDiff(ytext, prev, next), 'local');
  }, []);

  return { enabled, connected, peers, value, setValue };
}
