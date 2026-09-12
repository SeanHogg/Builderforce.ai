import { describe, expect, it } from 'vitest';
import type { FrameBox } from '../domain/canvasFrame';
import {
  expandFrames, framesToExpandOnPlacement, placedObjectIds, placementInFlight, withFrameCollapsed, type PlaceableNode,
} from './ExpandFramesOnPlacement';

interface TestNode extends PlaceableNode {
  style: { width: number; height: number };
  data: Record<string, unknown> & { kind: string };
}

function node(id: string, kind: string, x: number, y: number, width = 100, height = 60, data: Record<string, unknown> = {}): TestNode {
  return { id, position: { x, y }, style: { width, height }, data: { kind, ...data } };
}

/** The board's own measurement rule: a collapsed frame counts at its remembered OPEN size. */
function toBox(value: TestNode): FrameBox {
  const collapsed = value.data.kind === 'frame' && value.data.frameCollapsed === true;
  const width = Number(value.data.frameExpandedWidth);
  const height = Number(value.data.frameExpandedHeight);
  return {
    id: value.id,
    kind: value.data.kind,
    position: value.position,
    size: {
      width: collapsed && width > 0 ? width : value.style.width,
      height: collapsed && height > 0 ? height : value.style.height,
    },
    data: value.data,
  };
}

const COLLAPSED = node('g', 'frame', 0, 0, 320, 92, { frameCollapsed: true, frameExpandedWidth: 600, frameExpandedHeight: 400 });

describe('placedObjectIds', () => {
  it('names objects that are new or moved, and nothing that stayed put', () => {
    const before = [node('a', 'note', 0, 0), node('b', 'note', 10, 10)];
    const after = [node('a', 'note', 0, 0), node('b', 'note', 50, 10), node('c', 'note', 5, 5)];
    expect(placedObjectIds(before, after)).toEqual(['b', 'c']);
  });
});

describe('placementInFlight', () => {
  it('is true only while something is being dragged', () => {
    expect(placementInFlight([node('a', 'note', 0, 0)])).toBe(false);
    expect(placementInFlight([{ ...node('a', 'note', 0, 0), dragging: true }])).toBe(true);
  });
});

describe('framesToExpandOnPlacement', () => {
  it('opens a collapsed frame an object was DROPPED into (a moved object)', () => {
    const before = [COLLAPSED, node('x', 'note', 1000, 1000)];
    const after = [COLLAPSED, node('x', 'note', 250, 250)];
    expect(framesToExpandOnPlacement(before, after, toBox)).toEqual(['g']);
  });

  it('opens a collapsed frame a NEW object was placed into (paste, import, Brain)', () => {
    expect(framesToExpandOnPlacement([COLLAPSED], [COLLAPSED, node('x', 'note', 400, 300)], toBox)).toEqual(['g']);
  });

  it('opens nothing when nothing was placed', () => {
    const board = [COLLAPSED, node('x', 'note', 250, 250)];
    expect(framesToExpandOnPlacement(board, board, toBox)).toEqual([]);
  });
});

describe('expandFrames', () => {
  it('restores the authored size and marks the frame open — the same edit as a manual expand', () => {
    const [frame] = expandFrames([COLLAPSED, node('x', 'note', 250, 250)], ['g'], toBox);
    expect(frame!.style).toEqual({ width: 600, height: 400 });
    expect(frame!.data.frameCollapsed).toBe(false);
    expect(frame!.data.frameExpandedWidth).toBe(600);
  });

  it('returns the same board when every named frame is already open', () => {
    const board = [node('g', 'frame', 0, 0, 600, 400)];
    expect(expandFrames(board, ['g'], toBox)).toBe(board);
  });
});

describe('withFrameCollapsed', () => {
  it('collapses to a chip and remembers the drawn size', () => {
    const open = node('f', 'frame', 0, 0, 900, 500);
    const closed = withFrameCollapsed(open, true, toBox(open));
    expect(closed.data).toMatchObject({ frameCollapsed: true, frameExpandedWidth: 900, frameExpandedHeight: 500 });
    expect(closed.style.width).toBeLessThan(900);
  });
});
