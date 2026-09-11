import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { RoomCreation } from '@/lib/canvas/roomCreations';

/**
 * 3D creations in the room.
 *
 * Run through the room's no-WebGL reading — which is what jsdom gets — because that
 * reading must offer exactly what the 3D stands do: every creation listed, and an
 * Open on each one whose kind has a surface.
 */

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations')).realCatalogIntlMock(
  (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
));

// The board's depth projection has its own tests; the room only needs one to exist.
vi.mock('@/components/canvas/canvas3d', () => ({
  canvas3dScene: () => ({ cards: [], links: [], layers: [], plane: { width: 0, height: 0 }, depthMode: 'flow' }),
}));

const { CanvasRoomSurface } = await import('./CanvasRoomSurface');

const creations: RoomCreation[] = [
  { id: 'g1', kind: 'game', title: 'Space Blaster', surface: 'play' },
  { id: 'm1', kind: 'model3d', title: '', surface: null },
];

function renderRoom() {
  const onOpenCreation = vi.fn();
  render(
    <CanvasRoomSurface
      sessionId="room-creations-test"
      sessionTitle="Board"
      members={[]}
      currentUserId={null}
      live={new Map() as never}
      onPresence={vi.fn()}
      sceneInput={{ nodes: [] } as never}
      renderSession={() => <div data-testid="session" />}
      creations={creations}
      onOpenCreation={onOpenCreation}
      onExit={vi.fn()}
    />,
  );
  return onOpenCreation;
}

describe('CanvasRoomSurface — 3D creations', () => {
  it('lists every creation standing in the room, named and kinded', () => {
    renderRoom();
    const rows = screen.getAllByTestId('room-creation');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Space Blaster')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Game')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Untitled')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('3D model')).toBeInTheDocument();
  });

  it('opens a creation into its own surface from the room', () => {
    const onOpenCreation = renderRoom();
    fireEvent.click(screen.getByRole('button', { name: 'Open Space Blaster' }));
    expect(onOpenCreation).toHaveBeenCalledWith(creations[0]);
  });

  it('offers no Open for a model — the room is where you walk round it', () => {
    renderRoom();
    const model = screen.getAllByTestId('room-creation')[1]!;
    expect(within(model).queryByRole('button')).not.toBeInTheDocument();
  });
});
