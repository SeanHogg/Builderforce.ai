/*
 * No `'use client'` here on purpose — see the note at the top of `CanvasObjectSurface.tsx`.
 * Both consumers (the node body and the calendar surface) are already inside a client
 * boundary, so a directive would declare an entry point that does not exist.
 */
import { useCallback, useMemo } from 'react';
import type { CalendarEvent, CalendarView } from '@builderforce/creation-canvas-contract';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import { BoundCalendar } from '@/components/calendar/BoundCalendar';
import { sanitizeCalendarSourceId, type CalendarSourceContext, type CalendarSourceId } from '@/lib/calendar/calendarSources';
import type { CreationNodeData } from './types';

/**
 * A `calendar` OBJECT, drawn — the only place the canvas and the calendar primitive meet.
 *
 * ── WHY THIS ADAPTER EXISTS ──────────────────────────────────────────────────────
 * `BoundCalendar` knows about sources and events. The canvas knows about nodes, node
 * data and a board. Exactly one module should know both, and it is this one — twenty
 * lines that turn a node into a `CalendarSourceContext` and a patch back into node data.
 *
 * It is deliberately NOT wired from `CreationCanvas.tsx`. That file is the standing god
 * class in this codebase, and "assemble the calendar's eight props" is precisely the
 * kind of knowledge that put it there: a host that knows how a calendar reads is a host
 * that has to change every time a source is added. Both consumers hand this component a
 * node and a board and nothing else.
 *
 * ── ONE COMPONENT, TWO SIZES ─────────────────────────────────────────────────────
 * The ~340px card body and the full-screen surface are the same component with a
 * different `variant`. There is no second calendar to keep in step, which is what the
 * previous arrangement — a bespoke month grid inside a surface, and no card at all —
 * made impossible.
 */

export interface CalendarObjectBodyProps {
  /** The `calendar` object itself. */
  data: CreationNodeData;
  /** Every object on this board, for the `board` source. Absent off-canvas. */
  board?: readonly { id: string; data: CreationNodeData }[];
  /** Write back onto THIS card — the source, the grain, its own events. Absent = read-only. */
  onEdit?: (patch: Partial<CreationNodeData>) => void;
  /** Write back onto ANOTHER card — how the board source moves a dated object. */
  onEditObject?: (nodeId: string, patch: Partial<CreationNodeData>) => void;
  /** Send the reader to the card an event came from. */
  onOpenObject?: (nodeId: string) => void;
  variant?: 'card' | 'full';
  /** Injected "now", so a test can sit on a date boundary without mocking global time. */
  nowMs?: number;
}

export function CalendarObjectBody({
  data, board, onEdit, onEditObject, onOpenObject, variant = 'card', nowMs,
}: CalendarObjectBodyProps) {
  // Non-throwing on purpose: the canvas renders outside the authenticated shell (the
  // guest board, the embed surfaces), where there is no project picker above it. A
  // calendar there is workspace-wide rather than broken.
  const scope = useOptionalProjectScope();

  const sourceId = sanitizeCalendarSourceId(data.source);
  const defaultView = (typeof data.defaultView === 'string' ? data.defaultView : 'month') as CalendarView;

  const context = useMemo<CalendarSourceContext>(() => ({
    ownRows: data.events,
    ...(onEdit ? { writeOwnRows: (rows: readonly Record<string, unknown>[]) => onEdit({ events: [...rows] } as Partial<CreationNodeData>) } : {}),
    ...(board ? {
      board: board.map((node) => ({
        id: node.id,
        kind: node.data.kind,
        title: node.data.title ?? null,
        data: node.data as unknown as Record<string, unknown>,
      })),
    } : {}),
    ...(onEditObject ? {
      writeBoardObject: (nodeId: string, field: string, iso: string) =>
        onEditObject(nodeId, { [field]: iso } as Partial<CreationNodeData>),
    } : {}),
    projectId: scope?.currentProjectId ?? null,
  }), [board, data.events, onEdit, onEditObject, scope?.currentProjectId]);

  const openSource = useCallback((event: CalendarEvent) => {
    // Only the board source can be "opened" inside the canvas — everything else lives
    // on another surface, and its own `url` (when it has one) is the door.
    if (event.sourceId === 'board' && event.ref) onOpenObject?.(event.ref);
  }, [onOpenObject]);

  return (
    <BoundCalendar
      sourceId={sourceId}
      context={context}
      variant={variant}
      defaultView={defaultView}
      editable={Boolean(onEdit)}
      {...(nowMs !== undefined ? { nowMs } : {})}
      {...(onEdit ? {
        onSourceChange: (next: CalendarSourceId) => onEdit({ source: next } as Partial<CreationNodeData>),
        onViewChange: (next: CalendarView) => onEdit({ defaultView: next } as Partial<CreationNodeData>),
      } : {})}
      {...(onOpenObject ? { onOpenSource: openSource } : {})}
    />
  );
}
