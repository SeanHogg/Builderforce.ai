import { useMemo } from 'react';
import { useStore } from '@xyflow/react';
import type { CreationNodeData, CreationObjectKind } from '../types';
import { EMPTY_SPEC_BOARD, makeSpecDeriveBoard, specKindReadsBoard, type SpecDeriveBoard } from '@/lib/specObjects';
import { frameMemberIds, type FrameBox } from '@/domains/canvas/domain/canvasFrame';

/*
 * The card's subscriptions to the React Flow store. Each one selects only what its
 * card needs, and the ones that scan the whole board are GATED — a stable empty value
 * for every card that does not read it — because an ungated subscription to every
 * node re-renders the whole board on every keystroke.
 */

/**
 * The size the USER gave this Object — a resize drag, or an authored width and
 * height — and nothing else.
 *
 * React Flow hands a custom node its MEASURED width and height. Writing those
 * straight back onto the card is a latch: the card can then only ever be the
 * size it happened to be measured at, because that measurement is what pins it.
 * The Brain Object made this visible — it is a 74px mark while the conversation
 * is docked and a 390px chat inline, so the first placement it rendered in froze
 * the other one into a sliver, and every edge into it stayed anchored to the box
 * that sliver reported. Any card whose content grows after it first rendered had
 * the quieter version of the same bug: it kept the old height and scrolled.
 *
 * An authored size is different — React Flow already puts it on the node wrapper,
 * so passing it down here just lets the card fill the box the user dragged.
 */
export function useAuthoredNodeSize(id: string): { width?: number; height?: number } {
  // Packed into a string so the store subscription compares by value: returning a
  // fresh object from the selector would re-render this node on every store tick.
  const authored = useStore((state) => {
    const node = state.nodeLookup.get(id);
    if (!node) return '';
    const width = node.width ?? (typeof node.style?.width === 'number' ? node.style.width : undefined);
    const height = node.height ?? (typeof node.style?.height === 'number' ? node.style.height : undefined);
    return `${width ?? ''}:${height ?? ''}`;
  });
  return useMemo(() => {
    const [width, height] = authored.split(':');
    return {
      ...(width ? { width: Number(width) } : {}),
      ...(height ? { height: Number(height) } : {}),
    };
  }, [authored]);
}

/**
 * The neighbours a CROSS-OBJECT derivation reads — a gradebook's mean over the
 * submissions beside it, a submission's lateness against its assignment's deadline.
 *
 * ── WHY THIS IS GATED, AND HOW ──────────────────────────────────────────────────
 * Subscribing every card to every other card's data would re-render the whole board on
 * every keystroke, which is the fan-out the platform rejects in a request handler and is
 * no more acceptable here. So the selector returns a STABLE EMPTY ARRAY for any kind
 * whose spec declares no board-reading derivation — the overwhelming majority — and
 * those nodes never re-render for a neighbour's change at all.
 *
 * For the kinds that do read it, the comparison is per-element REFERENCE equality rather
 * than a serialisation: React Flow replaces a node's `data` object when it changes, so
 * identity is exactly the signal, and an O(N) reference scan is cheap where a
 * `JSON.stringify` of two hundred submissions on every store tick is not.
 */
const NO_NEIGHBOURS: readonly CreationNodeData[] = [];

export function useBoardNeighbours(reads: boolean): readonly CreationNodeData[] {
  return useStore(
    (state) => {
      if (!reads) return NO_NEIGHBOURS;
      const out: CreationNodeData[] = [];
      for (const node of state.nodeLookup.values()) out.push(node.data as CreationNodeData);
      return out;
    },
    (left, right) => left === right || (left.length === right.length && left.every((item, index) => item === right[index])),
  );
}

/**
 * The board as a list of {id, data} — what a `calendar` card bound to the `board` source
 * projects into events.
 *
 * Gated exactly like {@link useBoardNeighbours} above and for the same reason: this is a
 * subscription to every node on the canvas, so a card that is not a board-bound calendar
 * must never take it. `enabled` is false for every other kind and for a calendar reading
 * any other source, and the stable empty array is what keeps those nodes out of the
 * re-render entirely.
 */
const NO_BOARD_OBJECTS: readonly { id: string; data: CreationNodeData }[] = [];

export function useCalendarBoardObjects(enabled: boolean): readonly { id: string; data: CreationNodeData }[] {
  return useStore(
    (state) => {
      if (!enabled) return NO_BOARD_OBJECTS;
      const out: { id: string; data: CreationNodeData }[] = [];
      for (const node of state.nodeLookup.values()) out.push({ id: node.id, data: node.data as CreationNodeData });
      return out;
    },
    (left, right) => left === right
      || (left.length === right.length && left.every((item, index) => item.id === right[index]!.id && item.data === right[index]!.data)),
  );
}

/**
 * How many objects a frame currently holds.
 *
 * Gated exactly like {@link useBoardNeighbours} and {@link useCalendarBoardObjects}, and
 * for the same reason — this is a subscription to every node on the board, so every
 * card that is not a frame must never take it. It returns a NUMBER rather than the ids,
 * which is what keeps the comparison a primitive one: a frame re-renders when its count
 * changes and not when anything inside it is edited.
 *
 * A collapsed frame is measured at the size it was BEFORE it was put away
 * (`frameExpandedWidth/Height`). Measuring the chip instead would find nothing inside
 * it, and the count would read zero for exactly the state where it is the only thing
 * the card can say.
 */
export function useFrameMemberCount(id: string, enabled: boolean): number {
  return useStore((state) => {
    if (!enabled) return 0;
    const boxes: FrameBox[] = [];
    for (const node of state.nodeLookup.values()) {
      // A store entry mid-transition (and a test double) can be missing `data`
      // entirely. A card that throws while COUNTING what a frame holds would take
      // the whole board down over a number, so an unreadable entry is simply not a
      // member — the count is a reading, not an invariant.
      const data = (node.data ?? {}) as CreationNodeData;
      if (typeof data.kind !== 'string') continue;
      const collapsed = data.kind === 'frame' && data.frameCollapsed === true;
      const expandedWidth = Number(data.frameExpandedWidth);
      const expandedHeight = Number(data.frameExpandedHeight);
      boxes.push({
        id: node.id,
        kind: data.kind,
        position: node.position,
        size: {
          width: collapsed && expandedWidth > 0 ? expandedWidth : (node.measured?.width ?? node.width ?? 260),
          height: collapsed && expandedHeight > 0 ? expandedHeight : (node.measured?.height ?? node.height ?? 150),
        },
        data: data as unknown as Record<string, unknown>,
      });
    }
    return frameMemberIds(id, boxes).length;
  });
}

export function useSpecDeriveBoard(kind: CreationObjectKind): SpecDeriveBoard {
  const neighbours = useBoardNeighbours(specKindReadsBoard(kind));
  return useMemo(
    () => (neighbours.length ? makeSpecDeriveBoard(neighbours as unknown as Record<string, unknown>[]) : EMPTY_SPEC_BOARD),
    [neighbours],
  );
}
