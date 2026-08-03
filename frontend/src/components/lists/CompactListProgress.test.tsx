import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  CompactListProgress,
  sortItems,
  toPercent,
  formatValue,
  formatPct,
  getColorByStatus,
  STATUS_LABELS,
  STATUS_ICONS,
  type ProgressItem,
} from './CompactListProgress';

/* ── test data ───────────────────────────────────────────────────────────── */

function item(over: Partial<ProgressItem> = {}): ProgressItem {
  return {
    id: '1',
    label: 'Setup',
    completed: 3,
    total: 10,
    status: 'in_progress',
    ...over,
  };
}

function items(...overrides: Partial<ProgressItem>[]): ProgressItem[] {
  return overrides.map((o, i) =>
    item({ id: String(i + 1), label: `Item ${i + 1}`, ...o }),
  );
}

/* ── pure helpers ─────────────────────────────────────────────────────────── */

describe('toPercent', () => {
  it('returns 0 for total 0', () => {
    expect(toPercent(5, 0)).toBe(0);
    expect(toPercent(0, -1)).toBe(0);
    expect(toPercent(0, NaN)).toBe(0);
  });

  it('computes rounded percentages', () => {
    expect(toPercent(5, 10)).toBe(50);
    expect(toPercent(1, 3)).toBeCloseTo(33.33, 1);
  });

  it('clamps to [0, 100]', () => {
    expect(toPercent(15, 10)).toBe(100);
    expect(toPercent(-5, 10)).toBe(0);
  });
});

describe('formatValue', () => {
  it('renders fraction by default', () => {
    expect(formatValue(5, 10)).toBe('5/10');
  });

  it('renders percent when valueFormat=percent', () => {
    expect(formatValue(5, 10, 'percent')).toBe('50%');
  });

  it('degrades to percent when total is 0', () => {
    expect(formatValue(5, 0)).toBe('0%');
    expect(formatValue(0, 0, 'fraction')).toBe('0%');
  });
});

describe('formatPct', () => {
  it('returns a rounded percentage string', () => {
    expect(formatPct(3, 10)).toBe('30%');
    expect(formatPct(0, 10)).toBe('0%');
  });
});

describe('getColorByStatus', () => {
  it('maps known statuses to CSS custom properties', () => {
    expect(getColorByStatus('not_started')).toBe('var(--muted)');
    expect(getColorByStatus('in_progress')).toBe('var(--accent)');
    expect(getColorByStatus('completed')).toBe('var(--success)');
    expect(getColorByStatus('blocked')).toBe('var(--error)');
  });

  it('falls back to muted for unknown statuses', () => {
    expect(getColorByStatus('bogus')).toBe('var(--muted)');
  });
});

describe('sortItems', () => {
  const data = [
    item({ id: 'a', label: 'Zulu', completed: 0, total: 10, status: 'not_started' as const }),
    item({ id: 'b', label: 'Alpha', completed: 10, total: 10, status: 'completed' as const }),
    item({ id: 'c', label: 'Beta', completed: 5, total: 10, status: 'in_progress' as const }),
    item({ id: 'd', label: 'Gamma', completed: 2, total: 10, status: 'blocked' as const }),
  ];

  it('preserves input order when sortBy is undefined', () => {
    const sorted = sortItems(data, undefined);
    expect(sorted.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('sorts by progress descending', () => {
    const sorted = sortItems(data, 'progress_desc');
    expect(sorted.map((s) => s.id)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('sorts by progress ascending', () => {
    const sorted = sortItems(data, 'progress_asc');
    expect(sorted.map((s) => s.id)).toEqual(['a', 'd', 'c', 'b']);
  });

  it('sorts by status lifecycle order', () => {
    const sorted = sortItems(data, 'status');
    expect(sorted.map((s) => s.status)).toEqual([
      'not_started',
      'in_progress',
      'completed',
      'blocked',
    ]);
  });

  it('sorts by label ascending', () => {
    const sorted = sortItems(data, 'label_asc');
    expect(sorted.map((s) => s.id)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('does not mutate input', () => {
    const ids = data.map((d) => d.id);
    sortItems(data, 'progress_desc');
    expect(data.map((d) => d.id)).toEqual(ids);
  });
});

/* ── component ────────────────────────────────────────────────────────────── */

describe('CompactListProgress', () => {
  // AC-1: normal render
  it('renders one row per item with label, progressbar, value, and status badge', () => {
    const data = items(
      { id: '1', label: 'Setup', completed: 5, total: 10, status: 'in_progress' },
      { id: '2', label: 'Review', completed: 10, total: 10, status: 'completed' },
    );
    render(<CompactListProgress items={data} />);

    // Two rows
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);

    // Each row has a progressbar with correct ARIA
    const bars = screen.getAllByRole('progressbar');
    expect(bars).toHaveLength(2);
    expect(bars[0]).toHaveAttribute('aria-valuenow', '50');
    expect(bars[0]).toHaveAttribute('aria-valuemin', '0');
    expect(bars[0]).toHaveAttribute('aria-valuemax', '100');
    expect(bars[0]).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Setup'),
    );

    // Labels
    expect(screen.getByText('Setup')).toBeTruthy();
    expect(screen.getByText('Review')).toBeTruthy();

    // Status badges with text (not colour alone — FR-7)
    expect(screen.getByText('In progress')).toBeTruthy();
    expect(screen.getByText('Completed')).toBeTruthy();
  });

  // AC-2: progress fills to the right percentage
  it('fills progress bar to 50% when completed=5 total=10 and shows 5/10', () => {
    render(
      <CompactListProgress
        items={items({ id: '1', completed: 5, total: 10 })}
      />,
    );
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    // Default valueFormat is 'fraction'
    expect(screen.getByText('5/10')).toBeTruthy();
  });

  // AC-3: total=0 renders 0% without runtime error
  it('renders 0% when total=0 instead of throwing', () => {
    render(
      <CompactListProgress
        items={items({ id: '1', completed: 0, total: 0 })}
      />,
    );
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText('0%')).toBeTruthy();
  });

  // AC-4: blocked status → danger/red
  it('renders blocked items with error colour', () => {
    render(
      <CompactListProgress
        items={items({ id: '1', status: 'blocked' })}
      />,
    );
    const bar = screen.getByRole('progressbar');
    expect(bar.style.backgroundColor).toBe('var(--error)');
    expect(screen.getByText('Blocked')).toBeTruthy();
  });

  // AC-5: label truncation
  it('truncates long labels', () => {
    render(
      <CompactListProgress
        items={items({
          id: '1',
          label:
            'This is an extremely long label that should be truncated with ellipsis because it exceeds the available width of the container',
        })}
      />,
    );
    const labelEl = screen.getByText(
      /This is an extremely long label/,
    );
    const style = window.getComputedStyle(labelEl);
    expect(style.whiteSpace).toBe('nowrap');
    expect(style.textOverflow).toBe('ellipsis');
    expect(style.overflow).toBe('hidden');
  });

  // AC-6: empty state
  it('renders empty state message when items is empty', () => {
    render(<CompactListProgress items={[]} />);
    expect(screen.getByText('No items to display')).toBeTruthy();
    expect(screen.queryByRole('listitem')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('renders custom empty text', () => {
    render(
      <CompactListProgress items={[]} emptyText="Nothing here yet" />,
    );
    expect(screen.getByText('Nothing here yet')).toBeTruthy();
  });

  // AC-7: loading state
  it('renders skeleton rows when isLoading is true', () => {
    const { container } = render(
      <CompactListProgress
        items={items({ id: '1' })}
        isLoading={true}
        skeletonRowCount={3}
      />,
    );
    const list = container.querySelector('[role="list"]');
    expect(list).toBeTruthy();
    expect(list!.getAttribute('aria-busy')).toBe('true');
    const rows = list!.querySelectorAll('[role="listitem"]');
    expect(rows).toHaveLength(3);
    // No real data rows leaked in loading state
    expect(screen.queryByText('Item 1')).toBeNull();
  });

  // AC-8: sortBy
  it('orders items by progress_desc', () => {
    render(
      <CompactListProgress
        items={[
          item({ id: 'a', completed: 1, total: 10, label: 'Low' }),
          item({ id: 'b', completed: 9, total: 10, label: 'High' }),
        ]}
        sortBy="progress_desc"
      />,
    );
    const rows = screen.getAllByRole('listitem');
    expect(rows[0].textContent).toContain('High');
    expect(rows[1].textContent).toContain('Low');
  });

  // AC-9: ARIA attributes
  it('includes correct ARIA attributes on every progress bar', () => {
    render(
      <CompactListProgress
        items={[
          item({ id: 'a', completed: 4, total: 8, label: 'Design', status: 'in_progress' }),
          item({ id: 'b', completed: 8, total: 8, label: 'Code', status: 'completed' }),
        ]}
      />,
    );
    const bars = screen.getAllByRole('progressbar');
    for (const bar of bars) {
      expect(bar).toHaveAttribute('aria-valuenow');
      expect(bar).toHaveAttribute('aria-valuemin', '0');
      expect(bar).toHaveAttribute('aria-valuemax', '100');
      expect(bar).toHaveAttribute('aria-label');
    }
  });

  // AC-12 prep: the component accepts an aria-label on the list container
  it('forwards aria-label to the list container', () => {
    render(
      <CompactListProgress
        items={items({ id: '1' })}
        aria-label="Task progress"
      />,
    );
    const list = screen.getByRole('list');
    expect(list).toHaveAttribute('aria-label', 'Task progress');
  });

  // valueFormat
  it('renders percent values when valueFormat=percent', () => {
    render(
      <CompactListProgress
        items={items({ id: '1', completed: 7, total: 10 })}
        valueFormat="percent"
      />,
    );
    expect(screen.getByText('70%')).toBeTruthy();
  });

  // showValue=false hides value column
  it('hides the value column when showValue=false', () => {
    render(
      <CompactListProgress
        items={items({ id: '1', completed: 5, total: 10 })}
        showValue={false}
      />,
    );
    expect(screen.queryByText('5/10')).toBeNull();
  });

  // STATUS_LABELS constant
  it('STATUS_LABELS covers all defined statuses', () => {
    expect(STATUS_LABELS.not_started).toBe('Not started');
    expect(STATUS_LABELS.in_progress).toBe('In progress');
    expect(STATUS_LABELS.completed).toBe('Completed');
    expect(STATUS_LABELS.blocked).toBe('Blocked');
  });

  // STATUS_ICONS constant
  it('STATUS_ICONS has glyphs for every status', () => {
    for (const s of ['not_started', 'in_progress', 'completed', 'blocked'] as const) {
      expect(STATUS_ICONS[s]).toBeTruthy();
      expect(STATUS_ICONS[s].length).toBeGreaterThan(0);
    }
  });
});
