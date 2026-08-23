import { describe, expect, it } from 'vitest';
import {
  boundingRect, frameCollapsePatch, frameMemberIds, frameOwners, hiddenByCollapsedFrames, visibleEndpoint,
  type FrameBox,
} from './canvasFrame';

function box(id: string, kind: string, x: number, y: number, width = 100, height = 60, data: Record<string, unknown> = {}): FrameBox {
  return { id, kind, position: { x, y }, size: { width, height }, data };
}

const OUTER = box('outer', 'frame', 0, 0, 600, 400);
const INNER = box('inner', 'frame', 50, 50, 200, 200);

describe('frameOwners', () => {
  it('gives an object to the frame that encloses its centre', () => {
    const owners = frameOwners([OUTER, box('a', 'flowStep', 300, 200)]);
    expect(owners.get('a')).toBe('outer');
  });

  it('gives it to the SMALLEST enclosing frame when frames nest', () => {
    const owners = frameOwners([OUTER, INNER, box('a', 'flowStep', 80, 80)]);
    expect(owners.get('a')).toBe('inner');
    expect(owners.get('inner')).toBe('outer');
  });

  it('does not claim an object drawn outside the rectangle', () => {
    expect(frameOwners([OUTER, box('a', 'flowStep', 900, 900)]).get('a')).toBeUndefined();
  });
});

describe('frameMemberIds', () => {
  it('includes what a nested frame holds, so a section means the section', () => {
    const boxes = [OUTER, INNER, box('a', 'flowStep', 80, 80), box('b', 'flowStep', 400, 300)];
    expect(frameMemberIds('outer', boxes).sort()).toEqual(['a', 'b', 'inner'].sort());
    expect(frameMemberIds('inner', boxes)).toEqual(['a']);
  });
});

describe('hiddenByCollapsedFrames', () => {
  it('hides nothing while every frame is open', () => {
    expect(hiddenByCollapsedFrames([OUTER, box('a', 'flowStep', 300, 200)]).size).toBe(0);
  });

  it('hides members but never the collapsed frame itself', () => {
    const collapsed = { ...OUTER, data: { frameCollapsed: true } };
    const hidden = hiddenByCollapsedFrames([collapsed, box('a', 'flowStep', 300, 200)]);
    expect([...hidden]).toEqual(['a']);
  });

  it('hides a nested frame and its contents with the outer one', () => {
    const collapsed = { ...OUTER, data: { frameCollapsed: true } };
    const hidden = hiddenByCollapsedFrames([collapsed, INNER, box('a', 'flowStep', 80, 80)]);
    expect([...hidden].sort()).toEqual(['a', 'inner']);
  });
});

describe('visibleEndpoint', () => {
  const collapsedOuter = { ...OUTER, data: { frameCollapsed: true } };
  const boxes = [collapsedOuter, INNER, box('a', 'flowStep', 80, 80), box('b', 'flowStep', 900, 900)];
  const hidden = hiddenByCollapsedFrames(boxes);

  it('re-points a connection at the section that swallowed it, so the flow stays connected', () => {
    expect(visibleEndpoint('a', boxes, hidden)).toBe('outer');
  });

  it('leaves a visible endpoint alone', () => {
    expect(visibleEndpoint('b', boxes, hidden)).toBe('b');
  });
});

describe('frameCollapsePatch', () => {
  it('remembers the authored size on the way down and restores it on the way up', () => {
    const sized = box('f', 'frame', 0, 0, 900, 500);
    const down = frameCollapsePatch(sized, true);
    expect(down.size.width).toBeLessThan(900);
    expect(down.data).toMatchObject({ frameCollapsed: true, frameExpandedWidth: 900, frameExpandedHeight: 500 });

    const up = frameCollapsePatch({ ...sized, size: down.size, data: down.data }, false);
    expect(up.size).toEqual({ width: 900, height: 500 });
    expect(up.data.frameCollapsed).toBe(false);
  });

  it('falls back to the default size for a frame that was never sized', () => {
    expect(frameCollapsePatch(box('f', 'frame', 0, 0, 320, 92, { frameCollapsed: true }), false).size.width).toBeGreaterThan(320);
  });
});

describe('boundingRect', () => {
  it('encloses everything with breathing room', () => {
    expect(boundingRect([box('a', 'flowStep', 100, 100), box('b', 'flowStep', 300, 200)], 20))
      .toEqual({ x: 80, y: 80, width: 340, height: 200 });
  });
});
