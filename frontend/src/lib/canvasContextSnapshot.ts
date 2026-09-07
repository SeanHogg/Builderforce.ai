/**
 * What the Brain is allowed to believe about the board.
 *
 * THE BUG THIS EXISTS TO KILL. The snapshot sent with a turn contained only the
 * objects in the current SCOPE — with the Brain chat object selected, that is
 * one object. The model was never told the view was partial, so when asked about
 * a file that was sitting on the board a few hundred pixels away it answered:
 *
 *   "I don't see a file called Builderforce-Sales-Discovery-Guide.htm anywhere
 *    on the canvas. The only object present is a slides template."
 *
 * Both sentences were false, and the second is why the first was so convincing.
 * The model then offered to help once the user "uploads it" — asking someone to
 * re-do work they had already done, because the product could not see it.
 *
 * A scoped view is a fine thing to REASON over and a terrible thing to make
 * ABSENCE claims from. So every turn now carries two things beside the scoped
 * objects: a full inventory of the board (cheap — identity only), and a note
 * saying plainly that the detailed objects are a subset. "What is on this board"
 * and "what am I working on" stop being the same question.
 *
 * Pure, so the guarantee is unit-testable without a canvas.
 */

import type { CreationObjectKind } from '@builderforce/creation-canvas-contract';

/** Identity-only view of one object: enough to FIND it, not to reason about it. */
export interface CanvasInventoryEntry {
  id: string;
  kind: CreationObjectKind;
  title: string;
  /** The original file name, when the object came from an upload. */
  fileName?: string;
  /** False when this object's detail was left out of the scoped snapshot. */
  inScope: boolean;
}

interface InventoryNode {
  id: string;
  data: { kind: CreationObjectKind; title?: string; fileName?: unknown; path?: unknown };
}

/**
 * Every object on the board, flagged by whether its detail is in this turn.
 *
 * `fileName` is carried separately from `title` on purpose: an uploaded file is
 * looked for BY ITS FILE NAME, and several kinds title themselves something
 * friendlier than the file they came from. Matching only on title is a second
 * way to be told a file that exists is not there.
 */
export function boardInventory(
  nodes: readonly InventoryNode[],
  scopedIds: ReadonlySet<string>,
): CanvasInventoryEntry[] {
  return nodes.map((node) => {
    const fileName = typeof node.data.fileName === 'string' && node.data.fileName.trim()
      ? node.data.fileName
      : typeof node.data.path === 'string' && node.data.path.trim() ? node.data.path : undefined;
    return {
      id: node.id,
      kind: node.data.kind,
      title: node.data.title || '(untitled)',
      ...(fileName && fileName !== node.data.title ? { fileName } : {}),
      inScope: scopedIds.has(node.id),
    };
  });
}

/**
 * The sentence that stops the model guessing. Written as an instruction rather
 * than a statistic because "objects: 1 of 4" was already derivable from the
 * payload and did not prevent the false claim.
 */
export function scopeNote(scopeMode: string, total: number, scoped: number): string {
  if (scopeMode === 'canvas' || scoped >= total) {
    return `The detailed objects below are the COMPLETE board (${total} object${total === 1 ? '' : 's'}).`;
  }
  return [
    `PARTIAL VIEW: the detailed objects below are ${scoped} of ${total} objects on this board —`,
    'the user has scoped this turn to a selection.',
    'boardInventory lists EVERY object, including the ones whose detail was omitted.',
    'You therefore CANNOT conclude that something is missing from the canvas.',
    'If the user names a file or object you cannot see in detail, look it up in boardInventory by',
    'title or fileName; if it is there, read it with canvas_read_object instead of saying it is absent.',
    'Never tell the user to upload something the inventory already shows.',
  ].join(' ');
}

/** True when the inventory holds an object the user's phrasing plausibly names. */
export function findInInventory(inventory: readonly CanvasInventoryEntry[], needle: string): CanvasInventoryEntry | null {
  const query = needle.trim().toLowerCase();
  if (!query) return null;
  const candidates = inventory.map((entry) => ({
    entry,
    haystacks: [entry.title, entry.fileName].filter((value): value is string => typeof value === 'string').map((value) => value.toLowerCase()),
  }));
  // Exact, then extension-insensitive (`.htm` vs `.html` is the everyday miss),
  // then containment.
  const stem = (value: string) => value.replace(/\.[a-z0-9]{1,6}$/i, '');
  return candidates.find(({ haystacks }) => haystacks.includes(query))?.entry
    ?? candidates.find(({ haystacks }) => haystacks.some((value) => stem(value) === stem(query)))?.entry
    ?? candidates.find(({ haystacks }) => haystacks.some((value) => value.includes(query) || query.includes(value)))?.entry
    ?? null;
}
