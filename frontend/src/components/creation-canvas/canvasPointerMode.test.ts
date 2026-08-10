/**
 * The flat board's interaction contract. These assertions are the verdict a touch change
 * needs — `CreationCanvas.test.tsx` cannot currently give one (3D-group hang), so the
 * decisions were extracted into a pure function precisely so they could be checked here.
 */
import { describe, expect, it } from 'vitest';
import { COARSE_TARGET_MIN_PX, canvasInteractionProps } from './canvasPointerMode';

const props = (over: Partial<Parameters<typeof canvasInteractionProps>[0]> = {}) =>
  canvasInteractionProps({ gesture: 'pan', pointer: 'fine', drawing: false, ...over });

describe('canvasInteractionProps', () => {
  it('never asks React Flow to both pan and marquee on the primary drag', () => {
    // The original bug: `selectionOnDrag` was on alongside the default `panOnDrag`, and
    // React Flow silently resolves that in favour of panning — so the marquee only ever
    // worked via a modifier key, and touch has none.
    for (const gesture of ['pan', 'select'] as const) {
      for (const pointer of ['coarse', 'fine'] as const) {
        for (const drawing of [true, false]) {
          const result = canvasInteractionProps({ gesture, pointer, drawing });
          expect(result.panAndSelectConflict).toBe(false);
          expect(result.selectionOnDrag && result.panOnDrag === true).toBe(false);
        }
      }
    }
  });

  it('pans on the primary drag in pan mode', () => {
    expect(props({ gesture: 'pan' })).toMatchObject({ panOnDrag: true, selectionOnDrag: false });
  });

  it('gives the primary drag to the marquee in select mode, keeping middle/right to pan', () => {
    // Keeping a pan gesture in select mode is what stops the mode being a trap for a
    // mouse user who forgot they were in it.
    expect(props({ gesture: 'select' })).toMatchObject({ panOnDrag: [1, 2], selectionOnDrag: true });
  });

  it('reaches the marquee on touch, where there is no modifier key to hold', () => {
    const touch = props({ gesture: 'select', pointer: 'coarse' });
    expect(touch.selectionOnDrag).toBe(true);
    expect(touch.multiSelectionKeyCode).toBeNull();
  });

  it('keeps pinch-zoom available in BOTH gestures and on both pointer kinds', () => {
    // Pinch is the only pan/zoom gesture left on touch while the finger draws a marquee,
    // so it must never be switched off.
    for (const gesture of ['pan', 'select'] as const) {
      for (const pointer of ['coarse', 'fine'] as const) {
        expect(canvasInteractionProps({ gesture, pointer, drawing: false }).zoomOnPinch).toBe(true);
      }
    }
  });

  it('raises the drag threshold for a finger so a tap selects instead of dragging', () => {
    expect(props({ pointer: 'coarse' }).nodeDragThreshold).toBeGreaterThan(props({ pointer: 'fine' }).nodeDragThreshold);
    expect(props({ pointer: 'coarse' }).nodeDragThreshold).toBeGreaterThanOrEqual(8);
  });

  it('drops double-tap zoom on touch but keeps double-click zoom on a mouse', () => {
    expect(props({ pointer: 'coarse' }).zoomOnDoubleClick).toBe(false);
    expect(props({ pointer: 'fine' }).zoomOnDoubleClick).toBe(true);
  });

  it('keeps modifier multi-select on a mouse', () => {
    expect(props({ pointer: 'fine' }).multiSelectionKeyCode).toEqual(['Meta', 'Control']);
  });

  it('lets drawing override BOTH gestures, so a stroke cannot move the board', () => {
    for (const gesture of ['pan', 'select'] as const) {
      for (const pointer of ['coarse', 'fine'] as const) {
        expect(canvasInteractionProps({ gesture, pointer, drawing: true }))
          .toMatchObject({ panOnDrag: false, selectionOnDrag: false });
      }
    }
  });
});

describe('COARSE_TARGET_MIN_PX', () => {
  it('is the WCAG 2.2 minimum target size', () => {
    expect(COARSE_TARGET_MIN_PX).toBe(44);
  });
});
