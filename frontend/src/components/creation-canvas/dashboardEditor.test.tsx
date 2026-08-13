import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CreationNode } from './CreationNode';
import type { DashboardWidget } from '@/lib/canvasDashboard';

/**
 * The Dashboard Object is authored, not hardcoded.
 *
 * What this locks down: a dashboard used to be a fixed bar-and-donut picture with
 * three invented KPIs behind it. It is now a list of widgets the author can add to,
 * retype, reorder and delete — edited beside the live drawing, and persisted as ONE
 * representation (the legacy flat fields are cleared on save).
 */

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations')).realCatalogIntlMock(
  (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
));

vi.mock('@xyflow/react', async () => {
  const inert = () => null;
  return {
    Handle: inert, NodeResizer: inert, Position: { Left: 'left', Right: 'right' },
    useStore: (selector: (state: { nodeLookup: Map<string, unknown> }) => unknown) => selector({ nodeLookup: new Map() }),
  };
});

const nodeProps = {
  id: 'dash', type: 'creation' as const, selected: false, dragging: false, zIndex: 0,
  selectable: true, deletable: true, draggable: true, isConnectable: true,
  positionAbsoluteX: 0, positionAbsoluteY: 0,
};

const legacy = {
  kind: 'dashboard' as const,
  title: 'SaaS Metrics Dashboard',
  kpis: [{ label: 'MRR', value: '$42K', trend: '↑ 4%' }],
  chartLabels: ['Trial', 'Active'],
  chartValues: [80, 45],
};

/** The widgets carried by the most recent patch. */
function widgetsFrom(onEditData: ReturnType<typeof vi.fn>): DashboardWidget[] {
  const [, patch] = onEditData.mock.calls.at(-1) as [string, { widgets: DashboardWidget[] }];
  return patch.widgets;
}

describe('Dashboard WYSIWYG editing', () => {
  it('offers no editor on a board the viewer cannot edit', () => {
    render(<CreationNode {...nodeProps} data={legacy} />);
    expect(screen.queryByRole('button', { name: 'Edit dashboard' })).toBeNull();
  });

  it('opens the editor beside the drawing rather than replacing it', () => {
    render(<CreationNode {...nodeProps} data={legacy} onEditData={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit dashboard' }));

    // The chart is still on screen while its fields are open — that is the WYSIWYG part.
    expect(screen.getByText('$42K')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Chart type').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('retypes a widget without losing the numbers the author typed', () => {
    const onEditData = vi.fn();
    render(<CreationNode {...nodeProps} data={legacy} onEditData={onEditData} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit dashboard' }));

    // The legacy fields fold into a KPI, a bar and a donut; the bar is the second.
    const [, barType] = screen.getAllByLabelText('Chart type');
    fireEvent.change(barType!, { target: { value: 'funnel' } });

    const widgets = widgetsFrom(onEditData);
    expect(widgets[1]).toMatchObject({ chart: 'funnel', labels: ['Trial', 'Active'] });
    expect(widgets[1]?.series[0]?.values).toEqual([80, 45]);
  });

  it('adds a widget of the chosen chart type, seeded with drawable data', () => {
    const onEditData = vi.fn();
    render(<CreationNode {...nodeProps} data={legacy} onEditData={onEditData} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit dashboard' }));

    fireEvent.click(screen.getByRole('button', { name: 'Add Gauge' }));

    const widgets = widgetsFrom(onEditData);
    expect(widgets).toHaveLength(4);
    expect(widgets.at(-1)).toMatchObject({ chart: 'gauge', target: 100 });
    expect(widgets.at(-1)?.series[0]?.values.length).toBeGreaterThan(0);
  });

  it('clears the legacy flat fields on save so one dashboard holds one representation', () => {
    const onEditData = vi.fn();
    render(<CreationNode {...nodeProps} data={legacy} onEditData={onEditData} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit dashboard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Gauge' }));

    const [, patch] = onEditData.mock.calls.at(-1) as [string, Record<string, unknown>];
    expect(patch.kpis).toBeUndefined();
    expect(patch.chartLabels).toBeUndefined();
    expect(patch.chartValues).toBeUndefined();
    expect('kpis' in patch && 'chartLabels' in patch && 'chartValues' in patch).toBe(true);
  });

  it('removes a widget and offers an undo', () => {
    const onEditData = vi.fn();
    render(<CreationNode {...nodeProps} data={legacy} onEditData={onEditData} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit dashboard' }));

    fireEvent.click(screen.getByRole('button', { name: 'Remove MRR' }));
    expect(widgetsFrom(onEditData)).toHaveLength(2);
    expect(screen.getByText('Widget deleted')).toBeInTheDocument();
  });
});
