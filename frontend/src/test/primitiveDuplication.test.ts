import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The DRY ratchet's own test.
 *
 * A heuristic guard has one failure mode that matters: it stops catching the thing it
 * was written for, and nothing says so, because a guard that finds nothing and a guard
 * that looks at nothing print the same line. So the signal set is pinned against real
 * implementations rather than trusted.
 *
 * The fixtures below are the LOAD-BEARING SHAPES of the three calendars this codebase
 * actually had before they were migrated onto `components/calendar/` — a seven-column
 * grid, a 42-cell month, Monday-first index arithmetic, an hour-row grid, lane packing,
 * outside-month cells. They are written out here rather than read from git history so
 * the test does not depend on a revision that a squash or a fresh clone can take away.
 */

const script = resolve(__dirname, '../../scripts/check-primitive-duplication.mjs');

function score(source: string, label = 'fixture.tsx'): string {
  return execFileSync('node', [script, '--stdin', label], { input: source, encoding: 'utf8' }).trim();
}

/** The month grid `ScheduleCalendar` used to draw. */
const DELIVERY_MONTH = `
const COLS = 7;
const DAYS_IN_GRID = 42;
const MAX_LANES = 3;
function buildMonthGrid(viewMonth) {
  const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const gridStart = new Date(first);
  gridStart.setDate(1 - first.getDay());
  return Array.from({ length: DAYS_IN_GRID }, (_, i) => addDays(gridStart, i));
}
export function Calendar({ items }) {
  const wd = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  return <div style={{ display: 'grid', gridTemplateColumns: \`repeat(\${COLS}, minmax(96px, 1fr))\` }} />;
}
`;

/** The week grid `MeetingsCalendar` used to draw beside its month one. */
const BOOKABLE_WEEK = `
const HOUR_START = 6;
const HOUR_END = 22;
const SLOT_MIN = 30;
function WeekGrid({ anchor }) {
  const rows = [];
  for (let h = HOUR_START; h < HOUR_END; h++) for (let m = 0; m < 60; m += SLOT_MIN) rows.push(h * 60 + m);
  return <div style={{ display: 'grid', gridTemplateColumns: '52px repeat(7, 1fr)' }} />;
}
`;

/** The canvas month, which spelled its week start differently — and which the first
 *  draft of the signal set scored 1/2 and let through. */
const CANVAS_MONTH = `
function startOfGrid(monthStart) {
  const start = new Date(monthStart);
  const weekday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - weekday);
  return start;
}
const days = Array.from({ length: 42 }, (_, index) => new Date(gridStart.getTime() + index * DAY_MS));
const header = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const cell = <div data-outside={monthKey(day) !== monthKey(cursor)} />;
`;

describe('the primitive-duplication ratchet', () => {
  /** Every calendar this codebase actually had. If a rewrite of the signal set lets one
   *  of these through, the guard has stopped being about anything. */
  it.each([
    ['a delivery month grid', DELIVERY_MONTH],
    ['a bookable week grid', BOOKABLE_WEEK],
    ['the canvas month grid', CANVAS_MONTH],
  ])('catches %s', (_name, source) => {
    expect(score(source)).toContain('VIOLATION');
  });

  /**
   * And the other half, which is what keeps the guard usable: ordinary date code is not
   * a calendar. A guard that fires on a weekday label is one somebody silences.
   */
  it.each([
    ['a formatted date', "const label = fmt.dateWith(value, { weekday: 'short' });"],
    ['a seven-column stat row', "<div style={{ gridTemplateColumns: 'repeat(7, 1fr)' }}>{weeks}</div>"],
    ['a sparkline over 42 points', 'const points = Array.from({ length: 42 }, (_, i) => series[i]);'],
    ['a weekday bucket', 'const bucket = (date.getDay() + 6) % 7;'],
  ])('does not fire on %s', (_name, source) => {
    expect(score(source)).toContain('clean');
  });

  /** The whole tree, through the real entry point. Zero duplicates is the state the
   *  migration left, and this is what stops the next one being added quietly. */
  it('passes on the current tree', () => {
    const out = execFileSync('node', [script], { encoding: 'utf8' });
    expect(out).toContain('0 known duplicate(s), 0 new');
  });
});
