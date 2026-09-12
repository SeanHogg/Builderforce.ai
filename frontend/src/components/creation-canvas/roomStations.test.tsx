import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import { readProvenance } from '@/lib/canvasApprovalGate';
import type { CanvasBoardBridge } from './canvasBoardBridge';

/**
 * The room's stations, through the room's no-WebGL reading — which is what jsdom gets,
 * and which must offer exactly what the 3D stands do: every station the viewer is
 * entitled to, with an Open that reaches the same panel.
 */

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations')).realCatalogIntlMock(
  (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
));

vi.mock('@/lib/canvas/canvas3d', () => ({
  canvas3dScene: () => ({ cards: [], links: [], layers: [], plane: { width: 0, height: 0 }, depthMode: 'flow' }),
}));

const { CanvasRoomSurface } = await import('./CanvasRoomSurface');
const { CanvasBoardBridgeProvider } = await import('./canvasBoardBridge');

function object(id: string, data: Record<string, unknown>): CanvasObject {
  return { id, type: 'creation', position: { x: 0, y: 0 }, data: data as CanvasObject['data'] };
}

const budget = object('b1', {
  kind: 'budget',
  title: 'Q3 budget',
  provenance: [
    { id: 'p1', field: 'plannedTotal', from: '120,000', to: '150,000', at: '2026-09-10T10:00:00Z', by: { kind: 'brain', ref: 'brain', name: 'Brain' }, source: 'Rebalance Q3' },
  ],
});
const metric = object('m1', { kind: 'metric', title: 'Seats', definition: { id: 'seats', name: 'Seats', sourceObjectId: 'ds', aggregate: { op: 'count' } } });
const dataset = object('ds', { kind: 'dataset', title: 'Seats', columns: ['id'], rows: [{ id: 1 }, { id: 2 }] });

function renderRoom(overrides: Partial<CanvasBoardBridge> = {}) {
  const patch = vi.fn();
  const bridge: CanvasBoardBridge = {
    sessionId: 'room-stations-test',
    title: 'Board',
    persistence: 'local',
    objects: [budget, metric, dataset],
    viewer: { userId: 'u-ben', displayName: 'Ben' },
    edits: { patch, add: vi.fn(() => 'x'), remove: vi.fn() },
    notice: vi.fn(),
    ...overrides,
  };
  render(
    <CanvasBoardBridgeProvider value={bridge}>
      <CanvasRoomSurface
        sessionId="room-stations-test"
        sessionTitle="Board"
        members={[]}
        currentUserId={null}
        live={new Map() as never}
        onPresence={vi.fn()}
        sceneInput={{ nodes: [] } as never}
        renderSession={() => <div data-testid="session" />}
        creations={[]}
        onOpenCreation={vi.fn()}
        onExit={vi.fn()}
      />
    </CanvasBoardBridgeProvider>,
  );
  return { patch, bridge };
}

describe('CanvasRoomSurface — stations', () => {
  it('lists the approval desk and the metrics board with their state', () => {
    renderRoom();
    const rows = screen.getAllByTestId('room-station');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Approval desk')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('1 change waiting')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Metrics board')).toBeInTheDocument();
  });

  it('signs a waiting change off from the desk, stamping it with the viewer', () => {
    const { patch } = renderRoom();
    fireEvent.click(screen.getByRole('button', { name: 'Open Approval desk' }));
    const panel = screen.getByTestId('approval-desk-panel');
    expect(within(panel).getByText('Q3 budget')).toBeInTheDocument();
    expect(within(panel).getByText('120,000 → 150,000')).toBeInTheDocument();
    fireEvent.click(within(panel).getByTestId('approval-approve'));
    expect(patch).toHaveBeenCalledTimes(1);
    const [objectId, written] = patch.mock.calls[0]!;
    expect(objectId).toBe('b1');
    expect(readProvenance(written as Record<string, unknown>)[0]).toMatchObject({ approvedBy: { kind: 'human', ref: 'u-ben' } });
  });

  it('shows the desk read-only to a viewer who cannot edit', () => {
    renderRoom({ edits: null });
    fireEvent.click(screen.getByRole('button', { name: 'Open Approval desk' }));
    const panel = screen.getByTestId('approval-desk-panel');
    expect(within(panel).queryByTestId('approval-approve')).not.toBeInTheDocument();
    expect(within(panel).getByRole('note')).toBeInTheDocument();
  });

  it('stands no desk for a viewer the board cannot name', () => {
    renderRoom({ viewer: null });
    const rows = screen.getAllByTestId('room-station');
    expect(rows).toHaveLength(1);
    expect(within(rows[0]!).getByText('Metrics board')).toBeInTheDocument();
  });

  it('reads the metric set with its evidence', () => {
    renderRoom();
    fireEvent.click(screen.getByRole('button', { name: 'Open Metrics board' }));
    const tile = screen.getByTestId('metric-tile');
    expect(within(tile).getByText('Seats')).toBeInTheDocument();
    expect(within(tile).getByText('2')).toBeInTheDocument();
    expect(within(tile).getByText('From 2 of 2 rows')).toBeInTheDocument();
  });
});
