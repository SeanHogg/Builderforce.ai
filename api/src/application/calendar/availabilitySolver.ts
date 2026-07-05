/**
 * Availability + "find a time" solver. Given each attendee's declared weekly
 * availability windows (in their own timezone) and their busy blocks (existing
 * meetings), propose meeting slots where EVERYONE is both free and within a
 * declared window. Timezone-correct via Intl (a window is expressed in the
 * owner's local time; a candidate UTC instant is projected into that zone).
 */

/** A weekly recurring availability window. day: 0=Sun..6=Sat; start/end in minutes from local midnight. */
export interface AvailabilityWindow { day: number; start: number; end: number; }
export interface Availability { userId: string; timezone: string; windows: AvailabilityWindow[]; }
/** A busy interval as epoch-ms [start, end). */
export interface BusyInterval { start: number; end: number; }

/** Local weekday (0=Sun) + minutes-from-midnight of `instant` in `timezone`. */
function localParts(instant: number, timezone: string): { day: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(new Date(instant));
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  let hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  if (hour === 24) hour = 0; // some engines emit "24" for midnight
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  const DAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { day: DAYS[wd] ?? 0, minutes: hour * 60 + minute };
}

/** Is the whole slot [startMs, endMs) inside one of the user's windows? No windows = available anytime. */
export function withinWindows(startMs: number, endMs: number, avail: Availability): boolean {
  if (!avail.windows || avail.windows.length === 0) return true;
  const s = localParts(startMs, avail.timezone);
  const e = localParts(endMs - 1, avail.timezone); // inclusive end minute
  if (s.day !== e.day) return false; // spans local midnight — reject (keep it simple/correct)
  return avail.windows.some((w) => w.day === s.day && s.minutes >= w.start && e.minutes < w.end);
}

/** Does [startMs,endMs) overlap any busy interval? */
export function isBusy(startMs: number, endMs: number, busy: BusyInterval[]): boolean {
  return busy.some((b) => startMs < b.end && endMs > b.start);
}

export interface SuggestOptions {
  fromMs: number;
  toMs: number;
  durationMinutes: number;
  /** Candidate cadence (default 30 min). */
  stepMinutes?: number;
  /** Max slots to return (default 6). */
  count?: number;
}

/** Propose up to `count` slots where every attendee is free AND within a window. */
export function suggestSlots(
  attendees: Availability[],
  busyByUser: Map<string, BusyInterval[]>,
  opts: SuggestOptions,
): Array<{ startISO: string; endISO: string }> {
  const step = (opts.stepMinutes ?? 30) * 60_000;
  const durationMs = opts.durationMinutes * 60_000;
  const count = opts.count ?? 6;
  const out: Array<{ startISO: string; endISO: string }> = [];

  // Align the first candidate up to the next step boundary.
  let start = Math.ceil(opts.fromMs / step) * step;
  const hardStop = opts.toMs;
  let guard = 0;
  while (start + durationMs <= hardStop && out.length < count && guard < 5000) {
    guard++;
    const end = start + durationMs;
    const everyoneOk = attendees.every((a) =>
      withinWindows(start, end, a) && !isBusy(start, end, busyByUser.get(a.userId) ?? []),
    );
    if (everyoneOk) out.push({ startISO: new Date(start).toISOString(), endISO: new Date(end).toISOString() });
    start += step;
  }
  return out;
}

/** Coerce arbitrary JSON into a clean window list (defensive: DB stores JSONB). */
export function normalizeWindows(raw: unknown): AvailabilityWindow[] {
  if (!Array.isArray(raw)) return [];
  const out: AvailabilityWindow[] = [];
  for (const w of raw) {
    if (!w || typeof w !== 'object') continue;
    const day = Number((w as Record<string, unknown>).day);
    const s = Number((w as Record<string, unknown>).start);
    const e = Number((w as Record<string, unknown>).end);
    if (Number.isInteger(day) && day >= 0 && day <= 6 && s >= 0 && e > s && e <= 1440) {
      out.push({ day, start: s, end: e });
    }
  }
  return out;
}
