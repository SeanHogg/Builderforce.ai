'use client';

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import type { DocumentBlock } from '../domain/blockDocument';
import { parseMarkdownToBlocks, blocksToMarkdown, emptyBlock } from '../domain/blockDocument';
import { shouldSeed } from '../domain/seedTiebreak';
import { createLocalBlockStore } from '../domain/blockStore';
import { seedBlocks, createCrdtBlockStore, blocksArray } from '../infrastructure/crdtBlockStore';
import {
  collabColorFor,
  collabParams,
  collabRoom,
  collabSocketBase,
  type CollabScope,
} from '../infrastructure/collabTransport';

/** One participant, and which block they are in — the unit of a block-level cursor. */
export interface BlockPeer {
  userId: string;
  name: string;
  color: string;
  /** The block this participant last edited or focused, or null before they have. */
  blockId: string | null;
}

/** Rendered only in the window before either block store exists — one frame at
 *  mount, before the effect below picks local or CRDT. Frozen and module-scope
 *  so it is the SAME reference on every call; see the getSnapshot comment below
 *  for why that matters. */
const PLACEHOLDER_BLOCKS: readonly DocumentBlock[] = Object.freeze([emptyBlock()]);

export interface BlockDocument {
  /** True once a room is open — false offline, or before a session token exists. */
  enabled: boolean;
  connected: boolean;
  blocks: readonly DocumentBlock[];
  /** Other participants and which block each is in. Excludes self. */
  peers: readonly BlockPeer[];
  setText: (id: string, text: string) => void;
  setAttrs: (id: string, attrs: DocumentBlock['attrs']) => void;
  insertAfter: (afterId: string | null, block: DocumentBlock) => string;
  remove: (id: string) => void;
  move: (id: string, delta: number) => void;
  /** Replace the whole document — AI assist replacing a draft, a template applied. */
  replaceAll: (blocks: readonly DocumentBlock[]) => void;
  /** Tell peers which block has this client's focus. Cheap — call on focus/click,
   *  not per keystroke; a block-level cursor does not need finer resolution. */
  setFocusedBlock: (id: string | null) => void;
  /** The document as markdown — the ONE thing every other reader consumes. */
  markdown: string;
}

/**
 * A CO-EDITED DOCUMENT, PER BLOCK.
 *
 * Replaces the single `Y.Text('content')` channel that made document-scale
 * collaboration doc-level: every remote keystroke re-rendered the whole editor,
 * and presence could say no more than "somebody is in this document". Here the
 * shared type is `Y.Array<Y.Map>` (see `infrastructure/crdtBlockStore.ts`) — a
 * block is the unit that syncs, the unit a cursor belongs to, and the unit a
 * media upload replaces.
 *
 * Falls back to a local, uncollaborated block store whenever there is no room to
 * join — no session token yet, no API origin — so the editor never has two code
 * paths: {@link BlockDocument} is satisfied by both, and only `enabled` differs.
 */
export function useBlockDocument(
  scope: CollabScope,
  docId: string,
  opts: {
    userId: string;
    name: string;
    initialContent: string;
    /** Gates the setup effect below. Default true — a caller that only ever
     *  mounts this hook once its content has genuinely loaded (the ordinary
     *  case) does not need to think about it.
     *
     *  A caller that mounts EARLIER — before an async fetch resolves — must
     *  pass `false` until it does. Without this, the OFFLINE fallback store
     *  would be built from whatever `initialContent` happened to be at the
     *  first render (usually `''`, since hooks cannot follow a component's
     *  early return while data loads) and never rebuilt, so the real document
     *  would simply never appear. The room path does not have this problem —
     *  seeding waits for the sync handshake, by which point the fetch has
     *  almost always already resolved — but the offline path has no such
     *  signal of its own, which is why this flag exists at all. */
    ready?: boolean;
  },
): BlockDocument {
  const { userId, name, initialContent, ready = true } = opts;

  const docRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const localStoreRef = useRef<ReturnType<typeof createLocalBlockStore> | null>(null);
  const enabledRef = useRef(false);
  const connectedRef = useRef(false);
  const peersRef = useRef<readonly BlockPeer[]>([]);

  // Keep the latest seed available to the sync handler without re-subscribing —
  // an initialContent that arrives after the room is already open (a slow API
  // response racing a fast socket) must still be seedable.
  const seedRef = useRef(initialContent);
  useEffect(() => { seedRef.current = initialContent; }, [initialContent]);

  const snapshotListenersRef = useRef(new Set<() => void>());
  const notify = useCallback(() => {
    for (const listener of snapshotListenersRef.current) listener();
  }, []);

  const subscribe = useCallback((listener: () => void) => {
    snapshotListenersRef.current.add(listener);
    return () => { snapshotListenersRef.current.delete(listener); };
  }, []);

  // `useSyncExternalStore` needs a getSnapshot that is referentially stable
  // until something changes; both block stores already guarantee that (see
  // `blockStore.ts`), so this just reads whichever is currently active.
  const crdtStoreRef = useRef<ReturnType<typeof createCrdtBlockStore> | null>(null);
  // A stable placeholder for the window before the effect below has created
  // either store — module-scope, not a fresh array literal per call, because
  // `useSyncExternalStore` requires getSnapshot to return the SAME reference
  // until something actually changes, and a `?? [x]` fallback would mint a new
  // one on every render and read as an infinite loop.
  const getBlocksSnapshot = useCallback((): readonly DocumentBlock[] => {
    const store = docRef.current ? crdtStoreRef.current : localStoreRef.current;
    return store?.snapshot() ?? PLACEHOLDER_BLOCKS;
  }, []);

  const blocks = useSyncExternalStore(subscribe, getBlocksSnapshot, getBlocksSnapshot);
  const enabled = useSyncExternalStore(subscribe, () => enabledRef.current, () => false);
  const connected = useSyncExternalStore(subscribe, () => connectedRef.current, () => false);
  const peers = useSyncExternalStore(subscribe, () => peersRef.current, () => []);

  useEffect(() => {
    if (!docId || !userId || !ready) return;
    // Start local so there is always something to render while a room connects
    // (or forever, when one never opens).
    localStoreRef.current = createLocalBlockStore(parseMarkdownToBlocks(initialContent));
    const offLocal = localStoreRef.current.subscribe(notify);

    const wsBase = collabSocketBase();
    const params = collabParams({ name, color: collabColorFor(userId) });
    if (!wsBase || !params) { notify(); return () => offLocal(); }

    const ydoc = new Y.Doc();
    docRef.current = ydoc;
    const crdtStore = createCrdtBlockStore(ydoc, 'local');
    crdtStoreRef.current = crdtStore;
    const offCrdt = crdtStore.subscribe(notify);

    const provider = new WebsocketProvider(wsBase, collabRoom(scope, docId), ydoc, { connect: true, params });
    providerRef.current = provider;
    enabledRef.current = true;

    let seeded = false;
    const trySeed = () => {
      if (seeded) return;
      const peerIds = Array.from(provider.awareness.getStates().values())
        .map((state) => (state as Partial<BlockPeer>).userId)
        .filter((id): id is string => !!id && id !== userId);
      if (shouldSeed(userId, peerIds, blocksArray(ydoc).length === 0, !!seedRef.current)) {
        seedBlocks(ydoc, parseMarkdownToBlocks(seedRef.current));
        seeded = true;
      }
    };

    provider.on('sync', (isSynced: boolean) => { if (isSynced) trySeed(); });
    provider.on('status', ({ status }: { status: string }) => {
      connectedRef.current = status === 'connected';
      notify();
    });

    provider.awareness.setLocalState({ userId, name, color: collabColorFor(userId), blockId: null });
    const onAwareness = () => {
      const self = provider.awareness.clientID;
      const seen = new Set<string>();
      const list: BlockPeer[] = [];
      for (const [clientId, state] of provider.awareness.getStates()) {
        if (clientId === self) continue;
        const peer = state as Partial<BlockPeer>;
        if (!peer.userId || seen.has(peer.userId)) continue;
        seen.add(peer.userId);
        list.push({
          userId: peer.userId,
          name: peer.name ?? 'Teammate',
          color: peer.color ?? 'var(--text-muted)',
          blockId: peer.blockId ?? null,
        });
      }
      peersRef.current = list;
      notify();
    };
    provider.awareness.on('change', onAwareness);

    return () => {
      offLocal();
      offCrdt();
      provider.awareness.off('change', onAwareness);
      provider.destroy();
      ydoc.destroy();
      crdtStore.destroy();
      docRef.current = null;
      providerRef.current = null;
      crdtStoreRef.current = null;
      enabledRef.current = false;
      connectedRef.current = false;
      peersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, userId, scope, notify, ready]);

  const activeStore = () => crdtStoreRef.current ?? localStoreRef.current;

  const setFocusedBlock = useCallback((id: string | null) => {
    const provider = providerRef.current;
    if (!provider) return;
    provider.awareness.setLocalState({ ...provider.awareness.getLocalState(), userId, name, blockId: id });
  }, [userId, name]);

  return useMemo<BlockDocument>(() => ({
    enabled,
    connected,
    blocks,
    peers,
    setText: (id, text) => activeStore()?.setText(id, text),
    setAttrs: (id, attrs) => activeStore()?.setAttrs(id, attrs),
    insertAfter: (afterId, block) => activeStore()?.insertAfter(afterId, block) ?? block.id,
    remove: (id) => activeStore()?.remove(id),
    move: (id, delta) => activeStore()?.move(id, delta),
    replaceAll: (next) => activeStore()?.replaceAll(next),
    setFocusedBlock,
    markdown: blocksToMarkdown(blocks),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [enabled, connected, blocks, peers, setFocusedBlock]);
}
