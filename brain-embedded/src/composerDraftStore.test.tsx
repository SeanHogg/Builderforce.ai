import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createComposerDraftStore, useComposerDraftStore, useDraftIsEmpty, useDraftSelector } from './composerDraftStore';
import { useComposerDraft } from './useComposerDraft';

describe('the composer draft store', () => {
  it('get reads a write synchronously; an updater is applied against what the box holds', () => {
    const store = createComposerDraftStore('newer');
    store.set((cur) => `older\n\n${cur}`);
    expect(store.get()).toBe('older\n\nnewer');
    store.set('');
    expect(store.get()).toBe('');
  });

  it('notifies on a change only, and stops after unsubscribe', () => {
    const store = createComposerDraftStore();
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.set('a');
    store.set('a');
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    store.set('b');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps one identity for the life of the mount', () => {
    const { result, rerender } = renderHook(() => useComposerDraftStore());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('a derived subscription re-renders only when the derived value changes', () => {
    const store = createComposerDraftStore();
    let renders = 0;
    const { result } = renderHook(() => { renders += 1; return useDraftIsEmpty(store); });
    expect(result.current).toBe(true);
    const base = renders;
    act(() => { store.set('h'); });
    act(() => { store.set('he'); });
    act(() => { store.set('hel'); });
    expect(result.current).toBe(false);
    expect(renders - base).toBe(1);
  });

  it('a selector over the text (the leading @mention) re-renders only when its answer changes', () => {
    const store = createComposerDraftStore();
    const mention = (text: string) => /^\s*@(\S+)/.exec(text)?.[1] ?? null;
    let renders = 0;
    const { result } = renderHook(() => { renders += 1; return useDraftSelector(store, mention); });
    const base = renders;
    act(() => { store.set('@ad'); });
    act(() => { store.set('@ada'); });
    act(() => { store.set('@ada hello there'); });
    expect(result.current).toBe('ada');
    // '@ad' -> 'ad', '@ada' -> 'ada', then the same answer again: two re-renders, not three.
    expect(renders - base).toBe(2);
  });

  it('useComposerDraft on a store: draft() and setInput are the store\'s own, with a stable identity', () => {
    const store = createComposerDraftStore('typed');
    const { result, rerender } = renderHook(() => useComposerDraft(store));
    const first = result.current;
    result.current.setInput('');
    expect(result.current.draft()).toBe('');
    result.current.setInput((cur) => `back ${cur}`);
    expect(store.get()).toBe('back ');
    rerender();
    expect(result.current).toBe(first);
  });
});
