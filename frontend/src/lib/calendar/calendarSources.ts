import {
  boardCalendarEvents,
  calendarCategoryForKind,
  normalizeCalendarEvents,
  undatedRows,
  undatedBoardObjects,
  type CalendarBoardObject,
  type CalendarEvent,
  type UndatedEntry,
} from '@builderforce/creation-canvas-contract';
import { calendarApi, meetingsApi, pmoApi, releasesApi, tasksApi } from '@/lib/builderforceApi';
import { getOrSetClientCached, invalidateClientCache } from '@/infrastructure/http/readThrough';

/**
 * WHERE A CALENDAR'S DATES COME FROM — the registry that turned a modality into an object.
 *
 * ── THE THING THIS FIXES ─────────────────────────────────────────────────────────
 * The month used to be a canvas surface with its reading COMPILED IN: "every dated
 * object on this board", and nothing else was reachable. Meetings, releases, tasks,
 * public holidays and a connected Google account are all dates that already existed in
 * this product, and not one of them could be drawn, because the reading was a fact
 * about the code rather than a value on a card.
 *
 * A source is DATA here, exactly as an object kind is data in `specObjects.ts` and a
 * surface is data in `canvasSurfaces.ts`. Adding an eighth is an entry in the array
 * below plus five catalog strings. Nothing branches on a source id: the consumer reads
 * `create`/`update`/`remove` being present or absent, which is also how a read-only
 * reading (a connected calendar you may not write) refuses without a second permission
 * flag to keep in step.
 *
 * ── WHY THE ADAPTER OWNS THE DATE CONVERSION ─────────────────────────────────────
 * A form hands back what a person typed, in their own zone, with no zone marker
 * ({@link CalendarEventDraft}). What that MEANS differs per store: a meeting is an
 * instant, a public holiday is a `YYYY-MM-DD` with no time in it at all, a task's due
 * date is a plain date, and a canvas object stores whatever field the date came from.
 * Converting once per adapter is what stops the form from shifting an event by the
 * reader's UTC offset — the exact defect `lib/calendarDate.ts` already exists to
 * prevent one layer down.
 *
 * ── LAYERING, AND WHY THIS IS NOT IN `components/` ───────────────────────────────
 * These are application ports: they call the typed API clients and the read-through
 * cache, and never a route or a table. That is also why they live under `lib/` and not
 * beside the component they serve — a module under `components/` may not import
 * `@/infrastructure/`, and the architecture ratchet says so out loud. The dependency
 * runs one way: the calendar components import this, and this imports no component.
 *
 * Every remote read goes through the browser's ONE read-through cache and every write
 * invalidates its own prefix — a calendar that refetched a month per keystroke would be
 * the N+1 this codebase's caching rule names.
 */

/**
 * WHAT AN EVENT LOOKS LIKE WHILE IT IS BEING WRITTEN — browser-local form values.
 *
 * Deliberately NOT a `CalendarEvent`. An event's `startISO` is an instant (or a whole
 * day); an `<input type="datetime-local">` holds `YYYY-MM-DDTHH:mm` in the reader's own
 * zone with no zone marker at all. Reusing one type for both is how a form round-trip
 * comes to shift an event by the reader's UTC offset every time it is saved — the class
 * of bug `lib/calendarDate.ts` already exists to prevent one layer down.
 *
 * It is declared HERE, beside the adapters, because converting a draft into something a
 * store will accept is their job: only the adapter knows whether its store wants an
 * instant, a plain date, or a duration in minutes.
 */
export interface CalendarEventDraft {
  subject: string;
  details: string;
  /** `YYYY-MM-DD` when `allDay`, else `YYYY-MM-DDTHH:mm` — browser-local, no zone. */
  startISO: string;
  endISO?: string;
  allDay: boolean;
  category?: string;
  location?: string;
}

export type CalendarSourceId =
  | 'own' | 'board' | 'meetings' | 'tasks' | 'releases' | 'holidays' | 'connected';

export const DEFAULT_CALENDAR_SOURCE: CalendarSourceId = 'own';

/** The window a read is asked for. Half-open, in epoch ms. */
export interface CalendarSourceRange { startMs: number; endMs: number }

/**
 * Everything a source may need that is not the range.
 *
 * Narrow on purpose: a source that needed more than this would be a source that knows
 * about its host, and the whole point is that the same registry serves a canvas card, a
 * full-screen surface, and anything else with dates.
 */
export interface CalendarSourceContext {
  /** Events authored on the calendar object itself — the `own` source's whole store. */
  ownRows?: unknown;
  /** Persist the authored rows. Absent on a read-only board, which is what makes the
   *  `own` source refuse to write rather than pretending to. */
  writeOwnRows?: (rows: readonly Record<string, unknown>[]) => void;
  /** The board this calendar sits on. Only `board` reads it, and its absence is what
   *  hides that source off-canvas rather than showing one that can never resolve. */
  board?: readonly CalendarBoardObject[];
  /** Move a dated board object by writing back into the FIELD its date came from. */
  writeBoardObject?: (nodeId: string, field: string, iso: string) => void;
  /** Scope for the sources that have one. Null means the whole workspace. */
  projectId?: number | null;
}

export interface CalendarSourceDefinition {
  id: CalendarSourceId;
  /** Needs a board in context; offered only where one exists. */
  needsBoard?: boolean;
  read(range: CalendarSourceRange, context: CalendarSourceContext): Promise<readonly CalendarEvent[]>;
  /** Things the source holds that carry no usable date. NAMED, never silently dropped —
   *  a bare count gives a planner no way to reach the item that needs a date. */
  undated?(context: CalendarSourceContext): readonly UndatedEntry[];
  create?(draft: CalendarEventDraft, context: CalendarSourceContext): Promise<void>;
  update?(event: CalendarEvent, draft: CalendarEventDraft, context: CalendarSourceContext): Promise<void>;
  remove?(event: CalendarEvent, context: CalendarSourceContext): Promise<void>;
}

// ---------------------------------------------------------------------------
// Draft → stored
// ---------------------------------------------------------------------------

/** A browser-local form value as an ISO INSTANT. `YYYY-MM-DDTHH:mm` has no zone, so
 *  `new Date()` reads it as local — which is what the person meant when they typed it. */
export function draftInstantISO(value: string): string {
  const parsed = new Date(value.length <= 10 ? `${value}T00:00` : value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}

/** A form value as a plain calendar DATE. Sliced, never converted through UTC: a
 *  holiday typed as the 25th is the 25th, whatever the reader's offset is. */
export function draftDateOnly(value: string): string {
  return value.slice(0, 10);
}

function eventRef(event: CalendarEvent): string {
  return event.ref ?? event.id.split(':').slice(1).join(':') ?? event.id;
}

// ---------------------------------------------------------------------------
// The sources
// ---------------------------------------------------------------------------

/** How long a remote reading stays warm. Long enough that paging a month back and
 *  forward is free, short enough that a meeting booked elsewhere shows up. */
const READ_TTL_MS = 60_000;

const CACHE_PREFIX = 'calendar:';

function invalidate(sourceId: CalendarSourceId): void {
  invalidateClientCache(`${CACHE_PREFIX}${sourceId}`);
}

const OWN_SOURCE: CalendarSourceDefinition = {
  id: 'own',
  // The default, and the only one that stores what it shows. Holidays somebody types by
  // hand, an on-call rota, a conference schedule — anything with no system of record
  // behind it yet. Everything else on this list PROJECTS a store that already exists.
  read: async (_range, context) => normalizeCalendarEvents(context.ownRows)
    .map((event) => ({ ...event, sourceId: 'own', ref: event.id })),
  undated: (context) => undatedRows(context.ownRows),
  create: async (draft, context) => {
    if (!context.writeOwnRows) return;
    context.writeOwnRows([...ownRows(context), rowFromDraft(draft, cryptoId())]);
  },
  update: async (event, draft, context) => {
    if (!context.writeOwnRows) return;
    context.writeOwnRows(ownRows(context).map((row) => (
      String(row.id ?? '') === eventRef(event) ? rowFromDraft(draft, eventRef(event)) : row
    )));
  },
  remove: async (event, context) => {
    if (!context.writeOwnRows) return;
    context.writeOwnRows(ownRows(context).filter((row) => String(row.id ?? '') !== eventRef(event)));
  },
};

function ownRows(context: CalendarSourceContext): Record<string, unknown>[] {
  return Array.isArray(context.ownRows)
    ? context.ownRows.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    : [];
}

function rowFromDraft(draft: CalendarEventDraft, id: string): Record<string, unknown> {
  return {
    id,
    subject: draft.subject,
    ...(draft.details ? { details: draft.details } : {}),
    startISO: draft.allDay ? draftDateOnly(draft.startISO) : draftInstantISO(draft.startISO),
    ...(draft.endISO && !draft.allDay ? { endISO: draftInstantISO(draft.endISO) } : {}),
    ...(draft.category ? { category: draft.category } : {}),
    ...(draft.location ? { location: draft.location } : {}),
    allDay: draft.allDay,
  };
}

/** An id for a row a person just created. `randomUUID` where it exists, and a
 *  timestamp-plus-counter where it does not — an id collision here would make two
 *  events edit each other, which is worse than an ugly id. */
let sequence = 0;
function cryptoId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  sequence += 1;
  return `evt-${Date.now().toString(36)}-${sequence}`;
}

const BOARD_SOURCE: CalendarSourceDefinition = {
  id: 'board',
  needsBoard: true,
  // The reading the old surface had, now one of several. It owns no dates: a card's
  // `scheduledAt` (or whichever deadline field its kind declares) IS the event, so
  // moving it here moves it on the card and re-arms any trigger watching that field.
  read: async (_range, context) => boardCalendarEvents(context.board ?? []),
  undated: (context) => undatedBoardObjects(context.board ?? []),
  update: async (event, draft, context) => {
    if (!context.writeBoardObject || !event.field || !event.ref) return;
    context.writeBoardObject(event.ref, event.field, draftInstantISO(draft.startISO));
  },
  // No create and no remove, deliberately: a board event IS a card, and minting or
  // destroying a card from a date cell would be the calendar deciding what belongs on
  // somebody's canvas. Moving one is the edit a month view legitimately owns.
};

const MEETINGS_SOURCE: CalendarSourceDefinition = {
  id: 'meetings',
  read: async (range, context) => {
    const projectKey = context.projectId ?? 'all';
    const { meetings } = await getOrSetClientCached(
      `${CACHE_PREFIX}meetings:${projectKey}`,
      () => meetingsApi.list({ scope: 'all', ...(context.projectId ? { projectId: context.projectId } : {}) }),
      { ttlMs: READ_TTL_MS, staleWhileRevalidate: true },
    );
    // `list` returns the DETAIL shape — a meeting plus its attendees — so the row is
    // unwrapped here rather than by every consumer of this source.
    return meetings
      .map((detail) => detail.meeting)
      .filter((meeting) => meeting.scheduledAt)
      .map((meeting) => {
        const startMs = new Date(meeting.scheduledAt!).getTime();
        const minutes = meeting.durationMinutes || 30;
        return {
          id: `meetings:${meeting.id}`,
          ref: meeting.id,
          sourceId: 'meetings',
          subject: meeting.title,
          startISO: new Date(startMs).toISOString(),
          endISO: new Date(startMs + minutes * 60_000).toISOString(),
          category: 'meeting',
          ...(meeting.description ? { details: meeting.description } : {}),
          // A cancelled meeting still occupies the slot it was booked in — it is
          // readable history, and offering to re-time it would resurrect it.
          ...(meeting.status === 'cancelled' ? { readOnly: true } : {}),
        } satisfies CalendarEvent;
      })
      .filter((event) => new Date(event.startISO).getTime() < range.endMs
        && new Date(event.endISO!).getTime() > range.startMs);
  },
  create: async (draft) => {
    await meetingsApi.create({
      title: draft.subject,
      scheduledAt: draftInstantISO(draft.startISO),
      durationMinutes: minutesBetween(draft) ?? 30,
    });
    invalidate('meetings');
  },
  update: async (event, draft) => {
    await meetingsApi.patch(eventRef(event), {
      title: draft.subject,
      scheduledAt: draftInstantISO(draft.startISO),
      ...(minutesBetween(draft) !== undefined ? { durationMinutes: minutesBetween(draft)! } : {}),
    });
    invalidate('meetings');
  },
  // Cancelling, not deleting. A meeting other people were invited to has attendance and
  // a transcript hanging off it; the API's own verb is `cancel` and there is no second
  // one that removes the row.
  remove: async (event) => {
    await meetingsApi.cancel(eventRef(event));
    invalidate('meetings');
  },
};

function minutesBetween(draft: CalendarEventDraft): number | undefined {
  if (!draft.endISO || draft.allDay) return undefined;
  const minutes = Math.round(
    (new Date(draftInstantISO(draft.endISO)).getTime() - new Date(draftInstantISO(draft.startISO)).getTime()) / 60_000,
  );
  return minutes > 0 ? minutes : undefined;
}

const TASKS_SOURCE: CalendarSourceDefinition = {
  id: 'tasks',
  read: async (_range, context) => {
    const projectKey = context.projectId ?? 'all';
    const tasks = await getOrSetClientCached(
      `${CACHE_PREFIX}tasks:${projectKey}`,
      () => tasksApi.list(context.projectId ?? undefined),
      { ttlMs: READ_TTL_MS, staleWhileRevalidate: true },
    );
    return tasks
      .filter((task) => task.dueDate || task.startDate)
      .map((task) => ({
        id: `tasks:${task.id}`,
        ref: String(task.id),
        sourceId: 'tasks',
        subject: task.title,
        // A task that carries both dates is a SPAN — what is in flight on the 14th, not
        // only what lands on it. One that carries a due date alone is a one-day span,
        // so nothing that used to appear stops appearing.
        startISO: (task.startDate ?? task.dueDate)!.slice(0, 10),
        ...(task.dueDate ? { endISO: task.dueDate.slice(0, 10) } : {}),
        allDay: true,
        category: task.taskType,
        ...(task.description ? { details: task.description } : {}),
      } satisfies CalendarEvent));
  },
  update: async (event, draft) => {
    await tasksApi.update(Number(eventRef(event)), { dueDate: draftDateOnly(draft.startISO) });
    invalidate('tasks');
  },
  // No create: a ticket minted from a date cell would have no project, no lane and no
  // owner, which is three decisions the board makes and a calendar cannot.
};

const RELEASES_SOURCE: CalendarSourceDefinition = {
  id: 'releases',
  // "Deployments" as a reading: what ships, and when. Read-only here because a release
  // date is moved on the release plan, where the scope that justifies the move is.
  read: async () => {
    const releases = await getOrSetClientCached(
      `${CACHE_PREFIX}releases`,
      () => releasesApi.list(),
      { ttlMs: READ_TTL_MS, staleWhileRevalidate: true },
    );
    return releases
      .filter((release) => release.releaseDate)
      .map((release) => ({
        id: `releases:${release.id}`,
        ref: release.id,
        sourceId: 'releases',
        subject: release.version ? `${release.name} ${release.version}` : release.name,
        startISO: release.releaseDate!.slice(0, 10),
        allDay: true,
        category: 'deployment',
        ...(release.notes ? { details: release.notes } : {}),
        readOnly: true,
      } satisfies CalendarEvent));
  },
};

const HOLIDAYS_SOURCE: CalendarSourceDefinition = {
  id: 'holidays',
  // The tenant's non-working days — the one source whose whole store is already a list
  // of `{date, name}`, which is this shape with two of the fields renamed.
  read: async () => {
    const calendar = await getOrSetClientCached(
      `${CACHE_PREFIX}holidays`,
      () => pmoApi.workingCalendar(),
      { ttlMs: READ_TTL_MS, staleWhileRevalidate: true },
    );
    return calendar.holidays.map((holiday) => ({
      id: `holidays:${holiday.date}`,
      ref: holiday.date,
      sourceId: 'holidays',
      subject: holiday.name,
      startISO: holiday.date,
      allDay: true,
      category: 'holiday',
    } satisfies CalendarEvent));
  },
  create: async (draft) => { await writeHolidays((current) => [...current, { date: draftDateOnly(draft.startISO), name: draft.subject }]); },
  update: async (event, draft) => {
    await writeHolidays((current) => current.map((holiday) => (
      holiday.date === eventRef(event) ? { date: draftDateOnly(draft.startISO), name: draft.subject } : holiday
    )));
  },
  remove: async (event) => {
    await writeHolidays((current) => current.filter((holiday) => holiday.date !== eventRef(event)));
  },
};

/** Read-modify-write the working calendar. The whole settings object is the unit the
 *  API takes, so a write must not drop the working week beside the holiday it edits —
 *  which is what a blind PUT of `{holidays}` alone would do. */
async function writeHolidays(
  change: (current: readonly { date: string; name: string }[]) => { date: string; name: string }[],
): Promise<void> {
  const current = await pmoApi.workingCalendar();
  await pmoApi.saveWorkingCalendar({
    workingWeekdays: current.workingWeekdays,
    holidays: change(current.holidays),
    timezone: current.timezone,
  });
  invalidate('holidays');
}

const CONNECTED_SOURCE: CalendarSourceDefinition = {
  id: 'connected',
  // The reader's own Google / Microsoft calendar, through the connections they already
  // authorised. Read-only: writing into somebody's external calendar is a separate
  // consent from reading it, and the connector does not carry it.
  read: async (range) => {
    // The endpoint takes a DAY COUNT from now, so the key is bucketed by that count
    // rather than by the exact window — otherwise every pan would miss the cache.
    const days = Math.min(90, Math.max(14, Math.ceil((range.endMs - Date.now()) / 86_400_000)));
    const { events } = await getOrSetClientCached(
      `${CACHE_PREFIX}connected:${days}`,
      () => calendarApi.events(days),
      { ttlMs: READ_TTL_MS, staleWhileRevalidate: true },
    );
    return events.map((event) => ({
      id: `connected:${event.id}`,
      ref: event.id,
      sourceId: 'connected',
      subject: event.title,
      startISO: event.startISO,
      endISO: event.endISO,
      category: event.provider,
      ...(event.location ? { location: event.location } : {}),
      ...(event.htmlLink ? { url: event.htmlLink } : {}),
      ...(event.organizer ? { details: event.organizer } : {}),
      readOnly: true,
    } satisfies CalendarEvent));
  },
};

/** Declaration order is the order the picker offers them. */
export const CALENDAR_SOURCES: readonly CalendarSourceDefinition[] = [
  OWN_SOURCE, BOARD_SOURCE, MEETINGS_SOURCE, TASKS_SOURCE, RELEASES_SOURCE, HOLIDAYS_SOURCE, CONNECTED_SOURCE,
];

const BY_ID = new Map<CalendarSourceId, CalendarSourceDefinition>(
  CALENDAR_SOURCES.map((source) => [source.id, source]),
);

/** The source's rules. Falls back to the authored one rather than throwing, so a stale
 *  stored id degrades to the calendar's own events instead of a blank grid. */
export function calendarSource(id: CalendarSourceId): CalendarSourceDefinition {
  return BY_ID.get(id) ?? BY_ID.get(DEFAULT_CALENDAR_SOURCE)!;
}

export function isCalendarSourceId(value: unknown): value is CalendarSourceId {
  return typeof value === 'string' && BY_ID.has(value as CalendarSourceId);
}

export function sanitizeCalendarSourceId(value: unknown): CalendarSourceId {
  return isCalendarSourceId(value) ? value : DEFAULT_CALENDAR_SOURCE;
}

/** The sources this host can actually resolve. A board source with no board is not
 *  offered, rather than offered and then empty — the picker reads this instead of each
 *  consumer filtering on `needsBoard` itself. */
export function calendarSourcesFor(context: CalendarSourceContext): readonly CalendarSourceDefinition[] {
  return CALENDAR_SOURCES.filter((source) => !source.needsBoard || Boolean(context.board));
}

/** Re-exported so a consumer that only needs the board category (a canvas node drawing
 *  a preview) does not import the contract twice. */
export { calendarCategoryForKind };
