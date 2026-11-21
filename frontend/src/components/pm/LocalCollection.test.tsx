import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LocalCollection } from './LocalCollection';
import { roiProjectsDescriptor, roiTasksDescriptor } from './roiDescriptors';
import { managerStallsDescriptor } from '@/components/manager/managerDescriptors';
import { portfolioHealthDescriptor } from './portfolioHealthDescriptor';
import type { StallWatchRow } from '@/lib/builderforceApi';

// The global next-intl mock returns keys, so these assert WIRING: the shared
// Collection renders the rows, read-only (no bulk checkboxes), and search filters.

const money = (n: number) => `$${n}`;

describe('LocalCollection', () => {
  const rows = [
    { projectId: 1, projectName: 'Alpha', completedCount: 3, agentLlmCostUsd: 5 },
    { projectId: 2, projectName: 'Beta', completedCount: 1, agentLlmCostUsd: 9 },
  ];
  const descriptor = roiProjectsDescriptor({ project: 'Project', completed: 'Completed', spend: 'Spend' }, money);

  it('renders rows through Collection with no selection column (entity null)', () => {
    render(<LocalCollection descriptor={descriptor} rows={rows} searchText={(r) => r.projectName} />);
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('filters rows by the search box', () => {
    render(<LocalCollection descriptor={descriptor} rows={rows} searchText={(r) => r.projectName} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'bet' } });
    expect(screen.queryByText('Alpha')).toBeNull();
    expect(screen.getByText('Beta')).toBeTruthy();
  });

  // Spend = index, and the descriptor's default sort is spend desc: P060 first, P001 last.
  const makeRows = (n: number) => Array.from({ length: n }, (_, i) => ({
    projectId: i + 1, projectName: `P${String(i + 1).padStart(3, '0')}`, completedCount: i, agentLlmCostUsd: i,
  }));
  const many = makeRows(60);
  const nextPage = () => fireEvent.click(screen.getByRole('button', { name: 'common.pagination.next' }));

  it('regression: pages the rows instead of rendering the whole set', () => {
    render(<LocalCollection descriptor={descriptor} rows={many} searchText={(r) => r.projectName} />);
    expect(screen.queryAllByText(/^P\d{3}$/)).toHaveLength(50);
  });

  it('regression: sort applies across pages (page 1 holds the globally-first rows)', () => {
    render(<LocalCollection descriptor={descriptor} rows={many} searchText={(r) => r.projectName} />);
    expect(screen.getByText('P060')).toBeTruthy();
    expect(screen.queryByText('P001')).toBeNull();
    fireEvent.click(screen.getByText('Project'));
    expect(screen.getByText('P001')).toBeTruthy();
    expect(screen.queryByText('P060')).toBeNull();
  });

  it('regression: a search change resets to page 1', () => {
    render(<LocalCollection descriptor={descriptor} rows={many} searchText={(r) => r.projectName} />);
    nextPage();
    expect(screen.queryByText('P060')).toBeNull();
    expect(screen.getByText('P001')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'p0' } });
    expect(screen.getByText('P060')).toBeTruthy();
    expect(screen.queryByText('P001')).toBeNull();
  });

  it('regression: rows shrinking under the current page clamp it and snap the pager back', () => {
    const { rerender } = render(<LocalCollection descriptor={descriptor} rows={many} />);
    nextPage();
    expect(screen.getByText('P001')).toBeTruthy();
    rerender(<LocalCollection descriptor={descriptor} rows={makeRows(10)} />);
    expect(screen.queryAllByText(/^P\d{3}$/)).toHaveLength(10);
    // The paging state snapped to page 1, so growing back shows page 1, not page 2.
    rerender(<LocalCollection descriptor={descriptor} rows={many} />);
    expect(screen.getByText('P060')).toBeTruthy();
    expect(screen.queryByText('P001')).toBeNull();
  });
});

describe('descriptors', () => {
  it('are all read-only', () => {
    const stall = managerStallsDescriptor({
      ticket: 't', cause: 'c', doing: 'd', attempts: 'a', stuckFor: 's',
      causeLabel: () => 'x', lastTried: () => null, needsYou: 'n', attemptsText: () => '1/3', idle: () => '1d',
    });
    const roi = roiTasksDescriptor({ task: 'Task', spend: 'Spend' }, money);
    const health = portfolioHealthDescriptor({
      project: 'p', health: 'h', progress: 'g', blocker: 'b', action: 'a',
      rag: () => 'r', progressText: () => 'x', blockerText: () => 'y', actionText: () => 'z',
    });
    expect([stall.entity, roi.entity, health.entity]).toEqual([null, null, null]);
  });

  it('stall rows are identified by task id and sort by idle time', () => {
    const d = managerStallsDescriptor({
      ticket: 't', cause: 'c', doing: 'd', attempts: 'a', stuckFor: 's',
      causeLabel: () => 'x', lastTried: () => null, needsYou: 'n', attemptsText: () => '1/3', idle: () => '1d',
    });
    const row = (taskId: number, idleMs: number) => ({ taskId, idleMs, title: 't', status: 's', cause: 'x', detail: '', attempts: 0, escalatedAt: null, lastAttemptAt: null }) as unknown as StallWatchRow;
    expect(d.rowId(row(7, 1))).toBe('7');
    const col = d.columns.find((c) => c.key === 'stuckFor')!;
    expect(col.compare!(row(1, 1), row(2, 5))).toBeLessThan(0);
  });
});
