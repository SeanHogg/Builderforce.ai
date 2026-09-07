import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

import { canvasPlacementFlags } from '@/domains/canvas/domain/canvasObject';
import { CreationCanvas } from './CreationCanvas';

/**
 * "Users don't know how to delete components on the canvas."
 *
 * Removing an object was reachable ONLY by selecting it and pressing Delete. Every other
 * thing a card can do is a visible control in its header row; the one that takes it away
 * was a keyboard shortcut nothing on the board mentioned. These assert that it is now
 * drawn, that it works, and that it honours the placement lock — which is the invariant
 * the trash could most easily have broken.
 */

/** Put one object on the board and hand back its node id. */
function addObject(kind: string) {
  fireEvent.click(screen.getByTestId('canvas-quick-add'));
  fireEvent.click(screen.getByTestId(`canvas-picker-${kind}`));
  return screen.getByTestId(`canvas-node-${kind}`).getAttribute('data-node-id')!;
}

describe('deleting an object from its card', () => {
  it('draws a trash on the card and takes the object off the board', () => {
    render(<CreationCanvas sessionId="node-delete-test" persistence="local" />);
    const nodeId = addObject('code');

    // The attribute rather than `toHaveAccessibleName`, for the reason spelled out in
    // `canvasNodeDensity.test.tsx`: React Flow's node subtree computes as hidden under
    // jsdom, so the accessible name comes back empty for every card control.
    const trash = screen.getByTestId(`canvas-node-delete-${nodeId}`);
    expect(trash).toHaveAttribute('aria-label', 'Delete Code workspace');
    expect(trash).not.toBeDisabled();

    fireEvent.click(trash);
    expect(screen.queryByTestId('canvas-node-code')).toBeNull();
  });

  /** Present and explained, not absent: "you cannot do this yet" and "this object is not
   *  deletable" are different statements, and only one of them is true. */
  it('disables the trash on a locked object and refuses the delete', () => {
    render(<CreationCanvas sessionId="node-delete-locked-test" persistence="local" />);
    const nodeId = addObject('code');

    fireEvent.click(screen.getByTestId('canvas-node-code'));
    fireEvent.click(screen.getByRole('button', { name: 'Lock' }));

    const trash = screen.getByTestId(`canvas-node-delete-${nodeId}`);
    expect(trash).toBeDisabled();
    expect(trash).toHaveAttribute('aria-label', 'Code workspace is locked — unlock it to delete');

    fireEvent.click(trash);
    expect(screen.getByTestId('canvas-node-code')).toBeInTheDocument();
  });

  /**
   * The bar has to carry it too. A sticky, an annotation and a docked conversation draw
   * no header row at all, so they have nowhere to put a trash — and a selection of twelve
   * objects has no single card to press one on.
   */
  it('offers Delete in the selection toolbar', () => {
    render(<CreationCanvas sessionId="selection-delete-test" persistence="local" />);
    addObject('code');

    fireEvent.click(screen.getByTestId('canvas-node-code'));
    fireEvent.click(screen.getByTestId('canvas-selection-delete'));
    expect(screen.queryByTestId('canvas-node-code')).toBeNull();
  });
});

/**
 * The lock's two halves. Every writer of the lock used to spell `draggable: !locked` by
 * hand and leave `deletable` alone, so a locked object could not be nudged a pixel and
 * could still be erased outright with the Delete key — React Flow deletes on that key
 * itself, without passing through the board's own handler.
 */
describe('canvasPlacementFlags', () => {
  it('locks movement and removal together', () => {
    expect(canvasPlacementFlags(true)).toEqual({ draggable: false, deletable: false });
    expect(canvasPlacementFlags(false)).toEqual({ draggable: true, deletable: true });
  });
});
