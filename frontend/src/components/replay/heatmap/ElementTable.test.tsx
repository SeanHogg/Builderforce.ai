import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReplayElementRowDto } from '@builderforce/interaction-contract';
import { ElementTable } from './ElementTable';

/**
 * The element table: sortable with the shared `useTableSort`, the change
 * column only with a compare release, hover reports the row's selector, and
 * opening a row hands it to the caller.
 */

const rows: ReplayElementRowDto[] = [
  { selector: 'getByRole("button", { name: "Buy" })', label: 'Buy', clicks: 40, rage: 2, dead: 0, compareClicks: 20, delta: 1, score: 9 },
  { selector: 'getByText("Free shipping")', label: 'Free shipping', clicks: 5, rage: 0, dead: 12, compareClicks: 10, delta: -0.5, score: 4 },
  { selector: 'nav > a.logo', label: null, clicks: 18, rage: 7, dead: 1, compareClicks: null, delta: null, score: 6 },
];

const order = () => screen.getAllByTestId('heat-element-row').map((row) => row.getAttribute('data-selector'));

describe('ElementTable', () => {
  it('ranks by clicks first, and re-sorts by any column', () => {
    render(<ElementTable rows={rows} hasCompare={false} />);
    expect(order()).toEqual(['getByRole("button", { name: "Buy" })', 'nav > a.logo', 'getByText("Free shipping")']);

    fireEvent.click(screen.getByRole('button', { name: 'replay.heat.elements.sortBy replay.heat.elements.dead' }));
    expect(order()[0]).toBe('getByText("Free shipping")');
    fireEvent.click(screen.getByRole('button', { name: 'replay.heat.elements.sortBy replay.heat.elements.rage' }));
    expect(order()[0]).toBe('nav > a.logo');
  });

  it('shows the change column only against a compare release', () => {
    const { rerender } = render(<ElementTable rows={rows} hasCompare={false} />);
    expect(screen.queryByRole('button', { name: 'replay.heat.elements.sortBy replay.heat.elements.delta' })).toBeNull();

    rerender(<ElementTable rows={rows} hasCompare />);
    expect(screen.getByRole('button', { name: 'replay.heat.elements.sortBy replay.heat.elements.delta' })).toBeInTheDocument();
    const buy = screen.getAllByTestId('heat-element-row')[0]!;
    expect(within(buy).getByText('+100%')).toBeInTheDocument();
    const logo = screen.getAllByTestId('heat-element-row').find((row) => row.getAttribute('data-selector') === 'nav > a.logo')!;
    expect(within(logo).getByText('replay.heat.elements.none')).toBeInTheDocument();
    // A row without a label is named by its selector.
    expect(within(logo).getByText('nav > a.logo')).toBeInTheDocument();
  });

  it('reports the hovered row for its zone highlight, and clears on leave', () => {
    const onHighlight = vi.fn();
    render(<ElementTable rows={rows} hasCompare={false} onHighlight={onHighlight} />);
    const [first] = screen.getAllByTestId('heat-element-row');
    fireEvent.mouseEnter(first!);
    expect(onHighlight).toHaveBeenLastCalledWith('getByRole("button", { name: "Buy" })');
    fireEvent.mouseLeave(first!.parentElement!);
    expect(onHighlight).toHaveBeenLastCalledWith(null);
  });

  it('opens a row (row click or its button) with the row', () => {
    const onOpen = vi.fn();
    render(<ElementTable rows={rows} hasCompare={false} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'replay.heat.elements.openAria Free shipping' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0]![0]).toMatchObject({ selector: 'getByText("Free shipping")' });
    fireEvent.click(screen.getAllByTestId('heat-element-row')[0]!);
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('says when no element was clicked', () => {
    render(<ElementTable rows={[]} hasCompare={false} />);
    expect(screen.getByText('replay.heat.elements.empty')).toBeInTheDocument();
  });
});
