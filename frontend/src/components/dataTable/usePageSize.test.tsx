import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePageSize, PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE } from './usePageSize';

describe('usePageSize', () => {
  it('defaults to 50', () => {
    const { result } = renderHook(() => usePageSize());
    expect(result.current.size).toBe(50);
    expect(DEFAULT_PAGE_SIZE).toBe(50);
    expect([...PAGE_SIZE_OPTIONS]).toEqual([50, 100, 200]);
  });

  it('accepts all three legal sizes', () => {
    const { result } = renderHook(() => usePageSize());
    for (const n of [50, 100, 200]) {
      act(() => result.current.setSize(n));
      expect(result.current.size).toBe(n);
    }
  });

  it('clamps illegal sizes back to the default', () => {
    const { result } = renderHook(() => usePageSize());
    act(() => result.current.setSize(7));
    expect(result.current.size).toBe(50);
    act(() => result.current.setSize(500));
    expect(result.current.size).toBe(50);
  });
});
