/*
 * No `'use client'` here on purpose. This is imported only by `CreationCanvas.tsx`, which
 * already declares the boundary, so a directive would mark a second entry point that does
 * not exist — and `check-frontend-architecture` counts directives, not components.
 */
import { CanvasObjectSurface } from './CanvasObjectSurface';
import { CalendarObjectBody } from './CalendarObjectBody';
import type { CreationNodeData } from './types';

/**
 * ONE CALENDAR, AT FULL SIZE — the object-scoped surface a `calendar` card opens onto.
 *
 * ── WHAT CHANGED, AND WHY ────────────────────────────────────────────────────────
 * This used to be a BOARD surface: an entry in the canvas rail beside Chat, Board, 3D
 * and App, holding its own bespoke month grid, wired to exactly one reading — the dated
 * objects on this canvas — with no detail panel, no week or day grain, and no way to
 * write anything except by dragging a pill to another cell.
 *
 * The argument for that placement was that a month is "about every card at once, so
 * there is no card to enter it from". It was true of that ONE reading and it quietly
 * made that reading the only one possible. A rail entry is a MODE: a person cannot have
 * two, cannot put one beside another, and cannot point one at the meetings, releases,
 * tasks, holidays or connected accounts whose dates already existed elsewhere in this
 * product and were undrawable.
 *
 * So the reading became a value on a `calendar` object and this became the surface that
 * object opens at full size — the same promotion `page`, `play`, `site` and `timeline`
 * each got, for the identical reason: a month with an hour grid and a detail panel does
 * not fit in a ~340px card, and the card previews it.
 *
 * ── WHY THIS FILE IS NOW SIX LINES OF BODY ───────────────────────────────────────
 * Everything it used to do belongs to something reusable: the grid to
 * `components/calendar/Calendar.tsx`, the reading to `calendarSources.ts`, and the
 * canvas-to-calendar translation to `CalendarObjectBody`. What is left is the only
 * thing that is genuinely about being a SURFACE — the chrome that says which object you
 * are in and how to get back — and that is `CanvasObjectSurface`, shared with the other
 * five. A surface that still owned a grid would be the second calendar in the codebase
 * the day anybody put one on a page.
 */

export interface CanvasCalendarSurfaceProps {
  /** The `calendar` object this surface is about. */
  data: CreationNodeData;
  /** Every object on the board, for a calendar bound to the `board` source. */
  nodes: readonly { id: string; data: CreationNodeData }[];
  /** Hand the board back. Also what Escape means, via the shared chrome. */
  onExit: () => void;
  /** Edit THIS calendar — its source, its grain, its own events. Absent on a read-only board. */
  onEdit?: (patch: Partial<CreationNodeData>) => void;
  /** Move a dated object the `board` source projected, by writing its own field. */
  onEditObject?: (nodeId: string, patch: Partial<CreationNodeData>) => void;
  /** Send the reader to the card an event came from. */
  onOpenObject?: (nodeId: string) => void;
}

export function CanvasCalendarSurface({
  data, nodes, onExit, onEdit, onEditObject, onOpenObject,
}: CanvasCalendarSurfaceProps) {
  return (
    <CanvasObjectSurface surface="calendar" data={data} onExit={onExit}>
      <CalendarObjectBody
        data={data}
        board={nodes}
        variant="full"
        {...(onEdit ? { onEdit } : {})}
        {...(onEditObject ? { onEditObject } : {})}
        {...(onOpenObject ? { onOpenObject } : {})}
      />
    </CanvasObjectSurface>
  );
}
