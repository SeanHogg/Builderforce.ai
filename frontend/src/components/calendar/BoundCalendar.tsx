/*
 * No `'use client'` here on purpose — see the note at the top of `Calendar.tsx`.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  calendarGridRange,
  sanitizeCalendarView,
  startOfDay,
  type CalendarEvent,
  type CalendarView,
} from '@builderforce/creation-canvas-contract';
import {
  calendarSource,
  calendarSourcesFor,
  sanitizeCalendarSourceId,
  type CalendarEventDraft,
  type CalendarSourceContext,
  type CalendarSourceId,
} from '@/lib/calendar/calendarSources';
import { Calendar } from './Calendar';
import styles from './Calendar.module.css';

/**
 * A CALENDAR BOUND TO A SOURCE — the whole vertical slice, in one self-contained piece.
 *
 * ── WHY THIS EXISTS AS ITS OWN COMPONENT ─────────────────────────────────────────
 * `Calendar` is deliberately dumb: events in, callbacks out, no idea where a date came
 * from. Something has to do the other half — resolve the bound source, read the window
 * currently on screen, and route a create/update/delete back to the right store. The
 * one place that must NOT do it is the host. `CreationCanvas.tsx` is already the
 * standing god class in this codebase, and "assemble eight props for the calendar" is
 * exactly how it got that way: a host that knows how a calendar fetches is a host that
 * has to change whenever a source is added.
 *
 * So the binder is a component. A consumer hands it a source id and the narrow context
 * (`CalendarSourceContext`) and gets a working calendar — reading, writing, paging,
 * caching — with no further wiring. The canvas node body and the full-screen surface
 * are each a handful of lines on top of this, and a page that wants a calendar is the
 * same handful.
 *
 * ── WHY THE PICKER LIVES HERE AND DECIDES ITS OWN VISIBILITY ─────────────────────
 * It renders when — and only when — the consumer supplied `onSourceChange`, and it
 * offers what `calendarSourcesFor` says this host can resolve. No `canPickSource`
 * boolean is drilled in, because "can this host resolve the board source" is a fact
 * about the context it already holds.
 */

export interface BoundCalendarProps {
  sourceId: CalendarSourceId;
  context: CalendarSourceContext;
  variant?: 'card' | 'full';
  defaultView?: CalendarView;
  /** Persist a grain the reader picked, when the host has somewhere to put it. */
  onViewChange?: (view: CalendarView) => void;
  /** Supplying this is what puts the source picker on the header. */
  onSourceChange?: (sourceId: CalendarSourceId) => void;
  /**
   * Whether the reader may write at all.
   *
   * ANDed with what the source can do, never instead of it: a writable host bound to a
   * read-only source still cannot write, and a read-only host bound to a writable one
   * still cannot. Both facts are real and neither is derivable from the other.
   */
  editable?: boolean;
  /** Go to whatever an event IS — the board card, the meeting, the release. */
  onOpenSource?: (event: CalendarEvent) => void;
  label?: string;
  nowMs?: number;
}

export function BoundCalendar({
  sourceId,
  context,
  variant = 'card',
  defaultView = 'month',
  onViewChange,
  onSourceChange,
  editable = false,
  onOpenSource,
  label,
  nowMs,
}: BoundCalendarProps) {
  const t = useTranslations('calendar');
  const source = calendarSource(sanitizeCalendarSourceId(sourceId));

  const [view, setView] = useState<CalendarView>(() => sanitizeCalendarView(defaultView));
  const [cursor, setCursor] = useState(() => startOfDay(nowMs ?? Date.now()));
  const [events, setEvents] = useState<readonly CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped after every successful write. A counter rather than re-deriving from the
  // events themselves: a create whose row lands outside the visible window would
  // otherwise look like a no-op and never trigger the re-read that proves it saved.
  const [revision, setRevision] = useState(0);

  const range = useMemo(() => calendarGridRange(view, cursor), [view, cursor]);

  // The context is rebuilt by the parent on every render (it holds callbacks), so the
  // read depends on its CONTENTS rather than its identity — otherwise this refetches
  // once per keystroke anywhere above it. The board is compared by length and by the
  // dates it carries, which is exactly what the projection reads.
  const contextKey = useMemo(() => JSON.stringify({
    project: context.projectId ?? null,
    own: context.ownRows ?? null,
    board: (context.board ?? []).map((object) => `${object.id}:${object.kind}`),
  }), [context.projectId, context.ownRows, context.board]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    Promise.resolve(source.read({ startMs: range.startMs, endMs: range.endMs }, context))
      .then((read) => { if (live) setEvents(read); })
      .catch((cause: unknown) => {
        if (!live) return;
        // The grid stays up and says why. A calendar that blanks on a failed read is
        // indistinguishable from a calendar with nothing in it, which is the reading
        // somebody would act on.
        setEvents([]);
        setError(cause instanceof Error ? cause.message : t('readFailed'));
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
    // `context` is intentionally absent: `contextKey` is its value-identity, and the
    // callbacks it also carries must not re-trigger a read when they are re-created.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, range.startMs, range.endMs, contextKey, revision]);

  const after = useCallback(async (action: Promise<void> | void) => {
    await action;
    setRevision((current) => current + 1);
  }, []);

  // Named, not counted: the source hands back WHICH things have no date, and the
  // calendar draws them beneath the grid where they can be reached.
  const undated = source.undated?.(context);
  const canWrite = editable;

  const picker = onSourceChange ? (
    <label className={styles.sourcePicker}>
      <span>{t('sourceLabel')}</span>
      <select
        value={source.id}
        onChange={(changed) => onSourceChange(sanitizeCalendarSourceId(changed.target.value))}
      >
        {calendarSourcesFor(context).map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {t(`source.${candidate.id}` as 'source.own')}
          </option>
        ))}
      </select>
    </label>
  ) : undefined;

  return (
    <Calendar
      events={events}
      variant={variant}
      view={view}
      onViewChange={(next) => { setView(next); onViewChange?.(next); }}
      cursorMs={cursor}
      onCursorChange={setCursor}
      {...(undated && undated.length ? { undated } : {})}
      loading={loading}
      error={error}
      {...(picker ? { toolbar: picker } : {})}
      {...(nowMs !== undefined ? { nowMs } : {})}
      {...(label ? { label } : {})}
      {...(onOpenSource ? { onOpenSource } : {})}
      {...(canWrite && source.create
        ? { onCreate: (draft: CalendarEventDraft) => after(source.create!(draft, context)) }
        : {})}
      {...(canWrite && source.update
        ? { onUpdate: (event: CalendarEvent, draft: CalendarEventDraft) => after(source.update!(event, draft, context)) }
        : {})}
      {...(canWrite && source.remove
        ? { onDelete: (event: CalendarEvent) => after(source.remove!(event, context)) }
        : {})}
    />
  );
}
