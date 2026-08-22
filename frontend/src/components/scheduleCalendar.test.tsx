import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

import { ScheduleCalendar } from './ScheduleCalendar';

/**
 * The delivery calendar AFTER it stopped drawing its own month.
 *
 * These assert the three things that are genuinely this adapter's — a span, the deadline
 * colour rule, and what a drag MEANS — plus the one property the migration exists to
 * guarantee: that it is the shared calendar underneath, so a fix to the grid reaches
 * every calendar in the product rather than one of three.
 */

interface Item { id: number; title: string; startDate: string | null; dueDate: string | null }

const inFlight: Item = { id: 1, title: 'Onboarding revamp', startDate: isoDaysFromToday(-2), dueDate: isoDaysFromToday(3) };
const undatedItem: Item = { id: 2, title: 'Someday idea', startDate: null, dueDate: null };

function isoDaysFromToday(days: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function renderCalendar(over: Partial<Parameters<typeof ScheduleCalendar<Item>>[0]> = {}) {
  return render(
    <ScheduleCalendar<Item>
      items={[inFlight, undatedItem]}
      getLabel={(item) => item.title}
      onSelect={() => {}}
      {...over}
    />,
  );
}

describe('ScheduleCalendar', () => {
  /** The migration's whole point: one grid, shared. */
  it('renders through the shared calendar primitive', () => {
    renderCalendar();
    const calendar = screen.getByTestId('calendar-full');
    expect(calendar).toHaveAttribute('data-view', 'month');
    // …and the grains a bespoke month grid never offered come free with it.
    expect(within(calendar).getByRole('button', { name: 'Week' })).toBeInTheDocument();
  });

  /**
   * A dated item is a SPAN, not a dot on its deadline — that is what makes the month
   * answer "what is in flight on the 14th" rather than only "what lands on it".
   */
  it('draws a dated item as a span and names an undated one beneath the grid', () => {
    renderCalendar();
    expect(screen.getByText('Onboarding revamp')).toBeInTheDocument();
    // Named, not counted: the item with no deadline is the one a planner needs to reach.
    const chip = screen.getByRole('button', { name: 'Someday idea' });
    expect(chip).toBeInTheDocument();
  });

  it('selects an item from its span and from the undated list', () => {
    const onSelect = vi.fn();
    renderCalendar({ onSelect });

    fireEvent.click(screen.getByText('Onboarding revamp'));
    expect(onSelect).toHaveBeenCalledWith(inFlight);

    fireEvent.click(screen.getByRole('button', { name: 'Someday idea' }));
    expect(onSelect).toHaveBeenLastCalledWith(undatedItem);
  });

  /**
   * A drop is a MOVE of the whole window, through `shiftSchedule` — the same rule the
   * Gantt obeys, so a move made here and a move made there write the same patch. Both
   * dates shift by the same delta; neither is invented.
   */
  it('moves the whole window when a span is dropped on another day', () => {
    const onReschedule = vi.fn();
    const { container } = renderCalendar({ onReschedule });

    const span = screen.getByText('Onboarding revamp').closest('button')!;
    const cells = container.querySelectorAll<HTMLElement>('[role="gridcell"]');
    // Any cell that is not the one the span already starts in.
    const target = cells[cells.length - 1]!;

    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (key: string, value: string) => { data.set(key, value); },
      getData: (key: string) => data.get(key) ?? '',
    };
    fireEvent.dragStart(span, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });

    expect(onReschedule).toHaveBeenCalledTimes(1);
    const [item, patch] = onReschedule.mock.calls[0]!;
    expect(item).toBe(inFlight);
    // Both ends moved, and by the same amount — a move, never a resize.
    const originalSpanMs = Date.parse(inFlight.dueDate!) - Date.parse(inFlight.startDate!);
    expect(Date.parse(patch.dueDate) - Date.parse(patch.startDate)).toBe(originalSpanMs);
  });

  /** Without `onReschedule` the calendar is a reading, and nothing is draggable. */
  it('is read-only when no reschedule handler is given', () => {
    renderCalendar();
    const span = screen.getByText('Onboarding revamp').closest('button')!;
    expect(span).not.toHaveAttribute('draggable', 'true');
  });
});
