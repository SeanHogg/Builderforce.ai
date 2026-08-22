/*
 * No `'use client'` here on purpose. Every consumer — the canvas node body, the canvas
 * object surface, any page that mounts one — is already inside a client boundary, so a
 * directive here would declare a second entry point that does not exist, and
 * `check-frontend-architecture` counts directives rather than components.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  CALENDAR_VIEWS,
  DAY_MS,
  calendarConflicts,
  calendarEventDays,
  calendarEventEnd,
  calendarEventStart,
  calendarGridDays,
  calendarGridRange,
  eventsInRange,
  sanitizeCalendarView,
  shiftCalendarCursor,
  startOfDay,
  toCalendarEvents,
  type CalendarEvent,
  type CalendarView,
  type UndatedEntry,
} from '@builderforce/creation-canvas-contract';
import { useFormat } from '@/i18n/useFormat';
import type { CalendarEventDraft } from '@/lib/calendar/calendarSources';
import { CalendarEventDetail } from './CalendarEventDetail';
import styles from './Calendar.module.css';

/**
 * THE CALENDAR. One component, any dated data, three grains, two sizes.
 *
 * ── WHAT IT REPLACED ─────────────────────────────────────────────────────────────
 * A month grid that was welded into a canvas MODALITY: one reading (this board's dated
 * cards), one grain (a month), no detail, no writing, and — because a rail entry is a
 * mode rather than a thing — no way to have two of them or to put one beside anything.
 * Everything domain-specific about that grid was an assumption, not a requirement: a
 * deployment, a send, a public holiday, an on-call shift and a sales meeting are the
 * same four facts (when, how long, what it is called, what it says when you open it).
 *
 * So this component knows about {@link CalendarEvent} and nothing else. It does not
 * fetch, does not know what a canvas node is, and does not know which of its events can
 * be written — the SOURCE decides that and says so by supplying (or withholding) the
 * three write callbacks. That is what makes the same component the card body, the
 * full-screen surface, and anything else that has dates.
 *
 * ── WHY THE DETAIL PANEL IS INSIDE THE CALENDAR ──────────────────────────────────
 * It is positioned within this component's own bounds, not portalled to the document.
 * A calendar rendered in a ~340px card must not be able to throw a page-level dialog
 * over the board behind it, and a calendar rendered full-screen should keep its detail
 * over its own grid where the day it belongs to is still visible. One overlay, scaled
 * by the container it is in — which is also why this does NOT use the app's slide-out
 * panel: that panel is a property of a page, and this component is not one.
 *
 * ── WHY IT TAKES ONE EVENT OR MANY ───────────────────────────────────────────────
 * `toCalendarEvents` in the contract normalises `CalendarEvent | CalendarEvent[] |
 * null`, so a caller holding one thing, a list, or nothing hands over what it has and
 * never branches. The branch would otherwise appear in every consumer.
 */

export interface CalendarProps {
  /** One event, many, or nothing. See {@link toCalendarEvents}. */
  events: CalendarEvent | readonly CalendarEvent[] | null | undefined;
  /**
   * How much room this has.
   *
   * `card` is the ~340px node body: a month with no week header, compact pills, and no
   * hour grid — a day view at card size is a list, and it says so.
   * `full` is the surface: week headers, hour grids, and a detail panel with room to
   * edit in.
   */
  variant?: 'card' | 'full';
  /** Controlled grain. Omit to let the calendar own it, seeded from `defaultView`. */
  view?: CalendarView;
  defaultView?: CalendarView;
  onViewChange?: (view: CalendarView) => void;
  /** Which grains to offer. Omit for all three; a card offers what fits. */
  availableViews?: readonly CalendarView[];
  /** The instant the grid is centred on. Uncontrolled unless `onCursorChange` is given. */
  cursorMs?: number;
  onCursorChange?: (cursorMs: number) => void;
  /** "Now", injected so a test can sit on a date boundary without mocking global time. */
  nowMs?: number;
  /**
   * Things that belong on this calendar and carry no date.
   *
   * Rendered as selectable chips beneath the grid rather than counted, because a project
   * with no deadline is the one a planner most needs to reach. `onSelectUndated` is what
   * makes them pressable; without it they are a legible list.
   */
  undated?: readonly UndatedEntry[];
  onSelectUndated?: (id: string) => void;
  /** True while the bound source is reading. The grid stays up; only the header says so. */
  loading?: boolean;
  /** Why the source could not be read. Shown in place of the summary, never as a toast. */
  error?: string | null;
  /** Extra header controls — the source picker, a refresh, a legend. Rendered before the
   *  grain switch. */
  toolbar?: React.ReactNode;
  /** Anything that belongs UNDER the grid: a legend, a hint, a key. */
  footer?: React.ReactNode;
  /**
   * Paint a background behind one slot of the day/week grid — the availability shading a
   * bookable calendar needs.
   *
   * A function of the INSTANT rather than a set of windows, deliberately: whose
   * availability, in which timezone, and against which rules is the caller's question,
   * and a calendar that took windows would have to grow a timezone model to answer it.
   * Return `undefined` for an ordinary slot.
   */
  slotShading?: (instantMs: number) => { background: string; label?: string } | undefined;
  /**
   * Take over what clicking an entry MEANS.
   *
   * Supplied, the calendar hands the entry over and draws no detail panel — because
   * "open the project", "join the meeting" and "open the file" are things the host owns
   * and a built-in panel would be a second, worse version of. Absent, the calendar shows
   * its own detail, which is the right behaviour for a source that has nowhere else to go.
   */
  onSelectEvent?: (event: CalendarEvent) => void;
  /** Where an event CAME from: open the board card, the meeting, the run. Absent = no link. */
  onOpenSource?: (event: CalendarEvent) => void;
  /** Supplying this is what makes empty space clickable. */
  onCreate?: (draft: CalendarEventDraft) => void | Promise<void>;
  /** Supplying this is what makes an event draggable and editable. */
  onUpdate?: (event: CalendarEvent, patch: CalendarEventDraft) => void | Promise<void>;
  onDelete?: (event: CalendarEvent) => void | Promise<void>;
  /** Accessible name for the region. Defaults to the generic one. */
  label?: string;
}

/** Lanes drawn in a month cell before the rest collapse into a count. A cell that grows
 *  without limit stops being a month: twelve overlapping releases would push one week
 *  row past the viewport. */
const MAX_LANES_FULL = 4;
const MAX_LANES_CARD = 2;
/** The hours a day/week grid draws. Outside these an event still renders, clamped to the
 *  edge — a 03:00 deploy is real and must not vanish because the grid starts at 07:00. */
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 21;

function hoursOf(): readonly number[] {
  return Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, index) => DAY_START_HOUR + index);
}

/**
 * The palette a category is drawn in.
 *
 * Hashed from the category NAME rather than mapped by hand, for the reason the contract
 * gives about the table it replaced: a hand-kept map covers the categories somebody
 * thought of, and every one added later draws in the default colour with no guard to
 * notice. Every entry is a declared token, so both themes are covered by construction.
 */
const CATEGORY_TOKENS = [
  '--sky-bright', '--emerald-bright', '--violet-bright', '--amber-bright',
  '--pink-bright', '--teal-bright', '--indigo-bright', '--orange-bright',
] as const;

export function calendarCategoryToken(category: string | undefined): string {
  if (!category) return '--accent';
  let hash = 0;
  for (let index = 0; index < category.length; index += 1) {
    hash = (hash * 31 + category.charCodeAt(index)) >>> 0;
  }
  return CATEGORY_TOKENS[hash % CATEGORY_TOKENS.length]!;
}

/** One event's row within one week, in lanes — the packing a month grid needs so a
 *  three-day release draws as one bar rather than as three unrelated pills. */
interface WeekBar {
  event: CalendarEvent;
  /** 0-6 within the week row. */
  column: number;
  span: number;
  lane: number;
  /** The bar is cut by the week edge, so its ends are drawn open. */
  clippedStart: boolean;
  clippedEnd: boolean;
}

function packWeek(events: readonly CalendarEvent[], weekStartMs: number): readonly WeekBar[] {
  const weekEndMs = weekStartMs + 7 * DAY_MS;
  const lanes: number[][] = [];
  const bars: WeekBar[] = [];
  for (const event of events) {
    const startMs = calendarEventStart(event);
    const endMs = calendarEventEnd(event);
    if (startMs >= weekEndMs || endMs <= weekStartMs) continue;
    const firstDay = Math.max(startOfDay(startMs), weekStartMs);
    const lastDay = Math.min(startOfDay(endMs - 1), weekEndMs - DAY_MS);
    const column = Math.round((firstDay - weekStartMs) / DAY_MS);
    const span = Math.max(1, Math.round((lastDay - firstDay) / DAY_MS) + 1);
    let lane = lanes.findIndex((occupied) => occupied.every((taken) => taken < column || taken >= column + span
      ? true
      : false));
    // `findIndex` above answers "is every taken column outside this bar's span"; a lane
    // with any overlap is rejected and the next one tried. A brand-new lane is opened
    // only when every existing one collides, which is what keeps a quiet week to one row.
    if (lane === -1) { lanes.push([]); lane = lanes.length - 1; }
    for (let offset = 0; offset < span; offset += 1) lanes[lane]!.push(column + offset);
    bars.push({
      event, column, span, lane,
      clippedStart: startOfDay(startMs) < weekStartMs,
      clippedEnd: startOfDay(endMs - 1) >= weekEndMs,
    });
  }
  return bars;
}

export function Calendar({
  events,
  variant = 'card',
  view,
  defaultView = 'month',
  onViewChange,
  availableViews = CALENDAR_VIEWS,
  cursorMs,
  onCursorChange,
  nowMs,
  undated,
  onSelectUndated,
  loading = false,
  error = null,
  toolbar,
  footer,
  slotShading,
  onSelectEvent,
  onOpenSource,
  onCreate,
  onUpdate,
  onDelete,
  label,
}: CalendarProps) {
  const t = useTranslations('calendar');
  const fmt = useFormat();

  // "Now" is read ONCE per mount rather than per render. A calendar that recomputed
  // Date.now() every render would move its own "today" mid-interaction and, worse,
  // change the identity of every memo below on every keystroke in the detail panel.
  const mountedNow = useRef(Date.now());
  const now = nowMs ?? mountedNow.current;

  const [ownView, setOwnView] = useState<CalendarView>(() => sanitizeCalendarView(defaultView));
  const activeView = sanitizeCalendarView(view ?? ownView, 'month');
  const setView = useCallback((next: CalendarView) => {
    if (view === undefined) setOwnView(next);
    onViewChange?.(next);
  }, [onViewChange, view]);

  const [ownCursor, setOwnCursor] = useState(() => startOfDay(nowMs ?? Date.now()));
  const activeCursor = cursorMs ?? ownCursor;
  const setCursor = useCallback((next: number) => {
    if (cursorMs === undefined) setOwnCursor(next);
    onCursorChange?.(next);
  }, [cursorMs, onCursorChange]);

  const [openEvent, setOpenEvent] = useState<CalendarEvent | null>(null);
  const [draft, setDraft] = useState<CalendarEventDraft | null>(null);

  const all = useMemo(() => toCalendarEvents(events), [events]);
  const range = useMemo(() => calendarGridRange(activeView, activeCursor), [activeView, activeCursor]);
  const visible = useMemo(() => eventsInRange(all, range), [all, range]);
  const conflicts = useMemo(() => calendarConflicts(all), [all]);
  const days = useMemo(() => calendarGridDays(activeView, activeCursor), [activeView, activeCursor]);

  // An event that is edited out from under the panel (a source refresh, another
  // collaborator) must not leave a stale copy open — the panel re-reads its own event
  // from the live list by id, and closes if it has gone.
  useEffect(() => {
    if (!openEvent) return;
    const live = all.find((candidate) => candidate.id === openEvent.id);
    if (!live) setOpenEvent(null);
    else if (live !== openEvent) setOpenEvent(live);
  }, [all, openEvent]);

  const writable = Boolean(onUpdate);
  const maxLanes = variant === 'card' ? MAX_LANES_CARD : MAX_LANES_FULL;
  // A card has no room for an hour grid; a month is the only grain that reads at 340px.
  const offeredViews = variant === 'card' ? (['month'] as const) : availableViews;

  const title = useMemo(() => {
    if (activeView === 'day') return fmt.dateLong(activeCursor);
    if (activeView === 'week') {
      const weekEnd = range.endMs - DAY_MS;
      return `${fmt.date(range.startMs)} – ${fmt.date(weekEnd)}`;
    }
    return fmt.dateWith(activeCursor, { month: 'long', year: 'numeric' });
  }, [activeView, activeCursor, fmt, range]);

  const startDraftOn = useCallback((dayMs: number, hour?: number) => {
    if (!onCreate) return;
    const start = new Date(dayMs);
    if (hour !== undefined) start.setHours(hour, 0, 0, 0);
    setOpenEvent(null);
    setDraft({
      subject: '',
      details: '',
      startISO: hour === undefined
        ? new Date(start).toISOString().slice(0, 10)
        : new Date(start.getTime() - start.getTimezoneOffset() * 60_000).toISOString().slice(0, 16),
      allDay: hour === undefined,
    });
  }, [onCreate]);

  /** Move an event to another day, keeping how long it runs. The drag payload is the
   *  event id alone: everything else is re-read from the live list, so a stale drag
   *  cannot resurrect a deleted event's dates. */
  const dropOnDay = useCallback((eventId: string, dayMs: number) => {
    if (!onUpdate) return;
    const event = all.find((candidate) => candidate.id === eventId);
    if (!event || event.readOnly) return;
    const startMs = calendarEventStart(event);
    const durationMs = Math.max(0, calendarEventEnd(event) - startMs);
    const moved = new Date(dayMs);
    const original = new Date(startMs);
    if (!event.allDay) moved.setHours(original.getHours(), original.getMinutes(), 0, 0);
    if (startOfDay(moved.getTime()) === startOfDay(startMs)) return;
    void onUpdate(event, {
      subject: event.subject,
      details: event.details ?? '',
      startISO: event.allDay
        ? new Date(moved).toISOString().slice(0, 10)
        : new Date(moved.getTime() - moved.getTimezoneOffset() * 60_000).toISOString().slice(0, 16),
      ...(event.endISO && !event.allDay
        ? { endISO: new Date(moved.getTime() + durationMs - moved.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) }
        : {}),
      allDay: Boolean(event.allDay),
    });
  }, [all, onUpdate]);

  // Which day the pointer is over mid-drag. The cell is OUTLINED rather than the bar
  // being slid: a month grid wraps, so a bar shifted by the delta hangs outside its own
  // week row on any drag that crosses a weekend, which reads as a rendering fault.
  const [dropDay, setDropDay] = useState<number | null>(null);

  const dayCellProps = (dayMs: number) => ({
    'data-drop': dropDay === dayMs ? '' : undefined,
    onDragOver: writable ? (event: React.DragEvent) => { event.preventDefault(); setDropDay(dayMs); } : undefined,
    onDragLeave: writable ? () => setDropDay((current) => (current === dayMs ? null : current)) : undefined,
    onDrop: writable ? (event: React.DragEvent) => {
      event.preventDefault();
      setDropDay(null);
      const id = event.dataTransfer.getData('application/x-calendar-event');
      if (id) dropOnDay(id, dayMs);
    } : undefined,
  });

  /**
   * `continued` suppresses the SUBJECT, not the bar.
   *
   * A span that crosses a week boundary is drawn as one bar per week row — a bar cannot
   * cross a row — and repeating its own title once a week reads as several separate
   * things. The leading segment carries the name; the continuation carries the colour and
   * keeps the title attribute, so a hover still says what it is.
   */
  const eventButton = (event: CalendarEvent, className: string, style?: React.CSSProperties, continued = false) => (
    <button
      key={event.id}
      type="button"
      className={className}
      style={{
        ...style,
        // The source's own rule wins over the category hash — a delivery item coloured
        // by whether it is overdue, a meeting by whether it is live.
        ['--event-color' as string]: event.color ?? `var(${calendarCategoryToken(event.category)})`,
      }}
      draggable={writable && !event.readOnly}
      onDragStart={(dragEvent) => dragEvent.dataTransfer.setData('application/x-calendar-event', event.id)}
      onClick={(clickEvent) => {
        clickEvent.stopPropagation();
        // A host that knows what an entry IS opens it; only a calendar with nowhere to
        // send the reader draws its own detail.
        if (onSelectEvent) { onSelectEvent(event); return; }
        setDraft(null);
        setOpenEvent(event);
      }}
      data-conflict={conflicts.has(event.id) || undefined}
      title={conflicts.has(event.id) ? t('conflict') : event.subject || undefined}
    >
      {event.accent && <span className={styles.pillAccent} style={{ background: event.accent }} aria-hidden />}
      {!event.allDay && !continued && <time className={styles.pillTime}>{fmt.time(calendarEventStart(event))}</time>}
      <span className={styles.pillSubject}>{continued ? '' : (event.subject || t('untitled'))}</span>
    </button>
  );

  const monthGrid = (
    <div className={styles.month} role="grid" aria-label={t('gridLabel')}>
      <div className={styles.weekdays} role="row">
        {days.slice(0, 7).map((day) => (
          <span key={day} role="columnheader">
            {fmt.dateWith(day, { weekday: variant === 'card' ? 'narrow' : 'short' })}
          </span>
        ))}
      </div>
      {Array.from({ length: days.length / 7 }, (_, weekIndex) => {
        const weekStart = days[weekIndex * 7]!;
        const bars = packWeek(visible, weekStart);
        const shown = bars.filter((bar) => bar.lane < maxLanes);
        const overflowByColumn = new Map<number, number>();
        for (const bar of bars) {
          if (bar.lane < maxLanes) continue;
          for (let offset = 0; offset < bar.span; offset += 1) {
            const column = bar.column + offset;
            overflowByColumn.set(column, (overflowByColumn.get(column) ?? 0) + 1);
          }
        }
        return (
          <div key={weekStart} className={styles.week} role="row">
            {Array.from({ length: 7 }, (_, columnIndex) => {
              const dayMs = weekStart + columnIndex * DAY_MS;
              const day = new Date(dayMs);
              const overflow = overflowByColumn.get(columnIndex) ?? 0;
              return (
                <div
                  key={dayMs}
                  role="gridcell"
                  className={styles.day}
                  data-outside={activeView === 'month' && day.getMonth() !== new Date(activeCursor).getMonth() ? '' : undefined}
                  data-today={startOfDay(dayMs) === startOfDay(now) ? '' : undefined}
                  onClick={onCreate ? () => startDraftOn(dayMs) : undefined}
                  {...dayCellProps(dayMs)}
                >
                  <small className={styles.dayNumber}>{day.getDate()}</small>
                  {overflow > 0 && (
                    <button
                      type="button"
                      className={styles.more}
                      onClick={(clickEvent) => { clickEvent.stopPropagation(); setView('day'); setCursor(dayMs); }}
                    >{t('more', { count: overflow })}</button>
                  )}
                </div>
              );
            })}
            <div className={styles.bars} aria-hidden={false}>
              {shown.map((bar) => eventButton(
                bar.event,
                `${styles.pill} ${styles.bar}`,
                {
                  gridColumn: `${bar.column + 1} / span ${bar.span}`,
                  gridRow: bar.lane + 1,
                  ...(bar.clippedStart ? { borderTopLeftRadius: 0, borderBottomLeftRadius: 0 } : {}),
                  ...(bar.clippedEnd ? { borderTopRightRadius: 0, borderBottomRightRadius: 0 } : {}),
                },
                bar.clippedStart,
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );

  const timeGrid = (
    <div className={styles.timeGrid} data-columns={days.length}>
      <div className={styles.timeHeader}>
        <span className={styles.gutter} aria-hidden />
        {days.map((dayMs) => (
          <button
            key={dayMs}
            type="button"
            className={styles.timeHeaderDay}
            data-today={startOfDay(dayMs) === startOfDay(now) ? '' : undefined}
            onClick={() => { setView('day'); setCursor(dayMs); }}
          >
            <small>{fmt.dateWith(dayMs, { weekday: 'short' })}</small>
            <b>{new Date(dayMs).getDate()}</b>
          </button>
        ))}
      </div>
      <div className={styles.allDayBand}>
        <span className={styles.gutter}>{t('allDay')}</span>
        {days.map((dayMs) => (
          <div
            key={dayMs}
            className={styles.allDayCell}
            onClick={onCreate ? () => startDraftOn(dayMs) : undefined}
            {...dayCellProps(dayMs)}
          >
            {visible
              .filter((event) => event.allDay
                && calendarEventStart(event) < dayMs + DAY_MS
                && calendarEventEnd(event) > dayMs)
              .map((event) => eventButton(event, styles.pill))}
          </div>
        ))}
      </div>
      <div className={styles.hours}>
        {hoursOf().map((hour) => (
          <div key={hour} className={styles.hourRow}>
            <span className={styles.gutter}>{fmt.dateWith(new Date().setHours(hour, 0, 0, 0), { hour: 'numeric' })}</span>
            {days.map((dayMs) => {
              const slotMs = new Date(new Date(dayMs).setHours(hour, 0, 0, 0)).getTime();
              const shade = slotShading?.(slotMs);
              return (
                <div
                  key={`${dayMs}-${hour}`}
                  className={styles.hourCell}
                  {...(shade ? { style: { background: shade.background }, title: shade.label } : {})}
                  onClick={onCreate ? () => startDraftOn(dayMs, hour) : undefined}
                  {...dayCellProps(dayMs)}
                />
              );
            })}
          </div>
        ))}
        <div className={styles.timedLayer}>
          <span className={styles.gutter} aria-hidden />
          {days.map((dayMs) => (
            <div key={dayMs} className={styles.timedColumn}>
              {visible
                .filter((event) => !event.allDay
                  && calendarEventStart(event) < dayMs + DAY_MS
                  && calendarEventEnd(event) > dayMs)
                .map((event) => {
                  const startMs = Math.max(calendarEventStart(event), dayMs);
                  const endMs = Math.min(calendarEventEnd(event), dayMs + DAY_MS);
                  const gridStart = dayMs + DAY_START_HOUR * 3_600_000;
                  const gridSpan = (DAY_END_HOUR - DAY_START_HOUR) * 3_600_000;
                  // Clamped, never dropped: a 03:00 deploy sits at the top edge of a
                  // grid that starts at 07:00 rather than disappearing from the day it
                  // happened on.
                  const top = Math.min(1, Math.max(0, (startMs - gridStart) / gridSpan));
                  const bottom = Math.min(1, Math.max(0, (endMs - gridStart) / gridSpan));
                  return eventButton(event, `${styles.pill} ${styles.timedEvent}`, {
                    top: `${top * 100}%`,
                    height: `${Math.max(3, (bottom - top) * 100)}%`,
                  });
                })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const summary = error
    ? <p className={styles.error} role="status">{error}</p>
    : <p className={styles.summary} role="status">
        {loading
          ? t('loading')
          : t('summary', { shown: visible.length, total: all.length, undated: undated?.length ?? 0 })}
      </p>;

  return (
    <section
      className={styles.calendar}
      data-variant={variant}
      data-view={activeView}
      // Named by its SIZE, because that is the fact a consumer's test is asserting:
      // "the card draws a month" and "the surface draws the full one" are two different
      // claims about the same component.
      data-testid={`calendar-${variant}`}
      aria-label={label ?? t('regionLabel')}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        if (!openEvent && !draft) return;
        event.stopPropagation();
        setOpenEvent(null);
        setDraft(null);
      }}
    >
      <header className={styles.header}>
        <div className={styles.nav} role="group" aria-label={t('navLabel')}>
          <button type="button" onClick={() => setCursor(shiftCalendarCursor(activeView, activeCursor, -1))} aria-label={t('previous')}>‹</button>
          <button type="button" className={styles.today} onClick={() => setCursor(startOfDay(now))}>{t('today')}</button>
          <button type="button" onClick={() => setCursor(shiftCalendarCursor(activeView, activeCursor, 1))} aria-label={t('next')}>›</button>
        </div>
        <b className={styles.title}>{title}</b>
        {toolbar}
        {offeredViews.length > 1 && (
          <div className={styles.views} role="group" aria-label={t('viewLabel')}>
            {offeredViews.map((candidate) => (
              <button
                key={candidate}
                type="button"
                aria-pressed={candidate === activeView}
                onClick={() => setView(candidate)}
              >{t(`view.${candidate}` as 'view.day')}</button>
            ))}
          </div>
        )}
        {onCreate && (
          <button type="button" className={styles.add} onClick={() => startDraftOn(activeCursor, activeView === 'month' ? undefined : 9)}>
            {t('add')}
          </button>
        )}
      </header>

      {summary}

      <div className={styles.body}>
        {activeView === 'month' ? monthGrid : timeGrid}
        {visible.length === 0 && !loading && <p className={styles.empty}>{t('empty')}</p>}
      </div>

      {undated && undated.length > 0 && (
        <div className={styles.undated}>
          <span>{t('undatedLabel')}</span>
          {undated.map((entry) => (
            <button
              key={entry.id}
              type="button"
              disabled={!onSelectUndated}
              onClick={() => onSelectUndated?.(entry.id)}
            >
              {entry.accent && <span className={styles.pillAccent} style={{ background: entry.accent }} aria-hidden />}
              {entry.subject}
            </button>
          ))}
        </div>
      )}

      {footer && <div className={styles.footer}>{footer}</div>}

      {(openEvent || draft) && (
        <CalendarEventDetail
          {...(openEvent ? { event: openEvent } : {})}
          {...(draft ? { draft } : {})}
          {...(onOpenSource && openEvent ? { onOpenSource: () => onOpenSource(openEvent) } : {})}
          {...(onCreate ? { onCreate } : {})}
          {...(onUpdate ? { onUpdate } : {})}
          {...(onDelete ? { onDelete } : {})}
          onClose={() => { setOpenEvent(null); setDraft(null); }}
        />
      )}
    </section>
  );
}

export { calendarEventDays };
