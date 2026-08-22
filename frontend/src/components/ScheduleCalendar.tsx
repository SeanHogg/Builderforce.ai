'use client';

import { useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { CalendarEvent, UndatedEntry } from '@builderforce/creation-canvas-contract';
import type { CalendarEventDraft } from '@/lib/calendar/calendarSources';
import {
  DEADLINE_COLORS,
  daysBetween,
  getSchedule,
  parseDate,
  shiftSchedule,
  startOfDay,
  type ReschedulePatch,
  type Schedulable,
} from '@/lib/schedule';
import { Calendar } from '@/components/calendar/Calendar';
import { ScheduleLegend } from './ScheduleLegend';

/**
 * The delivery month — projects and tasks as spans, on THE calendar.
 *
 * ── WHY THIS IS 90 LINES AND NOT 450 ─────────────────────────────────────────────
 * It used to draw its own month: its own six-week grid, its own greedy lane packing,
 * its own `+N more`, its own drag handling, its own weekday header and its own day
 * cells — all of it inline style, none of it reachable from anywhere else. When the
 * canvas calendar became a reusable component, this became the second implementation of
 * the same grid in one codebase, and `MeetingsCalendar` was the third.
 *
 * There is one now. This file is what is genuinely SPECIFIC to delivery, and nothing
 * else:
 *   • a `Schedulable` (start + due) is a span, and an item with only a deadline is a
 *     one-day span — so the month answers "what is in flight on the 14th" and not only
 *     "what lands on it";
 *   • the stripe colour is the DEADLINE STATUS (`DEADLINE_COLORS`), which is this
 *     domain's rule and not a category hash;
 *   • the optional health dot rides alongside as the entry's `accent`;
 *   • a drag means {@link shiftSchedule}, the one rule both this and the Gantt obey, so
 *     a move made here and a move made there write the same patch.
 *
 * Everything above — grid, lanes, overflow, drag targets, the undated footer, both
 * themes, the narrow viewport — belongs to `components/calendar/Calendar.tsx`.
 */
interface ScheduleCalendarProps<T extends Schedulable & { id: string | number }> {
  items: T[];
  /** Human label for an item (e.g. project name, task title). */
  getLabel: (item: T) => string;
  onSelect: (item: T) => void;
  /**
   * Optional health/status accent, drawn as a dot beside the label so the calendar
   * carries the same at-a-glance signal as the card and list views. It is a SECOND
   * signal, not the stripe: the stripe already says whether the item is late.
   */
  getAccentColor?: (item: T) => string | undefined;
  /** Persist a dragged span's new dates. Omit for a read-only calendar. */
  onReschedule?: (item: T, patch: ReschedulePatch) => void;
}

export function ScheduleCalendar<T extends Schedulable & { id: string | number }>({
  items,
  getLabel,
  onSelect,
  getAccentColor,
  onReschedule,
}: ScheduleCalendarProps<T>) {
  const t = useTranslations('schedule');
  // Read once, not per render: it decides every item's deadline status and is a
  // dependency of the projection below.
  const today = useMemo(() => startOfDay(new Date()), []);
  const byId = useMemo(() => new Map(items.map((item) => [String(item.id), item])), [items]);

  const events = useMemo<readonly CalendarEvent[]>(() => items.flatMap((item) => {
    const schedule = getSchedule(item, today);
    if (!schedule.start || !schedule.end) return [];
    const accent = getAccentColor?.(item);
    return [{
      id: String(item.id),
      ref: String(item.id),
      subject: getLabel(item),
      // Calendar dates, not instants: a deadline is a DAY, and rendering it as an
      // instant makes it move for a reader in another timezone.
      startISO: schedule.start.toISOString().slice(0, 10),
      endISO: schedule.end.toISOString().slice(0, 10),
      allDay: true,
      color: DEADLINE_COLORS[schedule.status],
      ...(accent ? { accent } : {}),
    }];
  }), [items, today, getLabel, getAccentColor]);

  const undated = useMemo<readonly UndatedEntry[]>(() => items
    .filter((item) => !parseDate(item.dueDate) && !parseDate(item.startDate))
    .map((item) => {
      const accent = getAccentColor?.(item);
      return { id: String(item.id), subject: getLabel(item), ...(accent ? { accent } : {}) };
    }), [items, getLabel, getAccentColor]);

  const select = useCallback((id: string) => {
    const item = byId.get(id);
    if (item) onSelect(item);
  }, [byId, onSelect]);

  /**
   * A drop on another day is a MOVE of the whole window.
   *
   * The calendar hands back where the span now starts; `shiftSchedule` decides what that
   * means — including the cases that matter and are easy to get wrong separately: an item
   * with only a due date keeps its start null rather than having one invented for it, and
   * a no-op returns null so no write is issued at all.
   */
  const reschedule = useCallback((event: CalendarEvent, patch: CalendarEventDraft) => {
    const item = byId.get(event.id);
    if (!item || !onReschedule) return;
    const schedule = getSchedule(item, today);
    const from = schedule.start ?? schedule.end;
    if (!from) return;
    const delta = daysBetween(startOfDay(from), startOfDay(new Date(`${patch.startISO.slice(0, 10)}T00:00`)));
    const next = shiftSchedule(item, 'move', delta);
    if (next) onReschedule(item, next);
  }, [byId, onReschedule, today]);

  return (
    <Calendar
      events={events}
      variant="full"
      undated={undated}
      onSelectUndated={select}
      onSelectEvent={(event) => select(event.id)}
      toolbar={<ScheduleLegend />}
      {...(onReschedule ? { onUpdate: reschedule } : {})}
      label={t('calendarLabel')}
    />
  );
}
