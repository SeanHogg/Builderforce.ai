import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { FrameBox } from '../domain/canvasFrame';
import type { PlaceableNode } from '../application/ExpandFramesOnPlacement';
import { useExpandFramesOnPlacement } from './useExpandFramesOnPlacement';

interface TestNode extends PlaceableNode {
  style: { width: number; height: number };
  data: Record<string, unknown> & { kind: string };
}

function node(id: string, kind: string, x: number, y: number, width = 100, height = 60, data: Record<string, unknown> = {}): TestNode {
  return { id, position: { x, y }, style: { width, height }, data: { kind, ...data } };
}

function toBox(value: TestNode): FrameBox {
  const collapsed = value.data.kind === 'frame' && value.data.frameCollapsed === true;
  const width = Number(value.data.frameExpandedWidth);
  const height = Number(value.data.frameExpandedHeight);
  return {
    id: value.id,
    kind: value.data.kind,
    position: value.position,
    size: { width: collapsed && width > 0 ? width : value.style.width, height: collapsed && height > 0 ? height : value.style.height },
    data: value.data,
  };
}

const COLLAPSED = node('g', 'frame', 0, 0, 320, 92, { frameCollapsed: true, frameExpandedWidth: 600, frameExpandedHeight: 400 });
const OUTSIDE = node('x', 'note', 1000, 1000);

function useBoard(initial: TestNode[], options: { enabled?: boolean; suspended?: { readonly current: boolean } } = {}) {
  const [nodes, setNodes] = useState(initial);
  useExpandFramesOnPlacement(nodes, setNodes, { toBox, enabled: options.enabled ?? true, suspended: options.suspended });
  return { nodes, setNodes };
}

const frame = (nodes: TestNode[]) => nodes.find((value) => value.id === 'g')!;

describe('useExpandFramesOnPlacement', () => {
  it('does not open a collapsed section on the board it was handed (a load, not a placement)', () => {
    const { result } = renderHook(() => useBoard([COLLAPSED, node('m', 'note', 250, 250)]));
    expect(frame(result.current.nodes).data.frameCollapsed).toBe(true);
  });

  it('waits for a drag to END, then opens the section it was dropped into', () => {
    const { result } = renderHook(() => useBoard([COLLAPSED, OUTSIDE]));
    act(() => result.current.setNodes([COLLAPSED, { ...OUTSIDE, position: { x: 250, y: 250 }, dragging: true }]));
    expect(frame(result.current.nodes).data.frameCollapsed).toBe(true);
    act(() => result.current.setNodes([COLLAPSED, { ...OUTSIDE, position: { x: 250, y: 250 }, dragging: false }]));
    expect(frame(result.current.nodes).data.frameCollapsed).toBe(false);
    expect(frame(result.current.nodes).style).toEqual({ width: 600, height: 400 });
  });

  it('opens the section a pasted / imported / Brain-applied object lands in', () => {
    const { result } = renderHook(() => useBoard([COLLAPSED]));
    act(() => result.current.setNodes((current) => [...current, node('p', 'note', 400, 300)]));
    expect(frame(result.current.nodes).data.frameCollapsed).toBe(false);
  });

  it('leaves a viewer\'s board and an undo restore alone', () => {
    const viewer = renderHook(() => useBoard([COLLAPSED], { enabled: false }));
    act(() => viewer.result.current.setNodes((current) => [...current, node('p', 'note', 400, 300)]));
    expect(frame(viewer.result.current.nodes).data.frameCollapsed).toBe(true);

    const restoring = renderHook(() => useBoard([COLLAPSED], { suspended: { current: true } }));
    act(() => restoring.result.current.setNodes((current) => [...current, node('p', 'note', 400, 300)]));
    expect(frame(restoring.result.current.nodes).data.frameCollapsed).toBe(true);
  });
});
