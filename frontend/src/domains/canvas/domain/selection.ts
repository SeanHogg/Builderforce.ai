/**
 * SELECTION — what somebody is holding on a `CanvasBoard`.
 *
 * A term the canvas context owns (`lib/canvas/boundedContexts.ts`), and
 * deliberately NOT part of the board: two people looking at one board have two
 * selections, so a selection is about a board rather than in it. That is also
 * why `selectionWithinBoard` lives here and not in the aggregate — the aggregate
 * cannot check an invariant about a value it does not hold.
 */

import { CANVAS_BOARD_INVARIANTS_BY_KEY } from '@/lib/canvas/boundedContexts';
import type { CanvasObject, CreationObjectKind } from './canvasObject';

/** The objects somebody has selected, by id. */
export type Selection = readonly string[];

/**
 * The selection, minus anything the board no longer holds.
 *
 * This is `selectionWithinBoard`, and the wording of that invariant is the whole
 * design: "in the same change, not on the next render". A deletion handler that
 * drops objects and leaves the selection for a later effect to tidy has a window
 * — one render — in which the inspector is asked to draw an object that is gone,
 * and the crash lands in the renderer rather than at the site of the mistake.
 */
export function selectionWithinBoard(selection: Selection, nodes: readonly CanvasObject[]): string[] {
  const present = new Set(nodes.map((node) => node.id));
  return selection.filter((id) => present.has(id));
}

/** Whether a selection already satisfies the invariant, for a test or an assert. */
export function selectionViolations(selection: Selection, nodes: readonly CanvasObject[]): string[] {
  const present = new Set(nodes.map((node) => node.id));
  return selection.filter((id) => !present.has(id)).map(
    (id) => `${CANVAS_BOARD_INVARIANTS_BY_KEY.selectionWithinBoard} (selection names ${id}, which the board does not hold)`,
  );
}

/**
 * Should acquiring an edit lock be attempted for what is selected?
 *
 * Four conditions, all of them necessary, which is exactly why they are one
 * function rather than four `&&`s at a call site: a local board has nothing to
 * lock, an unsaved object has no row to lock, a viewer must not take a lock they
 * cannot use, and nothing selected is nothing to lock.
 */
export function shouldAcquireCanvasObjectLock(
  persistence: 'local' | 'server',
  selectedId: string | null,
  canEdit: boolean,
  persistedObjectIds: ReadonlySet<string>,
): boolean {
  return persistence === 'server' && !!selectedId && canEdit && persistedObjectIds.has(selectedId);
}

/**
 * A follow-up about the selected object is an EDIT unless the user clearly asks
 * for another object.
 *
 * Returns the object to update, or nothing when the prompt genuinely asks for a
 * new one. This is also enforced at the tool boundary so a model that ignores
 * the prompt cannot silently duplicate a chart while claiming an update — two
 * enforcement points for one rule, which is tolerable only because they share
 * this single implementation.
 */
export function duplicateAddUpdateTarget(
  prompt: string,
  kind: CreationObjectKind,
  nodes: readonly CanvasObject[],
  selectedIds: Selection,
): CanvasObject | undefined {
  const selected = nodes.find((node) => selectedIds.includes(node.id) && node.data.kind === kind && node.data.kind !== 'chat');
  if (!selected) return undefined;
  const escapedKind = kind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('-', '[ -]');
  // The determiner run repeats (`*`, not `?`). English stacks them — "create A NEW
  // dashboard", "add ANOTHER NEW chart" — and matching only one meant the commonest
  // phrasing a person uses to ask for a second object fell through to the edit branch
  // and OVERWROTE the one they had selected. Found the moment this rule left the
  // component and got a test that did not have to mount a canvas to run.
  const explicitlyCreatesObject = new RegExp(`\\b(?:create|add|insert|duplicate|copy)\\s+(?:(?:a|an|another|new|additional|second|one|more|other)\\s+)*(?:analytical\\s+)?${escapedKind}\\b`, 'i').test(prompt)
    || /\b(?:another|new|additional|second)\s+(?:object|visual|widget|version)\b/i.test(prompt);
  return explicitlyCreatesObject ? undefined : selected;
}
