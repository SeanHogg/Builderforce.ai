import { emptyBlock, type BlockAttrs, type DocumentBlock } from './blockDocument';

/**
 * THE BLOCK LIST, BEHIND ONE CONTRACT — so the editor has exactly one code path.
 *
 * A block editor that is a different component when a room is available is two
 * editors, and the offline one is the one nobody tests. The verbs below are
 * everything the editor does; a local array satisfies them, and so does a Yjs
 * document. The editor never learns which it got.
 *
 * ── WHY IT IS A SUBSCRIBE/SNAPSHOT STORE AND NOT REACT STATE ─────────────────
 * The CRDT implementation is driven by events from a WebSocket, not by React, so
 * the source of truth cannot be a `useState`. `useSyncExternalStore` is the
 * supported way to read one of those without tearing during a concurrent render —
 * which is not theoretical here: a remote update can land between React reading
 * one component and the next.
 *
 * The contract that makes it work is that {@link BlockStore.snapshot} returns the
 * SAME array until something actually changes. Both implementations cache it.
 */
export interface BlockStore {
  /** The current blocks. Referentially stable until a mutation or a remote update. */
  snapshot(): readonly DocumentBlock[];
  /** Register for change notifications. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Replace a text block's markdown. Applied as an EDIT, never a whole-value write. */
  setText(id: string, text: string): void;
  /** Replace a media block's attributes. */
  setAttrs(id: string, attrs: BlockAttrs): void;
  /** Insert after `afterId`, or at the top when it is null. Returns the new id. */
  insertAfter(afterId: string | null, block: DocumentBlock): string;
  /** Remove a block. A document is never left with none — the last one is emptied
   *  instead, because a document with no blocks has nowhere to put the caret. */
  remove(id: string): void;
  /** Move a block by `delta` positions, clamped to the document. */
  move(id: string, delta: number): void;
  /** Release anything the store holds. Safe to call twice. */
  destroy(): void;
}

/** Where a block sits, or -1. */
export function indexOfBlock(blocks: readonly DocumentBlock[], id: string): number {
  return blocks.findIndex((block) => block.id === id);
}

/**
 * The destination for a move, clamped.
 *
 * Extracted because both implementations need the same answer and "clamped" has
 * two off-by-one traps in it: the last index is `length - 1`, and a no-op move
 * must be recognised as one so the CRDT does not emit a delete+insert pair that
 * every peer has to apply for nothing.
 */
export function moveTarget(blocks: readonly DocumentBlock[], id: string, delta: number): { from: number; to: number } | null {
  const from = indexOfBlock(blocks, id);
  if (from < 0) return null;
  const to = Math.max(0, Math.min(blocks.length - 1, from + delta));
  return to === from ? null : { from, to };
}

/**
 * The offline implementation: a plain array.
 *
 * This is what runs when there is no room — no session yet, a self-hosted
 * deployment with no Durable Object binding, a WebSocket a corporate proxy will
 * not open. Editing keeps working and autosave keeps saving; the only thing
 * missing is other people.
 */
export function createLocalBlockStore(initial: readonly DocumentBlock[]): BlockStore {
  let blocks: DocumentBlock[] = initial.length > 0 ? [...initial] : [emptyBlock()];
  const listeners = new Set<() => void>();

  const commit = (next: DocumentBlock[]) => {
    blocks = next;
    for (const listener of listeners) listener();
  };

  const replace = (id: string, change: (block: DocumentBlock) => DocumentBlock) => {
    const index = indexOfBlock(blocks, id);
    if (index < 0) return;
    const next = [...blocks];
    next[index] = change(blocks[index]!);
    commit(next);
  };

  return {
    snapshot: () => blocks,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setText(id, text) {
      replace(id, (block) => (block.text === text ? block : { ...block, text }));
    },
    setAttrs(id, attrs) {
      replace(id, (block) => ({ ...block, attrs: { ...block.attrs, ...attrs } }));
    },
    insertAfter(afterId, block) {
      const index = afterId === null ? -1 : indexOfBlock(blocks, afterId);
      const next = [...blocks];
      next.splice(index + 1, 0, block);
      commit(next);
      return block.id;
    },
    remove(id) {
      const index = indexOfBlock(blocks, id);
      if (index < 0) return;
      if (blocks.length === 1) { commit([emptyBlock()]); return; }
      const next = [...blocks];
      next.splice(index, 1);
      commit(next);
    },
    move(id, delta) {
      const target = moveTarget(blocks, id, delta);
      if (!target) return;
      const next = [...blocks];
      const [moved] = next.splice(target.from, 1);
      next.splice(target.to, 0, moved!);
      commit(next);
    },
    destroy() {
      listeners.clear();
    },
  };
}
