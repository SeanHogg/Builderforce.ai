import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, shiftSchedule } from './schedule';

/** Local-midnight ISO for a plain calendar day, so the tests read as dates. */
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d).toISOString();

describe('daysBetween', () => {
  it('counts whole calendar days in both directions', () => {
    expect(daysBetween(new Date(2026, 7, 1), new Date(2026, 7, 4))).toBe(3);
    expect(daysBetween(new Date(2026, 7, 4), new Date(2026, 7, 1))).toBe(-3);
    expect(daysBetween(new Date(2026, 7, 1, 23), new Date(2026, 7, 2, 1))).toBe(1);
  });
});

describe('addDays', () => {
  it('keeps the wall-clock time across a month boundary', () => {
    const moved = addDays(new Date(2026, 6, 31, 9, 30), 1);
    expect(moved.getMonth()).toBe(7);
    expect(moved.getDate()).toBe(1);
    expect(moved.getHours()).toBe(9);
    expect(moved.getMinutes()).toBe(30);
  });
});

describe('shiftSchedule', () => {
  const windowed = { startDate: day(2026, 8, 10), dueDate: day(2026, 8, 20) };
  const deadlineOnly = { startDate: null, dueDate: day(2026, 8, 20) };

  it('slides both ends on a move', () => {
    const patch = shiftSchedule(windowed, 'move', 3)!;
    expect(new Date(patch.startDate!).getDate()).toBe(13);
    expect(new Date(patch.dueDate!).getDate()).toBe(23);
  });

  it('never materialises a start an item does not have', () => {
    // A roadmap item has a target, not a window. Inventing a start out of a drag
    // would put a schedule on the board that nobody entered.
    const patch = shiftSchedule(deadlineOnly, 'move', -5)!;
    expect(patch.startDate).toBeNull();
    expect(new Date(patch.dueDate!).getDate()).toBe(15);
  });

  it('moves only the edge being resized', () => {
    const start = shiftSchedule(windowed, 'start', 2)!;
    expect(new Date(start.startDate!).getDate()).toBe(12);
    expect(start.dueDate).toBe(windowed.dueDate);

    const end = shiftSchedule(windowed, 'end', 2)!;
    expect(end.startDate).toBe(windowed.startDate);
    expect(new Date(end.dueDate!).getDate()).toBe(22);
  });

  it('collapses rather than inverts when an edge is dragged past the other', () => {
    // An end before its start is not a shorter task, it is a corrupt row — and
    // the Gantt renders it as a negative-width bar.
    const start = shiftSchedule(windowed, 'start', 40)!;
    expect(start.startDate).toBe(start.dueDate);

    const end = shiftSchedule(windowed, 'end', -40)!;
    expect(end.dueDate).toBe(end.startDate);
  });

  it('returns null when nothing would change, so no write is issued', () => {
    expect(shiftSchedule(windowed, 'move', 0)).toBeNull();
    expect(shiftSchedule(windowed, 'move', Number.NaN)).toBeNull();
    // Resizing an edge the item does not have is a no-op, not an invention.
    expect(shiftSchedule(deadlineOnly, 'start', 3)).toBeNull();
    expect(shiftSchedule({ startDate: null, dueDate: null }, 'move', 3)).toBeNull();
  });

  it('already collapsed: dragging the start further forward changes nothing', () => {
    const collapsed = { startDate: day(2026, 8, 20), dueDate: day(2026, 8, 20) };
    expect(shiftSchedule(collapsed, 'start', 5)).toBeNull();
    expect(shiftSchedule(collapsed, 'end', -5)).toBeNull();
  });
});
