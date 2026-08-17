/**
 * `--composer-space` was the literal `112px` — a guess at the prompt dock's
 * height. Everything anchored to the bottom of the board reads it, so when the
 * dock grew (the execution chip appears the moment a run starts) the phone's
 * command rail was underneath it. These pin the measurement, not the number.
 */

import { render } from '@testing-library/react';
import { describe, expect, it, vi, beforeAll } from 'vitest';
import { useRef } from 'react';
import { useChromeSpace } from './useChromeSpace';

/** jsdom has no ResizeObserver. A no-op stub would make the "it grows" test pass
 *  vacuously — the hook publishes once on mount and would never be asked again —
 *  so this one keeps its callbacks and `resize()` fires them, which is the event
 *  the browser raises when the dock's height actually changes. */
const observers: Array<() => void> = [];
/** Fire the observers, then WAIT A FRAME: notifications are delivered through
 *  `observeResizeOnAnimationFrame`, so the republish happens on the next animation
 *  frame rather than inside the callback. Asserting synchronously read the value from
 *  before the resize. */
const resize = async () => {
  observers.forEach((callback) => callback());
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
};

beforeAll(() => {
  globalThis.ResizeObserver = class {
    constructor(callback: () => void) { observers.push(callback); }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

/** jsdom gives every element a zero rect, so the geometry is stated per element. */
function stubRect(element: HTMLElement, rect: { top: number; bottom: number }) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    ...rect, left: 0, right: 0, width: 0, height: rect.bottom - rect.top, x: 0, y: rect.top, toJSON: () => ({}),
  } as DOMRect);
}

function Board({ withDock, dockTop, gap = 0 }: { withDock: boolean; dockTop: number; gap?: number }) {
  const board = useRef<HTMLDivElement | null>(null);
  const dockRef = useChromeSpace(board, '--composer-space', { gap });
  return (
    <div
      ref={(node) => {
        board.current = node;
        if (node) stubRect(node, { top: 0, bottom: 800 });
      }}
      data-testid="board"
    >
      {withDock && (
        <div
          ref={(node) => {
            if (node) stubRect(node, { top: dockTop, bottom: 800 });
            dockRef(node);
          }}
          data-testid="dock"
        />
      )}
    </div>
  );
}

/** The top-band counterpart: a card floating at the host's TOP edge. */
function TopChrome({ bottom, gap }: { bottom: number; gap: number }) {
  const board = useRef<HTMLDivElement | null>(null);
  const cardRef = useChromeSpace(board, '--canvas-top-chrome-space', { edge: 'top', gap });
  return (
    <div
      ref={(node) => { board.current = node; if (node) stubRect(node, { top: 0, bottom: 800 }); }}
      data-testid="board"
    >
      <div ref={(node) => { if (node) stubRect(node, { top: 14, bottom }); cardRef(node); }} data-testid="card" />
    </div>
  );
}

const spaceOf = (element: HTMLElement) => element.style.getPropertyValue('--composer-space');

describe('useChromeSpace', () => {
  it('publishes the distance from the board bottom to the dock top', () => {
    const { getByTestId } = render(<Board withDock dockTop={650} />);
    expect(spaceOf(getByTestId('board'))).toBe('150px');
  });

  it('grows when the dock does — the execution chip pushes the rail up', async () => {
    const { getByTestId, rerender } = render(<Board withDock dockTop={650} />);
    expect(spaceOf(getByTestId('board'))).toBe('150px');
    // A run starts: the utilities row appears and the dock's top edge rises.
    rerender(<Board withDock dockTop={600} />);
    await resize();
    expect(spaceOf(getByTestId('board'))).toBe('200px');
  });

  it('reserves nothing in presentation mode, where there is no prompt', () => {
    const { getByTestId } = render(<Board withDock={false} dockTop={650} />);
    expect(spaceOf(getByTestId('board'))).toBe('0px');
  });
});
