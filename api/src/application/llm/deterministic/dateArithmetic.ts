/**
 * Calendar arithmetic without a model (cost lever D7):
 *   "what day is 30 days from today" · "what date was 2 weeks before 2026-03-01"
 *   "what day of the week is 2026-12-25" · "how many days between 2026-01-01 and 2026-03-01"
 *   "how many days until december 25, 2026"
 *
 * Conservative by construction:
 *   • dates are ISO (2026-12-25) or have a month NAME and a year (December 25, 2026 /
 *     25 December 2026) — never 03/04/2026, whose day and month depend on the reader;
 *   • offsets are days or weeks — never months or years ("Jan 31 + 1 month" has no
 *     single answer);
 *   • "today" is the UTC calendar date, and an answer relative to it says so, because
 *     the gateway does not know the asker's time zone;
 *   • an impossible date (2026-02-30) declines.
 */

import { normalizeQuestion, type DeterministicAnswer, type DeterministicHandler } from './types';

const DAY_MS = 86_400_000;
const MAX_OFFSET_DAYS = 36_500;

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_RE = `(?:${MONTHS.join('|')}|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)`;
const DATE_RE = `(\\d{4}-\\d{2}-\\d{2}|${MONTH_RE}\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}|\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH_RE},?\\s+\\d{4})`;
const ANCHOR_RE = `(today|now|tomorrow|yesterday|${DATE_RE.slice(1, -1)})`;

const LONG_DATE = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
const WEEKDAY = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' });
const DATE_ONLY = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' });

/** UTC midnight of `y-m-d`, or null when that calendar date does not exist. */
function utcDate(y: number, m: number, d: number): number | null {
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  return back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d ? t : null;
}

function monthIndex(name: string): number | null {
  const i = MONTHS.findIndex((m) => m === name || m.startsWith(name === 'sept' ? 'sep' : name));
  return i >= 0 && name.length >= 3 ? i + 1 : null;
}

/** Parse an unambiguous written date to UTC midnight, or null. */
export function parseCalendarDate(text: string): number | null {
  const s = text.trim().replace(/(\d)(?:st|nd|rd|th)\b/, '$1').replace(',', '');
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return utcDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const monthFirst = /^([a-z]+)\s+(\d{1,2})\s+(\d{4})$/.exec(s);
  const dayFirst = /^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/.exec(s);
  const [month, day, year]: [number | null, number, number] = monthFirst
    ? [monthIndex(monthFirst[1]!), Number(monthFirst[2]), Number(monthFirst[3])]
    : dayFirst
      ? [monthIndex(dayFirst[2]!), Number(dayFirst[1]), Number(dayFirst[3])]
      : [null, 0, 0];
  return month === null ? null : utcDate(year, month, day);
}

const todayUtc = (now: Date): number => Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

/** An anchor ("today", "tomorrow", a date) → UTC midnight, plus whether it was relative. */
function resolveAnchor(anchor: string, now: Date): { t: number; relative: boolean } | null {
  const today = todayUtc(now);
  if (anchor === 'today' || anchor === 'now') return { t: today, relative: true };
  if (anchor === 'tomorrow') return { t: today + DAY_MS, relative: true };
  if (anchor === 'yesterday') return { t: today - DAY_MS, relative: true };
  const t = parseCalendarDate(anchor);
  return t === null ? null : { t, relative: false };
}

const utcNote = (now: Date): string => ` (today is ${LONG_DATE.format(todayUtc(now))}, UTC)`;
const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

const OFFSET = new RegExp(`^(?:what(?:'s| is)\\s+(?:the\\s+)?(?:date|day)\\s+|what\\s+(?:date|day)\\s+(?:is|will it be|was it|was)\\s+)(\\d{1,5})\\s+(days?|weeks?)\\s+(from|after|before)\\s+${ANCHOR_RE}$`);
const AGO = /^what\s+(?:date|day)\s+(?:was it|was)\s+(\d{1,5})\s+(days?|weeks?)\s+ago$/;
const WEEKDAY_OF = new RegExp(`^what\\s+day(?:\\s+of\\s+the\\s+week)?\\s+(?:is|was|will be|falls on)\\s+${DATE_RE}$`);
const BETWEEN = new RegExp(`^how many days\\s+(?:are there\\s+)?(?:between|from)\\s+${DATE_RE}\\s+(?:and|to|until)\\s+${DATE_RE}$`);
const UNTIL = new RegExp(`^how many days\\s+(?:are\\s+)?(?:left\\s+)?(?:until|till|to|before)\\s+${DATE_RE}$`);

function offsetAnswer(n: number, unit: string, direction: 'forward' | 'back', anchor: { t: number; relative: boolean }, phrase: string, now: Date): DeterministicAnswer | null {
  const days = unit.startsWith('week') ? n * 7 : n;
  if (days > MAX_OFFSET_DAYS) return null;
  const target = anchor.t + (direction === 'forward' ? days : -days) * DAY_MS;
  return { handler: 'date_arithmetic', content: `${phrase} is ${LONG_DATE.format(target)}${anchor.relative ? utcNote(now) : ''}.` };
}

function answerDate(question: string, now: Date): DeterministicAnswer | null {
  const q = normalizeQuestion(question);
  const offset = OFFSET.exec(q);
  if (offset) {
    const anchor = resolveAnchor(offset[4]!, now);
    if (!anchor) return null;
    const n = Number(offset[1]);
    const direction = offset[3] === 'before' ? 'back' : 'forward';
    const unitWord = offset[2]!.startsWith('week') ? 'week' : 'day';
    return offsetAnswer(n, offset[2]!, direction, anchor, `${plural(n, unitWord)} ${offset[3]} ${offset[4]}`, now);
  }
  const ago = AGO.exec(q);
  if (ago) {
    const n = Number(ago[1]);
    const unitWord = ago[2]!.startsWith('week') ? 'week' : 'day';
    return offsetAnswer(n, ago[2]!, 'back', { t: todayUtc(now), relative: true }, `${plural(n, unitWord)} ago`, now);
  }
  const weekday = WEEKDAY_OF.exec(q);
  if (weekday) {
    const t = parseCalendarDate(weekday[1]!);
    return t === null ? null : { handler: 'date_arithmetic', content: `${DATE_ONLY.format(t)} is a ${WEEKDAY.format(t)}.` };
  }
  const between = BETWEEN.exec(q);
  if (between) {
    const a = parseCalendarDate(between[1]!);
    const b = parseCalendarDate(between[2]!);
    if (a === null || b === null) return null;
    const days = Math.abs(Math.round((b - a) / DAY_MS));
    return { handler: 'date_arithmetic', content: `There are ${plural(days, 'day')} between ${LONG_DATE.format(Math.min(a, b))} and ${LONG_DATE.format(Math.max(a, b))}.` };
  }
  const until = UNTIL.exec(q);
  if (until) {
    const t = parseCalendarDate(until[1]!);
    if (t === null) return null;
    const days = Math.round((t - todayUtc(now)) / DAY_MS);
    if (days < 0) return null;
    return { handler: 'date_arithmetic', content: `${LONG_DATE.format(t)} is ${plural(days, 'day')} away${utcNote(now)}.` };
  }
  return null;
}

export const dateArithmeticHandler: DeterministicHandler = {
  id: 'date_arithmetic',
  answer: answerDate,
};
