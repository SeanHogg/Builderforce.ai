import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { oppositeSide, useCounterBrainDockSide } from './useCounterBrainDockSide';
import {
  BRAIN_DOCK_STORAGE_KEY,
  DEFAULT_BRAIN_DOCK_PREFERENCES,
  writeBrainDockPreferences,
} from '../brainDockPreferences';

/** PRD 33 §4.1 — the Insights panel docks on the side the Brain is NOT on. */
afterEach(() => { window.localStorage.clear(); });

describe('useCounterBrainDockSide', () => {
  it('is the opposite of the default dock (right) when nothing is stored', () => {
    const { result } = renderHook(() => useCounterBrainDockSide());
    expect(result.current).toBe('left');
  });

  it('reads the stored dock side', () => {
    window.localStorage.setItem(BRAIN_DOCK_STORAGE_KEY, JSON.stringify({ ...DEFAULT_BRAIN_DOCK_PREFERENCES, side: 'left' }));
    const { result } = renderHook(() => useCounterBrainDockSide());
    expect(result.current).toBe('right');
  });

  it('flips live when the dock moves in this tab', () => {
    const { result } = renderHook(() => useCounterBrainDockSide());
    expect(result.current).toBe('left');
    act(() => { writeBrainDockPreferences({ ...DEFAULT_BRAIN_DOCK_PREFERENCES, side: 'left' }); });
    expect(result.current).toBe('right');
    act(() => { writeBrainDockPreferences({ ...DEFAULT_BRAIN_DOCK_PREFERENCES, side: 'right' }); });
    expect(result.current).toBe('left');
  });

  it('follows a lens that forces the dock (Studio docks the Brain left)', () => {
    window.localStorage.setItem(BRAIN_DOCK_STORAGE_KEY, JSON.stringify({ ...DEFAULT_BRAIN_DOCK_PREFERENCES, side: 'right' }));
    expect(renderHook(() => useCounterBrainDockSide('studio')).result.current).toBe('right');
    expect(renderHook(() => useCounterBrainDockSide('canvas')).result.current).toBe('left');
  });

  it('opposes either side', () => {
    expect(oppositeSide('left')).toBe('right');
    expect(oppositeSide('right')).toBe('left');
  });
});
