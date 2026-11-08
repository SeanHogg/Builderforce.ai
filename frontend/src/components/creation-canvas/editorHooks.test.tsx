import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { CreationNodeData } from './types';
import { CreationNodeActionsContext } from './bodies/nodeActions';
import { useAnimationEditor } from './animation/useAnimationEditor';
import { useCadEditor } from './cad/useCadEditor';
import { useModel3dEditor } from './model3d/useModel3dEditor';
import type { AnimationState } from '@/lib/creation/animation/animationState';
import type { CadState } from '@/lib/creation/cad/cadState';
import type { Model3dState } from '@/lib/creation/model3d/model3dState';

/** A card that CAN edit: the board's `edit` action is the spy. */
function withEdit(edit: (patch: Partial<CreationNodeData>) => void) {
  return ({ children }: { children: ReactNode }) => createElement(CreationNodeActionsContext.Provider, { value: { edit } }, children);
}

describe('useAnimationEditor', () => {
  it('adds a frame after the active one, writes the whole strip, and selects the new frame', () => {
    const edit = vi.fn();
    const { result } = renderHook(() => useAnimationEditor({ kind: 'animation', title: 'Loop' } as CreationNodeData), { wrapper: withEdit(edit) });
    expect(result.current.editable).toBe(true);
    expect(result.current.state.frames).toHaveLength(1);
    act(() => { result.current.actions.addFrame(); });
    const written = (edit.mock.calls[0]![0] as { animation: AnimationState }).animation;
    expect(written.frames).toHaveLength(2);
    expect(result.current.activeId).toBe(written.frames[1]!.id);
  });

  it('is read-only, and writes nothing, on a card with no edit action', () => {
    const { result } = renderHook(() => useAnimationEditor({ kind: 'animation', title: 'Loop' } as CreationNodeData));
    expect(result.current.editable).toBe(false);
    expect(() => act(() => { result.current.actions.addFrame(); })).not.toThrow();
  });
});

describe('useCadEditor', () => {
  it('draws a shape onto the active layer, writes the drawing, and selects the shape', () => {
    const edit = vi.fn();
    const { result } = renderHook(() => useCadEditor({ kind: 'cad', title: 'Plate' } as CreationNodeData), { wrapper: withEdit(edit) });
    const layer = result.current.state.activeLayerName;
    act(() => { result.current.draw({ id: 'r1', kind: 'rect', layer, x: 1, y: 2, width: 10, height: 5 }); });
    const written = (edit.mock.calls[0]![0] as { cadState: CadState }).cadState;
    expect(written.shapes.map((shape) => shape.id)).toContain('r1');
    expect(result.current.selection).toEqual(['r1']);
  });
});

describe('useModel3dEditor', () => {
  it('adds a primitive, writes the whole scene, and selects the new part', () => {
    const edit = vi.fn();
    const { result } = renderHook(() => useModel3dEditor({ kind: 'model3d', title: 'Part' } as CreationNodeData, edit));
    expect(result.current.state.entities).toHaveLength(0);
    act(() => { result.current.actions.add('box'); });
    const written = (edit.mock.calls[0]![0] as { modelState: Model3dState }).modelState;
    expect(written.entities).toHaveLength(1);
    expect(written.entities[0]).toMatchObject({ kind: 'box' });
    expect(result.current.selection).toEqual([written.entities[0]!.id]);
  });

  it('applies two edits in one tick to the latest scene instead of overwriting', () => {
    const edit = vi.fn();
    const { result } = renderHook(() => useModel3dEditor({ kind: 'model3d', title: 'Part' } as CreationNodeData, edit));
    act(() => { result.current.actions.add('box'); result.current.actions.add('sphere'); });
    const last = (edit.mock.calls[1]![0] as { modelState: Model3dState }).modelState;
    expect(last.entities.map((entity) => entity.kind)).toEqual(['box', 'sphere']);
  });
});
