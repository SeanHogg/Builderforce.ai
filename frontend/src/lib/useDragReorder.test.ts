import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { moveItem, useDragReorder } from './useDragReorder';

/** Minimal DataTransfer stand-in — jsdom fires no real drags, so the hook's handlers are
 *  called directly with the shape they read. */
function dataTransfer() {
  const store: Record<string, string> = {};
  return {
    effectAllowed: '',
    dropEffect: '',
    setData: (type: string, value: string) => { store[type] = value; },
    getData: (type: string) => store[type] ?? '',
  };
}

/** A drag event whose currentTarget contains nothing (so dragleave always counts). */
function dragEvent(dt = dataTransfer()) {
  return {
    dataTransfer: dt,
    preventDefault: vi.fn(),
    currentTarget: { contains: () => false } as unknown as HTMLElement,
    relatedTarget: null,
  } as never;
}

describe('moveItem', () => {
  it('moves an item to the target index rather than swapping with it', () => {
    // A swap would give ['c','b','a']; a drag from position 1 to 3 must SLIDE the rest up.
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });

  it('moves backwards', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });

  it('copies rather than mutating, and no-ops out of range', () => {
    const input = ['a', 'b'];
    expect(moveItem(input, 0, 0)).toEqual(['a', 'b']);
    expect(moveItem(input, 0, 5)).toEqual(['a', 'b']);
    expect(moveItem(input, -1, 1)).toEqual(['a', 'b']);
    expect(input).toEqual(['a', 'b']);
  });
});

describe('useDragReorder', () => {
  it('commits the dragged key into the drop target position', () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useDragReorder(['a', 'b', 'c'], onReorder));

    const dt = dataTransfer();
    act(() => result.current.dragHandleProps('a').onDragStart(dragEvent(dt)));
    act(() => result.current.dropTargetProps('c').onDrop(dragEvent(dt)));

    expect(onReorder).toHaveBeenCalledWith(['b', 'c', 'a']);
  });

  it('ignores a drop on the row being dragged', () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useDragReorder(['a', 'b'], onReorder));

    const dt = dataTransfer();
    act(() => result.current.dragHandleProps('a').onDragStart(dragEvent(dt)));
    act(() => result.current.dropTargetProps('a').onDrop(dragEvent(dt)));

    expect(onReorder).not.toHaveBeenCalled();
  });

  it('does not claim a drag that started outside the list', () => {
    // No dragstart from this list: preventDefault must NOT be called, or an unrelated
    // drag (a kanban card, a file) would render as droppable here.
    const { result } = renderHook(() => useDragReorder(['a', 'b'], vi.fn()));
    const e = dragEvent();
    act(() => result.current.dropTargetProps('b').onDragOver(e));
    expect((e as unknown as { preventDefault: ReturnType<typeof vi.fn> }).preventDefault).not.toHaveBeenCalled();
    expect(result.current.dropKey).toBeNull();
  });

  it('exposes the hovered row as the drop target, never the dragged row itself', () => {
    const { result } = renderHook(() => useDragReorder(['a', 'b'], vi.fn()));
    act(() => result.current.dragHandleProps('a').onDragStart(dragEvent()));

    act(() => result.current.dropTargetProps('a').onDragOver(dragEvent()));
    expect(result.current.dropKey).toBeNull();

    act(() => result.current.dropTargetProps('b').onDragOver(dragEvent()));
    expect(result.current.dropKey).toBe('b');
    expect(result.current.draggingKey).toBe('a');

    act(() => result.current.dragHandleProps('a').onDragEnd());
    expect(result.current.dropKey).toBeNull();
    expect(result.current.draggingKey).toBeNull();
  });

  it('nudges one slot and stops at the ends', () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useDragReorder(['a', 'b', 'c'], onReorder));

    act(() => result.current.nudge('c', -1));
    expect(onReorder).toHaveBeenCalledWith(['a', 'c', 'b']);

    onReorder.mockClear();
    act(() => result.current.nudge('a', -1));
    act(() => result.current.nudge('c', 1));
    act(() => result.current.nudge('missing', 1));
    expect(onReorder).not.toHaveBeenCalled();
  });
});
