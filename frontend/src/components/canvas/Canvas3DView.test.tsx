import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Canvas3DView, type Canvas3DMove } from './Canvas3DView';
import { Canvas3DControlsProvider } from './canvas3dControls';
import type { Canvas3DNode } from './canvas3d';

vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl')>();
  const messages = (await import('@/i18n/messages/en.json')).default as Record<string, unknown>;
  return {
    ...actual,
    useTranslations: (namespace?: string) => (key: string, values?: Record<string, unknown>) => {
      const path = (namespace ? `${namespace}.${key}` : key).split('.');
      const value = path.reduce<unknown>((current, segment) => current && typeof current === 'object'
        ? (current as Record<string, unknown>)[segment]
        : undefined, messages);
      const copy = typeof value === 'string' ? value : namespace ? `${namespace}.${key}` : key;
      return Object.entries(values ?? {}).reduce((result, [name, replacement]) => result.replace(`{${name}}`, String(replacement)), copy);
    },
  };
});

/**
 * The 3D space as a thing the user's hands work on.
 *
 * The geometry is proved in `canvas3d.test.ts`; what is proved here is the wiring
 * between a gesture and the canvas underneath — which object a drag picks up,
 * which way it travels, and what a locked or read-only object refuses to do.
 * Mounted directly rather than through a host canvas, so it stays a test of the
 * space itself.
 */
const nodes: Array<Canvas3DNode & { locked?: boolean }> = [
  { id: 'alpha', position: { x: 0, y: 0 }, style: { width: 200, height: 120 } },
  { id: 'beta', position: { x: 400, y: 0 }, style: { width: 200, height: 120 } },
  { id: 'locked', position: { x: 800, y: 0 }, style: { width: 200, height: 120 }, locked: true },
];

const describe3D = (node: (typeof nodes)[number]) => ({
  label: node.id,
  group: 'Build',
  ...(node.locked ? { locked: true } : {}),
});

function renderSpace(onMove?: (moves: readonly Canvas3DMove[]) => void, selectedIds: string[] = []) {
  const onSelect = vi.fn();
  render(<Canvas3DControlsProvider>
    <Canvas3DView
      nodes={nodes}
      edges={[{ source: 'alpha', target: 'beta' }]}
      describe={describe3D}
      selectedIds={selectedIds}
      onSelect={onSelect}
      {...(onMove ? { onMove } : {})}
      onExit={vi.fn()}
    />
  </Canvas3DControlsProvider>);
  const card = (label: string) => screen.getByRole('button', { name: new RegExp(label) });
  return { onSelect, card };
}

/** A whole drag: pick the card up, travel, let go. */
function drag(card: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }, shiftKey = false) {
  fireEvent.pointerDown(card, { clientX: from.x, clientY: from.y, button: 0, pointerId: 1, shiftKey });
  fireEvent.pointerMove(window, { clientX: to.x, clientY: to.y, pointerId: 1 });
  fireEvent.pointerUp(window, { pointerId: 1 });
}

describe('Canvas3DView', () => {
  it('carries an object across its plane, and never through depth by accident', () => {
    const onMove = vi.fn();
    const { card } = renderSpace(onMove);

    drag(card('alpha'), { x: 40, y: 40 }, { x: 190, y: 40 });

    expect(onMove).toHaveBeenCalled();
    const moves = onMove.mock.calls.flat().flat() as Canvas3DMove[];
    expect(moves.every((move) => move.id === 'alpha')).toBe(true);
    // Dragging right travels right across the board, and stays on its plane.
    expect(moves.reduce((total, move) => total + move.dx, 0)).toBeGreaterThan(0);
    expect(moves.every((move) => move.dz === 0)).toBe(true);
  });

  it('lifts an object through depth when the drag is held with shift', () => {
    const onMove = vi.fn();
    const { card } = renderSpace(onMove);

    drag(card('alpha'), { x: 40, y: 200 }, { x: 40, y: 80 }, true);

    const moves = onMove.mock.calls.flat().flat() as Canvas3DMove[];
    expect(moves.length).toBeGreaterThan(0);
    // Pulled up-screen is toward the viewer, and depth alone: the object must not
    // slide across the board while it is being lifted off it.
    expect(moves.reduce((total, move) => total + move.dz, 0)).toBeGreaterThan(0);
    expect(moves.every((move) => move.dx === 0 && move.dy === 0)).toBe(true);
  });

  it('takes the whole selection along when one of the selected objects is dragged', () => {
    const onMove = vi.fn();
    const { card } = renderSpace(onMove, ['alpha', 'beta']);

    drag(card('alpha'), { x: 40, y: 40 }, { x: 160, y: 90 });

    const moved = new Set((onMove.mock.calls.flat().flat() as Canvas3DMove[]).map((move) => move.id));
    expect(moved).toEqual(new Set(['alpha', 'beta']));
  });

  it('refuses to move a locked object, and turns the space instead', () => {
    const onMove = vi.fn();
    const { card } = renderSpace(onMove);
    const locked = card('locked');

    expect(locked).toHaveAttribute('data-movable', 'false');
    drag(locked, { x: 40, y: 40 }, { x: 190, y: 40 });
    expect(onMove).not.toHaveBeenCalled();
  });

  it('is a reading of the board, not a handle on it, when the canvas cannot be edited', () => {
    const { card } = renderSpace();
    expect(card('alpha')).toHaveAttribute('data-movable', 'false');
    // A viewer is told what the space does, not what they cannot do to it.
    expect(screen.getByLabelText(/Drag to orbit/)).toBeInTheDocument();
  });

  it('moves a focused object from the keyboard, in depth with shift', () => {
    const onMove = vi.fn();
    const { card } = renderSpace(onMove);

    fireEvent.keyDown(card('alpha'), { key: 'ArrowRight' });
    expect(onMove).toHaveBeenLastCalledWith([{ id: 'alpha', dx: 12, dy: 0, dz: 0 }]);

    fireEvent.keyDown(card('alpha'), { key: 'ArrowUp', shiftKey: true });
    expect(onMove).toHaveBeenLastCalledWith([{ id: 'alpha', dx: 0, dy: 0, dz: 40 }]);
  });

  it('opens an object on a click, but not at the end of a drag', () => {
    const onMove = vi.fn();
    const { card, onSelect } = renderSpace(onMove);

    fireEvent.click(card('beta'));
    expect(onSelect).toHaveBeenCalledWith('beta');

    onSelect.mockClear();
    drag(card('alpha'), { x: 40, y: 40 }, { x: 190, y: 40 });
    fireEvent.click(card('alpha'), { detail: 1 });
    expect(onSelect).not.toHaveBeenCalled();

    // Enter on a focused card is still a click, even right after a drag.
    fireEvent.click(card('alpha'), { detail: 0 });
    expect(onSelect).toHaveBeenCalledWith('alpha');
  });
});
