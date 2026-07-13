import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { BrainContextProvider, useBrainContext } from './BrainContext';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <BrainContextProvider>{children}</BrainContextProvider>
);

describe('BrainContext drawer persistence (survives navigation/remount)', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('persists the open state to sessionStorage so a remount keeps the drawer open', () => {
    const first = renderHook(() => useBrainContext(), { wrapper });
    expect(first.result.current.open).toBe(false);

    act(() => first.result.current.setOpen(true));
    expect(window.sessionStorage.getItem('brain.drawer.open')).toBe('1');

    // Simulate a navigation that remounts the provider (hard nav / reload).
    first.unmount();
    const second = renderHook(() => useBrainContext(), { wrapper });
    expect(second.result.current.open).toBe(true);
  });

  it('rehydrates the active chat so the conversation resumes after a remount', () => {
    const first = renderHook(() => useBrainContext(), { wrapper });
    act(() => first.result.current.setActiveChatId(42));
    expect(window.sessionStorage.getItem('brain.drawer.activeChatId')).toBe('42');

    first.unmount();
    const second = renderHook(() => useBrainContext(), { wrapper });
    expect(second.result.current.activeChatId).toBe(42);
  });

  it('a manual close persists too, so a remount does NOT reopen it', () => {
    const first = renderHook(() => useBrainContext(), { wrapper });
    act(() => first.result.current.setOpen(true));
    act(() => first.result.current.setOpen(false));
    expect(window.sessionStorage.getItem('brain.drawer.open')).toBe('0');

    first.unmount();
    const second = renderHook(() => useBrainContext(), { wrapper });
    expect(second.result.current.open).toBe(false);
  });
});
