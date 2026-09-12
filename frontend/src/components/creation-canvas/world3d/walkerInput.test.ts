import { beforeEach, describe, expect, it } from 'vitest';
import {
  WALKER_ZOOM_MAX, WALKER_ZOOM_MIN,
  addLook, adjustZoom, clearKeys, isPressed, movementIntent, pressKey, releaseKey, takeLook, walkerZoom,
} from './walkerInput';

/**
 * The walker's input is shared by the keyboard, the touch pad and the drag-look,
 * so what it reports is a contract three sources depend on.
 */

beforeEach(() => {
  clearKeys();
  takeLook();
});

describe('movementIntent', () => {
  it('reads WASD and the arrows as the same four directions', () => {
    pressKey('KeyW');
    expect(movementIntent()).toEqual({ x: 0, z: -1, jump: false });
    releaseKey('KeyW');
    pressKey('ArrowUp');
    expect(movementIntent().z).toBe(-1);
    pressKey('ArrowRight');
    expect(movementIntent().x).toBe(1);
  });

  it('cancels opposite keys rather than picking one', () => {
    pressKey('KeyA');
    pressKey('KeyD');
    expect(movementIntent().x).toBe(0);
  });

  it('jumps on Space or J', () => {
    pressKey('KeyJ');
    expect(movementIntent().jump).toBe(true);
    clearKeys();
    pressKey('Space');
    expect(movementIntent().jump).toBe(true);
    expect(isPressed('Space')).toBe(true);
  });
});

describe('look', () => {
  it('accumulates between frames and drains when taken', () => {
    addLook(0.1, -0.05);
    addLook(0.2, 0);
    expect(takeLook()).toEqual({ dx: expect.closeTo(0.3, 5), dy: expect.closeTo(-0.05, 5) });
    expect(takeLook()).toEqual({ dx: 0, dy: 0 });
  });
});

describe('zoom', () => {
  it('stays inside the third-person range', () => {
    adjustZoom(100);
    expect(walkerZoom()).toBe(WALKER_ZOOM_MAX);
    adjustZoom(-100);
    expect(walkerZoom()).toBe(WALKER_ZOOM_MIN);
  });
});
