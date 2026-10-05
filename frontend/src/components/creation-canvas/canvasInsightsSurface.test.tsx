import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { CanvasBoardBridge } from './canvasBoardBridge';

/**
 * PRD 32 W10 — Insights leads with THIS canvas's own metrics (the board bridge), ahead of
 * the workspace's pinned widgets, which are unchanged. No metric on the board → an empty
 * state with the one press that fixes it, through the canvas's turn door.
 */

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations')).realCatalogIntlMock(
  (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
));

const pins = vi.hoisted(() => ({ value: { pinned: [] as string[], loading: false } }));
vi.mock('@/lib/widgets/PinsProvider', () => ({ usePins: () => pins.value }));
vi.mock('@/components/widgets/WidgetGrid', () => ({
  WidgetGrid: ({ ids }: { ids: readonly string[] }) => <div data-testid="widget-grid">{ids.join(',')}</div>,
}));
vi.mock('@/components/widgets/ReorderableWidgetGrid', () => ({
  ReorderableWidgetGrid: ({ ids }: { ids: readonly string[] }) => <div data-testid="pinned-grid">{ids.join(',')}</div>,
}));
vi.mock('@/components/insights/LensShell', () => ({ DaysWindowSelect: () => null }));

const { CanvasInsightsSurface } = await import('./CanvasInsightsSurface');
const { CanvasBoardBridgeProvider } = await import('./canvasBoardBridge');
const { renderWithPhase } = await import('./phase/testPhaseProvider');

function object(id: string, data: Record<string, unknown>): CanvasObject {
  return { id, type: 'creation', position: { x: 0, y: 0 }, data: data as CanvasObject['data'] };
}

const metric = object('m1', { kind: 'metric', title: 'Seats', definition: { id: 'seats', name: 'Seats', sourceObjectId: 'ds', aggregate: { op: 'count' } } });
const dataset = object('ds', { kind: 'dataset', title: 'Seats', columns: ['id'], rows: [{ id: 1 }, { id: 2 }] });

function renderInsights({ objects = [], withBoard = true, askBrain = vi.fn() }: { objects?: CanvasObject[]; withBoard?: boolean; askBrain?: (prompt: string) => void } = {}) {
  const bridge: CanvasBoardBridge = {
    sessionId: 'insights-test',
    title: 'Board',
    persistence: 'local',
    objects,
    viewer: { userId: 'u-ben', displayName: 'Ben' },
    edits: { patch: vi.fn(), add: vi.fn(() => 'x'), remove: vi.fn() },
    notice: vi.fn(),
  };
  const surface = <CanvasInsightsSurface onExit={vi.fn()} />;
  renderWithPhase(withBoard ? <CanvasBoardBridgeProvider value={bridge}>{surface}</CanvasBoardBridgeProvider> : surface, { phase: 'measure', nodes: objects, askBrain });
  return { askBrain };
}

beforeEach(() => {
  pins.value = { pinned: [], loading: false };
});

describe('CanvasInsightsSurface — This canvas', () => {
  it("reads the board's own metrics under This canvas", () => {
    renderInsights({ objects: [metric, dataset] });
    const section = screen.getByTestId('canvas-insights-this-canvas');
    expect(within(section).getByRole('heading', { name: 'This canvas' })).toBeInTheDocument();
    const tile = within(section).getByTestId('metric-tile');
    expect(within(tile).getByText('Seats')).toBeInTheDocument();
    expect(within(tile).getByText('2')).toBeInTheDocument();
    expect(within(tile).getByText('From 2 of 2 rows')).toBeInTheDocument();
    expect(within(section).queryByText('No metric on this board yet')).not.toBeInTheDocument();
  });

  it('says there is no metric yet and lets Brain define one through the turn door', () => {
    const { askBrain } = renderInsights({ objects: [dataset] });
    const section = screen.getByTestId('canvas-insights-this-canvas');
    expect(within(section).getByText('No metric on this board yet')).toBeInTheDocument();
    expect(within(section).queryByTestId('metric-tile')).not.toBeInTheDocument();
    fireEvent.click(within(section).getByRole('button', { name: 'Let Brain define it' }));
    expect(askBrain).toHaveBeenCalledTimes(1);
    expect(askBrain).toHaveBeenCalledWith('Define the one metric that says whether this app is working, with a target, and put it on the board.');
  });

  it('draws no This canvas section outside a board', () => {
    renderInsights({ withBoard: false });
    expect(screen.queryByTestId('canvas-insights-this-canvas')).not.toBeInTheDocument();
    expect(screen.getByTestId('widget-grid')).toHaveTextContent('overview.ask');
  });
});

describe('CanvasInsightsSurface — pinned widgets unchanged', () => {
  it('still shows the Ask card and the empty-dashboard state when nothing is pinned', () => {
    renderInsights({ objects: [metric, dataset] });
    expect(screen.getByTestId('widget-grid')).toHaveTextContent('overview.ask');
    expect(screen.getByText('Your dashboard is empty')).toBeInTheDocument();
    expect(screen.queryByTestId('pinned-grid')).not.toBeInTheDocument();
  });

  it("shows the reader's pins below the board's metrics", () => {
    pins.value = { pinned: ['overview.cost', 'overview.runs'], loading: false };
    renderInsights({ objects: [metric, dataset] });
    const pinned = screen.getByTestId('pinned-grid');
    expect(pinned).toHaveTextContent('overview.cost,overview.runs');
    expect(screen.queryByText('Your dashboard is empty')).not.toBeInTheDocument();
    // This canvas comes first in the document.
    const section = screen.getByTestId('canvas-insights-this-canvas');
    expect(section.compareDocumentPosition(pinned) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
