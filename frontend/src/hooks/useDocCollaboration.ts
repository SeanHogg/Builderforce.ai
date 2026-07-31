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

/**
 * Decide whether THIS client should seed the shared doc from the API content.
 *
 * The CollaborationRoom worker is a dumb binary relay (no server-authoritative
 * doc), so there is no single source to seed from. We seed only when the shared
 * text is still empty after connecting, and break ties deterministically: among
 * all known participants (self + awareness peers), only the smallest userId
 * seeds — so two clients opening a fresh doc simultaneously never double-insert.
 * A lone first editor has no peers and therefore always seeds.
 */
export function shouldSeed(
  selfUserId: string,
  peerUserIds: string[],
  ytextEmpty: boolean,
  hasInitialContent: boolean,
): boolean {
  if (!ytextEmpty || !hasInitialContent) return false;
  const everyone = [selfUserId, ...peerUserIds];
  const min = everyone.reduce((a, b) => (b < a ? b : a), selfUserId);
  return min === selfUserId;
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

    // Seed the room from the API content once. Deterministic tiebreak
    // ({@link shouldSeed}) prevents two simultaneous first-editors double-seeding
    // each other; `seeded` makes seeding idempotent within this client.
    let seedTimer: ReturnType<typeof setTimeout> | null = null;
    let seeded = false;
    const adopt = () => {
      const current = ytext.toString();
      localValueRef.current = current;
      setValueState(current);
    };
    const trySeed = () => {
      if (seeded) {
        adopt();
        return;
      }
      const peerIds = Array.from(provider.awareness.getStates().values())
        .map((s) => (s as Partial<CollabPeer>).userId)
        .filter((u): u is string => !!u && u !== userId);
      if (shouldSeed(userId, peerIds, ytext.length === 0, !!seedRef.current)) {
        ydoc.transact(() => ytext.insert(0, seedRef.current), 'seed');
        seeded = true;
      }
      adopt();
    };

    // Authoritative path: the y-websocket sync handshake completed, so `ytext`
    // now mirrors the server/peer doc. Seeding here can never double-insert — if
    // the doc already has content the emptiness check skips it; if it is empty we
    // are the deterministic origin. With a server-authoritative CollaborationRoom
    // this always fires and is the ONLY path that seeds.
    provider.on('sync', (isSynced: boolean) => {
      if (isSynced) trySeed();
    });
    provider.on('status', ({ status }: { status: string }) => {
      const isConnected = status === 'connected';
      setConnected(isConnected);
      // Fallback for the legacy dumb-relay DO whose sync handshake never
      // completes for a lone editor (no server doc to answer sync step 1). Seed
      // after a settle window — but ONLY if the network has not already synced
      // authoritative content in. Gating on `provider.synced` closes the
      // seed-then-sync double-insert: once a real sync lands we adopt, never seed.
      if (isConnected && seedTimer == null) {
        seedTimer = setTimeout(() => {
          if (provider.synced) adopt();
          else trySeed();
        }, 600);
      }
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
      if (seedTimer != null) clearTimeout(seedTimer);
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
