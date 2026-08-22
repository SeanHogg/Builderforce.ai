import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

// Real copy, real keys. A calendar whose grain switch is labelled `calendar.view.month`
// tells nobody what it does, and a missing key is exactly the defect the previous month
// grid shipped with — eleven of them, in five catalogs, for a whole release.
vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

import {
  boardCalendarEvents,
  calendarConflicts,
  calendarEventDays,
  calendarGridDays,
  normalizeCalendarEvents,
  undatedRows,
  shiftCalendarCursor,
  toCalendarEvents,
  type CalendarEvent,
} from '@builderforce/creation-canvas-contract';
import { Calendar } from './Calendar';

/** A fixed instant so every assertion below sits on a known month. Local noon, so no
 *  assertion is decided by the machine's UTC offset. */
const NOW = new Date(2026, 7, 12, 12, 0, 0).getTime();

function evt(over: Partial<CalendarEvent> & { id: string; startISO: string }): CalendarEvent {
  return { subject: over.id, ...over };
}

describe('the calendar contract', () => {
  /** The signature the whole feature is named after. */
  it('takes one event, many events, or nothing', () => {
    const one = evt({ id: 'a', startISO: '2026-08-12' });
    expect(toCalendarEvents(one)).toEqual([one]);
    expect(toCalendarEvents([one, one])).toHaveLength(2);
    expect(toCalendarEvents(null)).toEqual([]);
    expect(toCalendarEvents(undefined)).toEqual([]);
  });

  /**
   * A row that names something and never says WHEN is not an event at midnight. Plotting
   * it would report a commitment nobody made, so it is refused and counted instead.
   */
  it('refuses an undated row rather than plotting it, and says how many it refused', () => {
    const rows = [
      { subject: 'Ship 1.4', startISO: '2026-08-14' },
      { title: 'Someday', details: 'no date at all' },
      { name: 'Standup', scheduledAt: '2026-08-13T09:00:00.000Z' },
    ];
    const events = normalizeCalendarEvents(rows);
    expect(events.map((event) => event.subject)).toEqual(['Standup', 'Ship 1.4']);
    // Named, not counted — the list is what a planner acts on.
    expect(undatedRows(rows).map((entry) => entry.subject)).toEqual(['Someday']);
  });

  /** Four facts, spelled five ways by three different writers — normalised once. */
  it('reads the spellings a person, a model and an adapter each use', () => {
    const [event] = normalizeCalendarEvents([
      { title: 'Launch', description: 'the big one', start: '2026-08-20T14:00:00.000Z', end: '2026-08-20T15:00:00.000Z' },
    ]);
    expect(event?.subject).toBe('Launch');
    expect(event?.details).toBe('the big one');
    expect(event?.endISO).toBe('2026-08-20T15:00:00.000Z');
    // An instant is not an all-day event; a bare date is.
    expect(event?.allDay).toBeUndefined();
    expect(normalizeCalendarEvents([{ subject: 'Boxing Day', date: '2026-12-26' }])[0]?.allDay).toBe(true);
  });

  /** An all-day event with no end covers its whole day, not the instant of midnight. */
  it('gives a whole-day event a whole day', () => {
    expect(calendarEventDays(evt({ id: 'h', startISO: '2026-12-25', allDay: true }))).toBe(1);
    expect(calendarEventDays(evt({ id: 'r', startISO: '2026-08-10', endISO: '2026-08-12', allDay: true }))).toBe(3);
  });

  /**
   * Same day AND same category. Two emails to one list on one morning is the collision a
   * content calendar exists to catch; an email and a sales call that afternoon is a
   * normal Tuesday, and two unlabelled things on Thursday is a description of Thursday.
   */
  it('collides on the category, never on the day alone', () => {
    const clash = calendarConflicts([
      evt({ id: 'e1', startISO: '2026-08-12T09:00:00.000Z', category: 'email' }),
      evt({ id: 'e2', startISO: '2026-08-12T11:00:00.000Z', category: 'email' }),
      evt({ id: 's1', startISO: '2026-08-12T15:00:00.000Z', category: 'sales' }),
      evt({ id: 'x1', startISO: '2026-08-12T16:00:00.000Z' }),
      evt({ id: 'x2', startISO: '2026-08-12T17:00:00.000Z' }),
    ]);
    expect([...clash].sort()).toEqual(['e1', 'e2']);
  });

  /** A month is always six weeks, so the grid does not change height between February
   *  and August — and a month step lands in the next month, not 31 days later. */
  it('draws a stable six-week month and steps by the grain', () => {
    expect(calendarGridDays('month', NOW)).toHaveLength(42);
    expect(calendarGridDays('week', NOW)).toHaveLength(7);
    expect(calendarGridDays('day', NOW)).toHaveLength(1);
    // 31 January + one month is February, which "+31 days" is not.
    const jan31 = new Date(2026, 0, 31, 12).getTime();
    expect(new Date(shiftCalendarCursor('month', jan31, 1)).getMonth()).toBe(1);
  });

  /**
   * The board projection: dates that ALREADY EXIST on cards, read together. It owns
   * nothing — `field` is what lets a move write back into the field it came from.
   */
  it('projects a board without copying its dates', () => {
    const events = boardCalendarEvents([
      { id: 'n1', kind: 'emailCampaign', title: 'August send', data: { scheduledAt: '2026-08-14T09:00:00.000Z' } },
      { id: 'n2', kind: 'note', title: 'No date', data: {} },
      { id: 'n3', kind: 'contract', title: 'Renewal', data: { renewsAt: '2026-08-20' } },
    ]);
    expect(events.map((event) => event.subject)).toEqual(['August send', 'Renewal']);
    expect(events[0]?.field).toBe('scheduledAt');
    // The channel comes from the kind's own name rather than a hand-kept table, so a
    // kind added later is categorised instead of silently escaping conflict detection.
    expect(events[0]?.category).toBe('email');
    expect(events[1]?.field).toBe('renewsAt');
    expect(events.every((event) => event.sourceId === 'board')).toBe(true);
  });
});

describe('the Calendar component', () => {
  const events: CalendarEvent[] = [
    { id: 'a', subject: 'Release 1.4', startISO: '2026-08-12', allDay: true, category: 'deployment' },
    { id: 'b', subject: 'Kickoff', startISO: '2026-08-13T09:00:00.000Z', endISO: '2026-08-13T10:00:00.000Z', details: 'Agenda in the doc' },
  ];

  it('draws the month it was given and moves through time', () => {
    render(<Calendar events={events} variant="full" nowMs={NOW} />);
    expect(screen.getByText('August 2026')).toBeInTheDocument();
    expect(screen.getByText('Release 1.4')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('September 2026')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByText('August 2026')).toBeInTheDocument();
  });

  /** Three grains, and the day/week ones bring the hour grid a month cannot have. */
  it('switches between day, week and month', () => {
    render(<Calendar events={events} variant="full" nowMs={NOW} />);
    const grains = screen.getByRole('group', { name: 'How much to show' });

    fireEvent.click(within(grains).getByRole('button', { name: 'Week' }));
    expect(screen.getByText('All day')).toBeInTheDocument();
    fireEvent.click(within(grains).getByRole('button', { name: 'Day' }));
    expect(screen.getByText('All day')).toBeInTheDocument();
    fireEvent.click(within(grains).getByRole('button', { name: 'Month' }));
    expect(screen.queryByText('All day')).not.toBeInTheDocument();
  });

  /**
   * Clicking an entry opens its detail INSIDE the calendar. It is scoped to this
   * component's own bounds on purpose — a calendar in a card must not be able to throw a
   * dialog over the board behind it.
   */
  it('opens an entry in a panel within itself', () => {
    const { container } = render(<Calendar events={events} variant="full" nowMs={NOW} />);
    fireEvent.click(screen.getByText('Kickoff'));

    const panel = screen.getByRole('dialog', { name: 'Event details' });
    expect(within(panel).getByText('Agenda in the doc')).toBeInTheDocument();
    // Inside the calendar's own element, not portalled to the document body.
    expect(container.firstElementChild).toContainElement(panel);

    fireEvent.click(within(panel).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Event details' })).not.toBeInTheDocument();
  });

  /**
   * Writing is offered only when the SOURCE can write — which the component reads off
   * the callbacks it was handed rather than off a permission boolean somebody drilled in.
   */
  it('offers no edit and no delete on a reading it cannot write', () => {
    render(<Calendar events={events} variant="full" nowMs={NOW} />);
    fireEvent.click(screen.getByText('Kickoff'));
    const panel = screen.getByRole('dialog', { name: 'Event details' });
    expect(within(panel).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New event' })).not.toBeInTheDocument();
  });

  it('edits an entry through the panel when the source can write', () => {
    const onUpdate = vi.fn();
    render(<Calendar events={events} variant="full" nowMs={NOW} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByText('Kickoff'));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    const subject = screen.getByLabelText('Subject');
    fireEvent.change(subject, { target: { value: 'Kickoff, moved' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0]![0].id).toBe('b');
    expect(onUpdate.mock.calls[0]![1].subject).toBe('Kickoff, moved');
  });

  /** Deleting asks once. It is the one destructive act in this component. */
  it('confirms before deleting', () => {
    const onDelete = vi.fn();
    render(<Calendar events={events} variant="full" nowMs={NOW} onUpdate={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByText('Kickoff'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Really delete' }));
    expect(onDelete).toHaveBeenCalledWith(events[1]);
  });

  /** A card has no room for an hour grid, so it does not pretend to offer one. */
  it('offers only the month at card size', () => {
    render(<Calendar events={events} variant="card" nowMs={NOW} />);
    expect(screen.queryByRole('group', { name: 'How much to show' })).not.toBeInTheDocument();
    expect(screen.getByText('Release 1.4')).toBeInTheDocument();
  });

  /** A failed read leaves the grid up and says why. A calendar that blanks is
   *  indistinguishable from a calendar with nothing in it. */
  it('states a read failure instead of rendering as empty', () => {
    render(<Calendar events={[]} variant="full" nowMs={NOW} error="Source unavailable" />);
    expect(screen.getByText('Source unavailable')).toBeInTheDocument();
    expect(screen.getByText('August 2026')).toBeInTheDocument();
  });
});
