'use client';

import { useState, type DragEvent } from 'react';

/**
 * THE drag-to-reorder primitive for ordered lists — one implementation shared by every
 * surface where a tenant ranks things by dragging (BYO provider precedence, the OpenRouter
 * model cascade, the pinned-widget dashboard).
 *
 * Native HTML5 drag-and-drop, no new dependency. It deliberately does NOT replace the
 * ↑/↓ (or ◀/▶) nudge buttons a consumer renders alongside it: native drag has no keyboard
 * story and does not fire on touch, so the buttons stay the accessible and mobile path
 * while dragging is the fast path on a pointer device.
 *
 * Scope note — this is *reorder within one list*, not the reparent-style drags used by the
 * kanban board and the PMO tree (card → lane/zone), which move an item between containers
 * and persist a different thing.
 */

/** Move the item at `from` to index `to`, returning a NEW array (input untouched). Out-of-range
 *  or no-op moves return a plain copy, so a caller can commit the result unconditionally. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = items.slice();
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

export interface DragHandleProps {
  draggable: true;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
}

export interface DropTargetProps {
  onDragOver: (e: DragEvent) => void;
  onDragLeave: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
}

export interface DragReorder {
  /** Key of the row being dragged, or null. Consumers dim it. */
  draggingKey: string | null;
  /** Key of the row the pointer is currently over, never the dragged row itself.
   *  Consumers outline it as the insertion target. */
  dropKey: string | null;
  /** Spread onto whatever starts the drag — the whole row, or a grip inside it. */
  dragHandleProps: (key: string) => DragHandleProps;
  /** Spread onto the element that accepts a drop (normally the row). */
  dropTargetProps: (key: string) => DropTargetProps;
  /** Keyboard/button path: move `key` one slot in `dir`. No-op at the ends. */
  nudge: (key: string, dir: -1 | 1) => void;
}

/**
 * @param keys      current order, most-preferred first — the same array the consumer renders
 * @param onReorder commit callback, given the full new order (persist it; optimistic is fine)
 */
export function useDragReorder(keys: readonly string[], onReorder: (next: string[]) => void): DragReorder {
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const commit = (fromKey: string, toKey: string) => {
    const from = keys.indexOf(fromKey);
    const to = keys.indexOf(toKey);
    if (from < 0 || to < 0 || from === to) return;
    onReorder(moveItem(keys, from, to));
  };

  const clear = () => { setDraggingKey(null); setOverKey(null); };

  return {
    draggingKey,
    // A row is only a drop target for a DIFFERENT row; highlighting the dragged row itself
    // reads as "drop here" for a move that would change nothing.
    dropKey: overKey && overKey !== draggingKey ? overKey : null,
    dragHandleProps: (key) => ({
      draggable: true,
      onDragStart: (e: DragEvent) => {
        setDraggingKey(key);
        e.dataTransfer.effectAllowed = 'move';
        // Firefox starts no drag at all without payload on the transfer.
        e.dataTransfer.setData('text/plain', key);
      },
      onDragEnd: clear,
    }),
    dropTargetProps: (key) => ({
      onDragOver: (e: DragEvent) => {
        // Only claim drags that started in THIS list — preventDefault on anything else
        // would make an unrelated drag (a kanban card, a file) look droppable here.
        if (!draggingKey) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (overKey !== key) setOverKey(key);
      },
      onDragLeave: (e: DragEvent) => {
        // Moving onto a child fires dragleave on the row; ignore those or the outline flickers.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setOverKey((current) => (current === key ? null : current));
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        const fromKey = draggingKey ?? e.dataTransfer.getData('text/plain');
        if (fromKey) commit(fromKey, key);
        clear();
      },
    }),
    nudge: (key, dir) => {
      const from = keys.indexOf(key);
      if (from < 0) return;
      const to = from + dir;
      if (to < 0 || to >= keys.length) return;
      onReorder(moveItem(keys, from, to));
    },
  };
}
