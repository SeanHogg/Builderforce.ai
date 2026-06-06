/**
 * Cron parsing + next-run computation for scheduled workflow triggers.
 *
 * Standard 5-field cron: `minute hour day-of-month month day-of-week`.
 *   minute       0-59
 *   hour         0-23
 *   day-of-month 1-31
 *   month        1-12
 *   day-of-week  0-6   (0 = Sunday; 7 is accepted as Sunday too)
 *
 * Each field supports `*`, step (`star-slash-n`), `a-b`, `a-b/n`, and comma
 * lists of those. Per POSIX cron, when BOTH day-of-month and day-of-week are restricted
 * (neither is `*`), a tick matches if EITHER field matches.
 *
 * `nextCronTime` is evaluated against a target IANA timezone (default UTC). The
 * wall-clock fields of each candidate are read in that zone via `Intl`, and the
 * matching wall-clock instant is converted back to a UTC `Date`. There is no
 * external dependency — this runs unchanged on the Cloudflare Workers runtime.
 *
 * Resolution note: the scheduler tick that consumes `nextCronTime` runs on a
 * coarse interval (see wrangler `[triggers] crons`), so schedules finer than
 * that interval are coalesced to it — `nextCronTime` itself is exact to the
 * minute.
 */

export interface ParsedCron {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
  /** True when day-of-month and day-of-week are both restricted (OR semantics). */
  domRestricted: boolean;
  dowRestricted: boolean;
}

/** Parse one cron field into the sorted, de-duplicated set of allowed values. */
export function parseCronField(raw: string, min: number, max: number): number[] {
  const out = new Set<number>();
  for (const part of raw.split(',')) {
    const token = part.trim();
    if (!token) throw new Error(`Empty cron field segment in "${raw}"`);

    let range = token;
    let step = 1;
    const slash = token.indexOf('/');
    if (slash !== -1) {
      range = token.slice(0, slash);
      step = Number(token.slice(slash + 1));
      if (!Number.isInteger(step) || step <= 0) throw new Error(`Invalid step in "${token}"`);
    }

    let lo: number;
    let hi: number;
    if (range === '*') {
      lo = min;
      hi = max;
    } else if (range.includes('-')) {
      const [a, b] = range.split('-');
      lo = Number(a);
      hi = Number(b);
    } else {
      lo = Number(range);
      hi = lo;
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) throw new Error(`Invalid cron value in "${token}"`);
    if (lo < min || hi > max || lo > hi) throw new Error(`Cron value out of range [${min},${max}] in "${token}"`);

    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}

/** Parse a 5-field cron expression. Throws on malformed input. */
export function parseCron(expr: string): ParsedCron {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`Cron must have 5 fields, got ${fields.length}: "${expr}"`);

  const [m, h, dom, mon, dowRaw] = fields as [string, string, string, string, string];
  // Normalize day-of-week 7 → 0 (both mean Sunday) before parsing the range.
  const daysOfWeek = parseCronField(dowRaw, 0, 7).map((d) => (d === 7 ? 0 : d));

  return {
    minutes: parseCronField(m, 0, 59),
    hours: parseCronField(h, 0, 23),
    daysOfMonth: parseCronField(dom, 1, 31),
    months: parseCronField(mon, 1, 12),
    daysOfWeek: [...new Set(daysOfWeek)].sort((a, b) => a - b),
    domRestricted: dom.trim() !== '*',
    dowRestricted: dowRaw.trim() !== '*',
  };
}

/** Whether a cron expression parses without error. */
export function isValidCron(expr: string): boolean {
  try {
    parseCron(expr);
    return true;
  } catch {
    return false;
  }
}

interface WallClock {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  weekday: number; // 0=Sun .. 6=Sat
}

const PART_FORMAT: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  weekday: 'short',
};

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/** Read the wall-clock fields of a UTC instant as they appear in `tz`. */
function wallClockInZone(utc: Date, tz: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', { ...PART_FORMAT, timeZone: tz }).formatToParts(utc);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  // `hour` can come back as "24" at midnight in some engines — normalize to 0.
  const hour = Number(get('hour')) % 24;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour,
    minute: Number(get('minute')),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
  };
}

/**
 * Convert a wall-clock time in `tz` to the corresponding UTC instant.
 * Uses the standard offset-probe: guess the instant as if the fields were UTC,
 * see what wall-clock that maps to in `tz`, and correct by the difference.
 */
function zonedWallClockToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const mapped = wallClockInZone(new Date(guess), tz);
  const mappedAsUtc = Date.UTC(mapped.year, mapped.month - 1, mapped.day, mapped.hour, mapped.minute);
  const offset = mappedAsUtc - guess;
  return new Date(guess - offset);
}

function dayOfWeekMatches(cron: ParsedCron, weekday: number): boolean {
  return cron.daysOfWeek.includes(weekday);
}

function dayMatches(cron: ParsedCron, wc: WallClock): boolean {
  const domOk = cron.daysOfMonth.includes(wc.day);
  const dowOk = dayOfWeekMatches(cron, wc.weekday);
  // POSIX: both restricted → OR; otherwise the unrestricted field is `*` (always true).
  if (cron.domRestricted && cron.dowRestricted) return domOk || dowOk;
  return domOk && dowOk;
}

/**
 * Compute the next UTC instant strictly after `after` that matches `expr` in
 * timezone `tz`. Returns `null` if no match within ~5 years (e.g. an impossible
 * date like Feb 31). Scans day-by-day (bounded), then the matching hour/minute
 * within each candidate day — far cheaper than minute-stepping a whole year.
 */
export function nextCronTime(expr: string, after: Date, tz = 'UTC'): Date | null {
  const cron = parseCron(expr);
  // Start probing from the minute after `after`, in zone wall-clock.
  const startWc = wallClockInZone(new Date(after.getTime() + 60_000), tz);

  // Walk candidate calendar days in the zone using a UTC-noon anchor (noon
  // avoids DST midnight gaps shifting the calendar date).
  let dayAnchor = Date.UTC(startWc.year, startWc.month - 1, startWc.day, 12, 0);
  const MAX_DAYS = 366 * 5;

  for (let i = 0; i < MAX_DAYS; i++) {
    const dayWc = wallClockInZone(new Date(dayAnchor), tz);
    if (cron.months.includes(dayWc.month) && dayMatches(cron, dayWc)) {
      for (const h of cron.hours) {
        for (const mi of cron.minutes) {
          const candidate = zonedWallClockToUtc(dayWc.year, dayWc.month, dayWc.day, h, mi, tz);
          if (candidate.getTime() > after.getTime()) return candidate;
        }
      }
    }
    dayAnchor += 24 * 60 * 60 * 1000;
  }
  return null;
}
