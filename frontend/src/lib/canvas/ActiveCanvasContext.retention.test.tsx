// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActiveCanvasProvider, useOptionalActiveCanvas, type ActiveCanvas } from './ActiveCanvasContext';
import { KEPT_BOARD_CAP, RELEASE_IDLE_MS } from './boardRetention';

/** Which boards the stage keeps mounted — closing one, and the bound on how many it keeps. */

const board = (sessionId: string, persistence: 'local' | 'server' = 'server'): ActiveCanvas => ({
  sessionId, persistence, focusId: null, shareOpen: false, lens: 'canvas', surface: null,
  prompt: null, present: false, modelComparisonIds: [],
});

const wrapper = ({ children }: { children: ReactNode }) => <ActiveCanvasProvider stageHosted>{children}</ActiveCanvasProvider>;
const kept = (value: ReturnType<typeof useOptionalActiveCanvas>) => value!.opened.map((item) => item.sessionId);

describe('ActiveCanvasProvider board retention', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('closeBoard releases one board and clears the stage when it was on it', () => {
    const { result } = renderHook(() => useOptionalActiveCanvas(), { wrapper });
    act(() => { result.current!.open(board('a')); });
    act(() => { result.current!.open(board('b')); });
    act(() => { result.current!.closeBoard({ sessionId: 'a', persistence: 'server' }); });
    expect(kept(result.current)).toEqual(['b']);
    expect(result.current!.active?.sessionId).toBe('b');
    act(() => { result.current!.closeBoard({ sessionId: 'b', persistence: 'server' }); });
    expect(kept(result.current)).toEqual([]);
    expect(result.current!.active).toBeNull();
  });

  it('releases the least recently used idle board once past the cap, never a busy or browser-held one', () => {
    const { result } = renderHook(() => useOptionalActiveCanvas(), { wrapper });
    act(() => { result.current!.open(board('guest', 'local')); });
    act(() => { result.current!.open(board('busy')); });
    act(() => { result.current!.publishBusy('busy', true); });
    act(() => { result.current!.open(board('old')); });
    act(() => { result.current!.open(board('now')); });
    expect(result.current!.opened.length).toBe(KEPT_BOARD_CAP + 1);
    // Nothing goes while the boards that left are still inside the idle window.
    expect(kept(result.current)).toContain('old');
    act(() => { vi.advanceTimersByTime(RELEASE_IDLE_MS + 10); });
    expect(kept(result.current)).toEqual(['guest', 'busy', 'now']);
  });
});
