/**
 * THE CALENDAR — one vocabulary for anything that is a DATE with a SUBJECT.
 *
 * ── WHAT THIS REPLACED, AND WHY ──────────────────────────────────────────────────
 * The month used to be a board-scoped canvas SURFACE: a rail modality beside Chat,
 * Board, 3D and App, wired to exactly one reading (the dated objects on this canvas)
 * and to exactly one grid (a month). That was wrong twice over.
 *
 *  1. **A modality is not a thing you can have two of.** A month is a VIEW OF SOME
 *     DATES, and a board legitimately holds several — the release calendar, the send
 *     calendar, the team's leave, the on-call rotation. A rail entry can only ever
 *     show one of them, sourced from one hardcoded place, and can never be put next to
 *     anything for comparison. An object can: two calendar cards side by side is a
 *     normal board, and it needs no new code.
 *  2. **It hardcoded its own source.** "Every dated object on this canvas" is a
 *     perfectly good reading, and it is ONE reading. Deployments, meetings, holidays,
 *     tasks and a connected Google account are dates that already exist elsewhere, and
 *     none of them was reachable, because the reading was compiled into the surface
 *     rather than being a value the object carries.
 *
 * So the calendar is a `calendar` OBJECT bound to a SOURCE, and the surface it opens on
 * is object-scoped like `page` and `play` — entered from the card that IS the calendar,
 * full-screen when the month needs the room.
 *
 * ── WHY THE EVENT IS THIS SHAPE AND NOT A KIND PER DOMAIN ────────────────────────
 * A deployment, a send, a sales meeting, a public holiday and an on-call shift differ
 * in what they MEAN and not at all in what a calendar needs of them: when it starts,
 * how long it runs, what to call it, and what to say when somebody opens it. That is
 * {@link CalendarEvent}, and it is why one component draws all five. What a thing IS
 * stays a `category` — a VALUE — for the same open/closed reason `pollFormat` is a
 * value rather than eight poll kinds.
 *
 * ── PURE, LIKE EVERY OTHER MODULE IN THIS PACKAGE ────────────────────────────────
 * No React, no fetch, no clock of its own — every function that needs "now" or "which
 * day" takes it. The browser draws the grid, the source adapters produce the events,
 * and the server can count a conflict with the same call the card does.
 */

import { dateValue, resolveDeadlineField } from './triggers';

// ---------------------------------------------------------------------------
// The event
// ---------------------------------------------------------------------------

/**
 * One dated thing.
 *
 * `id` is unique WITHIN A READING, not globally: two sources can each hold a row 7, so
 * the adapters prefix (`meetings:7`). `sourceId` + `ref` is what a write goes back
 * through — the calendar never guesses where an event came from, because an edit
 * applied to the wrong store is worse than an edit refused.
 */
export interface CalendarEvent {
  id: string;
  /** What it is called. The one line drawn in a day cell. */
  subject: string;
  /** The prose shown when it is opened. Optional: plenty of dated things are a name. */
  details?: string;
  /** ISO instant, or `YYYY-MM-DD` for an all-day one. */
  startISO: string;
  /** ISO instant the event ends. Absent means a point in time, not midnight. */
  endISO?: string;
  /**
   * Occupies whole days rather than a time range. A holiday and a release date are
   * all-day; a stand-up is not. Drawn in the all-day band of a day/week grid, which is
   * the only place a 24-hour bar does not swamp everything beside it.
   */
  allDay?: boolean;
  /**
   * WHAT KIND of dated thing — `deployment`, `email`, `social`, `meeting`, `holiday`,
   * `oncall`, whatever a source declares. Two jobs: it colours the pill, and it is the
   * bucket {@link calendarConflicts} collides on. A VALUE and not a kind, deliberately.
   */
  category?: string;
  /** Which registered source produced it. Written by the adapter, never authored. */
  sourceId?: string;
  /** The row's own id in that source — a meeting id, a node id, a holiday's date. */
  ref?: string;
  /**
   * The FIELD on the origin record the date was read from, when the source has more
   * than one. The board projection sets it (`scheduledAt`, `dueAt`, …) so a drag writes
   * back into the field the date came from rather than inventing a second one.
   */
  field?: string;
  location?: string;
  /** Somewhere to go: a meeting room, a run, an external calendar entry. */
  url?: string;
  /**
   * The entry's own stripe colour, as a CSS value — a declared token or a
   * `var(--token)` expression, never a literal hex, so both themes are covered.
   *
   * Overrides the category hash. A source that already HAS a colour rule uses it: a
   * delivery item is coloured by whether its deadline is overdue, a meeting by whether
   * it is live. Absent means "colour me by category", which is the right default for a
   * source with no such rule of its own.
   */
  color?: string;
  /**
   * A SECOND signal, drawn as a dot beside the subject.
   *
   * Distinct from `color` because the two answer different questions and a source can
   * legitimately have both: a project's stripe says whether it is late, and its dot says
   * whether the project is healthy. Collapsing them would lose one of the two.
   */
  accent?: string;
  /**
   * This particular event cannot be edited even though its source can write — a
   * derived row, a read-only mirror, somebody else's entry. The detail panel reads
   * this rather than recomputing an entitlement the source already knows.
   */
  readOnly?: boolean;
}

/**
 * ONE object, MANY objects, or nothing — normalised to a list.
 *
 * This is the signature the whole feature is named after: a calendar takes "any
 * calendar object and/or array of calendar objects". Callers hand over whatever they
 * hold and never branch on which it was, which is the branch that would otherwise
 * appear in every consumer.
 */
export function toCalendarEvents(
  input: CalendarEvent | readonly CalendarEvent[] | null | undefined,
): readonly CalendarEvent[] {
  if (!input) return [];
  return Array.isArray(input) ? input : [input as CalendarEvent];
}

/**
 * The alias table for a loose row.
 *
 * A calendar's events arrive from three kinds of writer — a person typing rows on a
 * card, a model patching the object, and an API adapter — and all three spell the same
 * four facts differently. Rather than making each source normalise (three normalisers,
 * one of which will drift), the spellings are declared once here.
 *
 * Order is precedence: the first key present wins.
 */
const SUBJECT_KEYS = ['subject', 'title', 'name', 'label', 'summary'] as const;
const DETAIL_KEYS = ['details', 'description', 'notes', 'body'] as const;
const START_KEYS = ['startISO', 'start', 'startsAt', 'scheduledAt', 'date', 'at', 'when'] as const;
const END_KEYS = ['endISO', 'end', 'endsAt', 'until', 'finishesAt'] as const;

function firstString(row: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
    if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  }
  return undefined;
}

/** A `YYYY-MM-DD` with no time on it is a whole day, wherever the reader is standing. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function isAllDayValue(value: string): boolean {
  return DATE_ONLY.test(value.trim());
}

/**
 * A row, whatever wrote it, as an event — or `null` when it carries no usable date.
 *
 * Refusing is the point. A row with a subject and no parseable start is not an event at
 * zero o'clock; it is an unscheduled thing, and a calendar that silently plots it on the
 * epoch (or on today) reports a commitment nobody made. Consumers count the refusals and
 * say so — see the surface's "with no date" summary.
 */
export function normalizeCalendarEvent(raw: unknown, index = 0): CalendarEvent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const start = firstString(row, START_KEYS);
  if (!start || dateValue(start) === null) return null;
  const end = firstString(row, END_KEYS);
  const subject = firstString(row, SUBJECT_KEYS) ?? '';
  const details = firstString(row, DETAIL_KEYS);
  const category = firstString(row, ['category', 'kind', 'channel', 'type']);
  const location = firstString(row, ['location', 'where', 'place']);
  const url = firstString(row, ['url', 'href', 'link', 'htmlLink']);
  const id = firstString(row, ['id', 'ref', 'key']) ?? `${start}-${index}`;
  const allDay = row.allDay === true || (row.allDay === undefined && isAllDayValue(start));
  return {
    id,
    subject,
    startISO: start,
    ...(end && dateValue(end) !== null ? { endISO: end } : {}),
    ...(details ? { details } : {}),
    ...(category ? { category } : {}),
    ...(location ? { location } : {}),
    ...(url ? { url } : {}),
    ...(allDay ? { allDay: true } : {}),
    ...(row.readOnly === true ? { readOnly: true } : {}),
  };
}

/** Every usable event in a loose list, in chronological order. Unusable rows are
 *  dropped here and counted by {@link countUndatedRows}, never plotted. */
export function normalizeCalendarEvents(raw: unknown): readonly CalendarEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row, index) => normalizeCalendarEvent(row, index))
    .filter((event): event is CalendarEvent => event !== null)
    .sort(byStart);
}

/**
 * SOMETHING THAT SHOULD BE ON A CALENDAR AND HAS NO DATE.
 *
 * Not a `CalendarEvent`: an event without a start is not an event, and giving one a
 * nullable start would put the refusal that keeps undated things off the grid into every
 * consumer instead of in one place. A calendar that can be handed these renders them
 * where they belong — beside the grid, named and selectable — rather than dropping them
 * and quietly holding fewer things than the list it was built from.
 */
export interface UndatedEntry {
  id: string;
  subject: string;
  /** The same second signal an event carries. */
  accent?: string;
}

/**
 * Rows that named something but never said when.
 *
 * Returned as ENTRIES rather than counted, because "three things have no date" is a
 * statistic and "Onboarding, Pricing page and Q4 audit have no date" is the list a
 * planner acts on. A calendar that could only report the number left its reader no way
 * to reach the very items most in need of a date.
 */
export function undatedRows(raw: unknown): readonly UndatedEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row && typeof row === 'object' && !normalizeCalendarEvent(row))
    .map(({ row, index }) => {
      const record = row as Record<string, unknown>;
      const subject = ['subject', 'title', 'name', 'label']
        .map((key) => (typeof record[key] === 'string' ? (record[key] as string).trim() : ''))
        .find(Boolean) ?? '';
      return { id: String(record.id ?? index), subject };
    });
}

export function byStart(a: CalendarEvent, b: CalendarEvent): number {
  return calendarEventStart(a) - calendarEventStart(b);
}

/** Epoch ms an event starts. `NaN` is impossible here: an event only exists if its
 *  start parsed (see {@link normalizeCalendarEvent}), and an authored one is checked
 *  the same way by the writers below. */
export function calendarEventStart(event: CalendarEvent): number {
  return dateValue(event.startISO) ?? 0;
}

/**
 * Epoch ms an event ends — its own end, or its start.
 *
 * An all-day event with no end covers ITS WHOLE DAY, not the instant of midnight: a
 * public holiday that ends the moment it begins draws as a hairline and answers "is
 * anyone working on the 25th" with a no that lasts zero seconds.
 */
export function calendarEventEnd(event: CalendarEvent): number {
  const end = event.endISO ? dateValue(event.endISO) : null;
  if (end !== null && end > calendarEventStart(event)) return end;
  return event.allDay ? startOfDay(calendarEventStart(event)) + DAY_MS : calendarEventStart(event);
}

/** Whole days an event spans, at least 1. What the month grid packs into lanes. */
export function calendarEventDays(event: CalendarEvent): number {
  const first = startOfDay(calendarEventStart(event));
  const last = startOfDay(calendarEventEnd(event) - 1);
  return Math.max(1, Math.round((last - first) / DAY_MS) + 1);
}

// ---------------------------------------------------------------------------
// The grain
// ---------------------------------------------------------------------------

/**
 * How much time is on screen.
 *
 * Three, closed. A day answers "what is my Tuesday", a week answers "when is this team
 * free", a month answers "what is in flight". A year grid answers none of them at a
 * legible size and a list is not a calendar, which is why neither is here.
 */
export const CALENDAR_VIEWS = ['day', 'week', 'month'] as const;
export type CalendarView = typeof CALENDAR_VIEWS[number];

export function isCalendarView(value: unknown): value is CalendarView {
  return typeof value === 'string' && (CALENDAR_VIEWS as readonly string[]).includes(value);
}

/** A stored or authored grain, or the default. A card that says `defaultView: 'year'`
 *  opens on the month rather than on nothing. */
export function sanitizeCalendarView(value: unknown, fallback: CalendarView = 'month'): CalendarView {
  return isCalendarView(value) ? value : fallback;
}

export const DAY_MS = 86_400_000;

/** Midnight LOCAL to whoever is reading. A calendar is drawn in the reader's own days —
 *  the one place a UTC day would be wrong, because "Tuesday" is not a UTC fact. */
export function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Monday-first. The ISO week is what a working week is planned on, and a Sunday start
 * puts the two days nobody schedules anything on either side of the grid.
 */
export function startOfWeek(ms: number): number {
  const date = new Date(startOfDay(ms));
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.getTime();
}

export function startOfMonth(ms: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

/** The half-open window a view covers: `[start, end)`. */
export interface CalendarRange { startMs: number; endMs: number }

/**
 * The days the grid draws, for a view and the day the reader is standing on.
 *
 * A month is always SIX weeks — 42 cells — so the grid does not change height between
 * February and August. A jumping container is what makes a month picker feel broken,
 * and the six-week form is what every paper calendar has settled on for the same reason.
 */
export function calendarGridRange(view: CalendarView, cursorMs: number): CalendarRange {
  if (view === 'day') {
    const startMs = startOfDay(cursorMs);
    return { startMs, endMs: startMs + DAY_MS };
  }
  if (view === 'week') {
    const startMs = startOfWeek(cursorMs);
    return { startMs, endMs: startMs + 7 * DAY_MS };
  }
  const startMs = startOfWeek(startOfMonth(cursorMs));
  return { startMs, endMs: startMs + 42 * DAY_MS };
}

/** Midnight of every day in the view, in order. Built by DATE arithmetic and not by
 *  adding 86.4e6 — a DST transition makes one local day 23 or 25 hours long, and a
 *  grid built by addition silently draws that day twice or not at all. */
export function calendarGridDays(view: CalendarView, cursorMs: number): readonly number[] {
  const { startMs, endMs } = calendarGridRange(view, cursorMs);
  const days: number[] = [];
  const cursor = new Date(startMs);
  while (cursor.getTime() < endMs) {
    days.push(startOfDay(cursor.getTime()));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/**
 * Move one grain forward (`+1`) or back (`-1`).
 *
 * A month steps by MONTH, so October → November rather than "31 days later", which lands
 * in the wrong month half the year. The date is pinned to the 1st BEFORE the step, which
 * is not a tidy-up: `setMonth` keeps the day number, so 31 January + 1 month is
 * "31 February", which JavaScript rolls forward to 3 March — paging one month forward
 * from the 31st silently skips February. The month grid is built from
 * {@link startOfMonth} anyway, so the cursor's day number carries no information here.
 */
export function shiftCalendarCursor(view: CalendarView, cursorMs: number, delta: number): number {
  const date = new Date(cursorMs);
  if (view === 'day') date.setDate(date.getDate() + delta);
  else if (view === 'week') date.setDate(date.getDate() + delta * 7);
  else {
    date.setDate(1);
    date.setMonth(date.getMonth() + delta);
  }
  return date.getTime();
}

/** Events that touch a window, in order. Half-open on both sides: an event that ends
 *  exactly at midnight belongs to the day it ran in, not to the one after it. */
export function eventsInRange(
  events: readonly CalendarEvent[],
  range: CalendarRange,
): readonly CalendarEvent[] {
  return events
    .filter((event) => calendarEventStart(event) < range.endMs && calendarEventEnd(event) > range.startMs)
    .slice()
    .sort(byStart);
}

/** Events touching one local day, in order. */
export function eventsOnDay(events: readonly CalendarEvent[], dayMs: number): readonly CalendarEvent[] {
  return eventsInRange(events, { startMs: startOfDay(dayMs), endMs: startOfDay(dayMs) + DAY_MS });
}

/** The next event at or after an instant, or nothing. What a card states without being
 *  opened — "the next thing" is the one fact a ~340px calendar can always fit. */
export function nextCalendarEvent(
  events: readonly CalendarEvent[],
  fromMs: number,
): CalendarEvent | undefined {
  return events
    .filter((event) => calendarEventEnd(event) >= fromMs)
    .sort(byStart)[0];
}

// ---------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------

/**
 * Events that collide.
 *
 * "Collide" is same-day and same-CATEGORY, never merely same-day: two emails to one
 * list on one morning is the thing a content calendar exists to catch, and an email
 * plus a sales meeting on the same afternoon is a normal Tuesday. An event with no
 * category cannot collide with anything, because "two unlabelled things happen on
 * Thursday" is a description of Thursday.
 *
 * A SET rather than pairs: every consumer's real question is "is this one in conflict",
 * and returning pairs makes each of them build this set anyway.
 */
export function calendarConflicts(events: readonly CalendarEvent[]): ReadonlySet<string> {
  const byBucket = new Map<string, string[]>();
  for (const event of events) {
    const category = event.category?.trim();
    if (!category) continue;
    // Every day the event covers, so a three-day campaign collides with the send in
    // the middle of it rather than only with one that shares its first morning.
    const last = startOfDay(calendarEventEnd(event) - 1);
    for (let day = startOfDay(calendarEventStart(event)); day <= last; day += DAY_MS) {
      const key = `${category}|${new Date(day).toDateString()}`;
      const bucket = byBucket.get(key);
      if (bucket) bucket.push(event.id); else byBucket.set(key, [event.id]);
    }
  }
  const conflicted = new Set<string>();
  for (const bucket of byBucket.values()) {
    if (bucket.length > 1) for (const id of bucket) conflicted.add(id);
  }
  return conflicted;
}

// ---------------------------------------------------------------------------
// The board as a source
// ---------------------------------------------------------------------------

/**
 * The field that puts a canvas object on a calendar, consulted first and alone.
 *
 * `scheduledAt` says WHEN THIS GOES OUT — a commitment. Everything after it is
 * `DEADLINE_FIELD_NAMES`, deliberately the same list the trigger engine watches
 * (imported, never restated), so a date the board can WARN about is a date the board
 * can also DRAW. A second list here would produce a calendar missing exactly the dates
 * people set alarms on.
 */
export const CALENDAR_PRIMARY_FIELD = 'scheduledAt';

/** A board object as this module needs to see it. Structural, so nothing here depends
 *  on the canvas node type or on a saved row's column names. */
export interface CalendarBoardObject {
  id: string;
  kind: string;
  title?: string | null;
  data: Record<string, unknown>;
}

/**
 * Which channel a canvas kind occupies, for conflict purposes.
 *
 * DERIVED FROM THE KIND'S OWN NAME, not from a hand-maintained table. The table this
 * replaced listed seven kinds by hand, so every dated kind added afterwards silently
 * got no conflict detection at all and no guard noticed — the drift its own comment
 * ("channel is read from the kind because that is where it actually lives") claimed was
 * impossible. A suffix match is honest about what it knows: `emailCampaign` and
 * `emailTemplate` are the email channel BY BEING EMAIL, and a kind whose name says
 * nothing about a channel gets none rather than a guessed one.
 */
const CHANNEL_PREFIXES: readonly (readonly [string, string])[] = [
  ['email', 'email'],
  ['social', 'social'],
  ['sales', 'sales'],
  ['ads', 'ads'],
  ['ad', 'ads'],
  ['blog', 'content'],
  ['website', 'content'],
  ['prototype', 'content'],
  ['deployment', 'deployment'],
  ['release', 'deployment'],
  ['ciRun', 'deployment'],
];

export function calendarCategoryForKind(kind: string): string | undefined {
  const lower = kind.toLowerCase();
  for (const [prefix, channel] of CHANNEL_PREFIXES) {
    if (lower.startsWith(prefix.toLowerCase())) return channel;
  }
  return undefined;
}

/**
 * Every dated object on a board, as events.
 *
 * ── WHY THIS IS A FOLD AND NOT A STORE ───────────────────────────────────────────
 * `socialCampaign`, `emailCampaign` and `salesMeeting` already carry `scheduledAt`, and
 * every spec kind that carries a deadline already declares which field holds it. The
 * dates were never missing — nothing read them together. Copying them onto a calendar
 * object would mean two records of one send, disagreeing the first time somebody moved
 * it. So this projects, and `field` on each event is what lets a drag write back into
 * the field the date came from.
 */
export function boardCalendarEvents(
  board: readonly CalendarBoardObject[],
): readonly CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (const object of board) {
    const scheduled = dateValue(object.data[CALENDAR_PRIMARY_FIELD]);
    const field = scheduled !== null
      ? CALENDAR_PRIMARY_FIELD
      : resolveDeadlineField(object.data, object.data.watchesField);
    const at = scheduled ?? (field ? dateValue(object.data[field]) : null);
    if (at === null || !field) continue;
    const category = calendarCategoryForKind(object.kind);
    const details = typeof object.data.summary === 'string' ? object.data.summary
      : typeof object.data.subtitle === 'string' ? object.data.subtitle : undefined;
    events.push({
      id: `board:${object.id}`,
      ref: object.id,
      sourceId: 'board',
      subject: String(object.title ?? object.data.title ?? '').trim() || object.kind,
      startISO: new Date(at).toISOString(),
      field,
      ...(category ? { category } : {}),
      ...(details ? { details } : {}),
    });
  }
  return events.sort(byStart);
}

/** Objects on a board that carry no date at all. Named rather than counted, for the
 *  reason {@link undatedRows} gives: a calendar that quietly holds fewer things than its
 *  source did is a calendar nobody can trust, and a bare number is not a way back. */
export function undatedBoardObjects(board: readonly CalendarBoardObject[]): readonly UndatedEntry[] {
  const dated = new Set(boardCalendarEvents(board).map((event) => event.ref));
  return board
    .filter((object) => !dated.has(object.id))
    .map((object) => ({
      id: object.id,
      subject: String(object.title ?? object.data.title ?? '').trim() || object.kind,
    }));
}
