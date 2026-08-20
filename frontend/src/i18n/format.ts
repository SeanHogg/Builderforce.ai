/**
 * Locale-correct date, time, number and currency formatting — the ONE place the
 * app turns a value into a human string.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * `next-intl` localizes the *words* on a screen. It does not reach
 * `Date.prototype.toLocaleDateString()` or `Number.prototype.toLocaleString()`,
 * and those two methods, called with **no locale argument**, format in the
 * *runtime's* locale — the browser/OS language, not the language the user picked
 * in the switcher. So a `zh` user on an `en-US` machine read Chinese labels next
 * to `8/19/2026` and `1,234.5`, and no amount of catalog translation ever
 * reached those strings. A handful of call sites were worse: they hardcoded
 * `'en-US'`, which is English for *everyone*, including the user who explicitly
 * chose German.
 *
 * The fix is not "pass `locale` at every call site" — that is the same defect
 * with more typing, and it re-derives the active locale 300 times. It is a
 * single formatter bound to the active locale, built once per locale and shared:
 *
 *   const fmt = useFormat();            // client components
 *   const fmt = await getFormat();      // server components / route handlers
 *   fmt.date(row.createdAt)             // 19 Aug 2026 · 2026年8月19日 · 19.8.2026
 *
 * ── WHY THE `Intl.*` INSTANCES ARE CACHED ───────────────────────────────────
 * Constructing an `Intl.DateTimeFormat` is one of the most expensive things in
 * the platform (it loads and resolves CLDR data). A table rendering 200 rows
 * that each called `toLocaleDateString()` built 200 of them. `formatterFor` keeps
 * one formatter set per locale in a module-level map — bounded by `LOCALES`, so
 * it is a fixed five entries and never a leak — and every render reuses it.
 *
 * Pure and dependency-free on purpose: no React, no `next-intl` import. The two
 * thin binders that DO read the active locale live in `useFormat.ts` (client) and
 * `getFormat.ts` (server), so this module stays usable from tests, workers and
 * non-React code.
 */

import { DEFAULT_LOCALE, type Locale } from './config';

/** Anything a date column can hold: an ISO string, an epoch, or a Date. */
export type DateInput = string | number | Date | null | undefined;

/** Rendered in place of a value that is absent or unparseable. */
export const EMPTY_VALUE = '—';

export interface Formatter {
  /** The locale every method below is bound to. */
  readonly locale: Locale;
  /** Calendar date only — `19 Aug 2026`. */
  date(value: DateInput): string;
  /** Date + clock time — `19 Aug 2026, 14:05`. */
  dateTime(value: DateInput): string;
  /** Clock time only — `14:05`. */
  time(value: DateInput): string;
  /** Long-form date with weekday — for headers, not table cells. */
  dateLong(value: DateInput): string;
  /** Grouped decimal — `1,234.5` / `1.234,5` / `1 234,5`. */
  number(value: number | null | undefined, options?: Intl.NumberFormatOptions): string;
  /** Minor-unit-aware currency — pass MAJOR units (dollars, not cents). */
  currency(value: number | null | undefined, currency?: string, options?: Intl.NumberFormatOptions): string;
  /**
   * A money figure for a dashboard: no trailing `.00` on a whole amount, at most
   * two decimals otherwise. The shape a dozen hand-rolled `$${n.toLocaleString(…)}`
   * helpers were each reaching for, stated once.
   */
  money(value: number | null | undefined, currency?: string): string;
  /** `0`–`1` as a percentage. */
  percent(value: number | null | undefined, fractionDigits?: number): string;
  /** `in 3 days` / `vor 2 Stunden`, relative to `now`. */
  relative(value: DateInput, now?: Date): string;
  /** Raw access when a call site genuinely needs a one-off option set. */
  dateWith(value: DateInput, options: Intl.DateTimeFormatOptions): string;
}

interface FormatterSet {
  date: Intl.DateTimeFormat;
  dateTime: Intl.DateTimeFormat;
  time: Intl.DateTimeFormat;
  dateLong: Intl.DateTimeFormat;
  number: Intl.NumberFormat;
  relative: Intl.RelativeTimeFormat;
}

/**
 * One formatter set per locale. Bounded by `LOCALES` (five entries), so this is a
 * fixed-size table rather than an unbounded cache — see the header note on why
 * per-call `Intl` construction is the thing being avoided.
 */
const sets = new Map<Locale, FormatterSet>();
/** Option-specific formatters, keyed by locale + a stable serialization of the options. */
const adHoc = new Map<string, Intl.DateTimeFormat | Intl.NumberFormat>();

function setFor(locale: Locale): FormatterSet {
  const existing = sets.get(locale);
  if (existing) return existing;
  const built: FormatterSet = {
    date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }),
    dateTime: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    time: new Intl.DateTimeFormat(locale, { timeStyle: 'short' }),
    dateLong: new Intl.DateTimeFormat(locale, { dateStyle: 'full' }),
    number: new Intl.NumberFormat(locale),
    relative: new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }),
  };
  sets.set(locale, built);
  return built;
}

function dateTimeWith(locale: Locale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `d:${locale}:${JSON.stringify(options)}`;
  const hit = adHoc.get(key);
  if (hit) return hit as Intl.DateTimeFormat;
  const built = new Intl.DateTimeFormat(locale, options);
  adHoc.set(key, built);
  return built;
}

function numberWith(locale: Locale, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `n:${locale}:${JSON.stringify(options)}`;
  const hit = adHoc.get(key);
  if (hit) return hit as Intl.NumberFormat;
  const built = new Intl.NumberFormat(locale, options);
  adHoc.set(key, built);
  return built;
}

/**
 * Coerce whatever a column holds into a Date, or null when it cannot be one.
 *
 * Returning null rather than throwing is deliberate: a malformed timestamp in one
 * row must render an em dash, not blank the table with an exception — which is
 * exactly what the hand-rolled `Number.isNaN(d.getTime()) ? '—' : …` guards that
 * this replaces were doing, one file at a time.
 */
function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['week', 604_800_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
  ['second', 1000],
];

/**
 * The formatter bound to `locale`. Cached, so calling this per render is free.
 *
 * Exported for non-React callers (tests, workers, plain modules). React code
 * should use `useFormat()` / `getFormat()`, which resolve the ACTIVE locale
 * rather than making each call site name one — naming one is how `'en-US'` got
 * hardcoded in the first place.
 */
export function formatterFor(locale: Locale = DEFAULT_LOCALE): Formatter {
  const s = setFor(locale);
  const fmtDate = (value: DateInput, f: Intl.DateTimeFormat): string => {
    const d = toDate(value);
    return d ? f.format(d) : EMPTY_VALUE;
  };
  return {
    locale,
    date: (value) => fmtDate(value, s.date),
    dateTime: (value) => fmtDate(value, s.dateTime),
    time: (value) => fmtDate(value, s.time),
    dateLong: (value) => fmtDate(value, s.dateLong),
    dateWith: (value, options) => fmtDate(value, dateTimeWith(locale, options)),
    number: (value, options) => {
      if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE;
      return options ? numberWith(locale, options).format(value) : s.number.format(value);
    },
    currency: (value, currency = 'USD', options) => {
      if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE;
      return numberWith(locale, { ...options, style: 'currency', currency }).format(value);
    },
    money: (value, currency = 'USD') => {
      if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE;
      return numberWith(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(value);
    },
    percent: (value, fractionDigits = 0) => {
      if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE;
      return numberWith(locale, {
        style: 'percent',
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      }).format(value);
    },
    relative: (value, now) => {
      const d = toDate(value);
      if (!d) return EMPTY_VALUE;
      const delta = d.getTime() - (now ? now.getTime() : Date.now());
      const magnitude = Math.abs(delta);
      for (const [unit, ms] of RELATIVE_UNITS) {
        if (magnitude >= ms) return s.relative.format(Math.round(delta / ms), unit);
      }
      return s.relative.format(0, 'second');
    },
  };
}
