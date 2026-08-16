/**
 * The coloured circles on the command bar — the fast way onto a board.
 *
 * ── WHY A SHORTLIST AND NOT THE WHOLE PALETTE ────────────────────────────────────
 * The object palette carries sixteen groups, which is the right answer for a panel you
 * open when you know what you want and the wrong answer for a bar. A bar can hold about
 * six targets before it stops being scannable, and a row of sixteen identical circles is
 * a colour wheel rather than a menu.
 *
 * So this is a SHORTLIST that points INTO the palette rather than a second catalogue
 * beside it. Every entry names a real `CreationObjectGroup`; pressing one opens the
 * palette focused on that group. There is no second source of truth about which objects
 * exist, which is the failure that a hand-written bar menu would have created the first
 * time a kind was added to the registry and not to the bar.
 *
 * The last entry deliberately names no group: it is the door to the whole palette, so the
 * shortlist can never become the only way in. A group that is not on this list is one
 * press further away, not unreachable.
 *
 * ── WHY THE HUE IS DECLARED HERE ─────────────────────────────────────────────────
 * A circle with no glyph inside it is identified by colour alone, so the colour is load
 * bearing rather than decorative — and the board already declares its own palette
 * (`--canvas-series-*`) precisely so that a second copy of the hues cannot drift from it.
 * These reference those tokens by name; nothing here is a literal.
 */

import type { CreationObjectGroup } from '@/components/creation-canvas/creationObjectRegistry';

export interface CanvasQuickAddEntry {
  id: string;
  /**
   * The palette group this circle opens. Absent on the one entry that opens the palette
   * whole — "everything else" is a destination, not a group.
   */
  group?: CreationObjectGroup;
  /** A board palette token, referenced by name so the board stays the one declaration. */
  tokenVar: string;
  /** Catalog key under `creationCanvas.quickAdd`. */
  labelKey: string;
}

export const CANVAS_QUICK_ADD: readonly CanvasQuickAddEntry[] = [
  // Build first, because the overwhelming majority of first objects on a canvas are a
  // page, a code file or a website — the things this canvas exists to make.
  { id: 'build', group: 'Build', tokenVar: '--canvas-series-1', labelKey: 'build' },
  { id: 'data', group: 'Data', tokenVar: '--canvas-series-2', labelKey: 'data' },
  { id: 'work', group: 'Work', tokenVar: '--canvas-series-4', labelKey: 'work' },
  { id: 'agents', group: 'Agents', tokenVar: '--canvas-series-3', labelKey: 'agents' },
  { id: 'people', group: 'People', tokenVar: '--canvas-series-5', labelKey: 'people' },
  { id: 'all', tokenVar: '--canvas-accent', labelKey: 'all' },
];
