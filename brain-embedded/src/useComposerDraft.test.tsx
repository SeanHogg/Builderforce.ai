import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useComposerDraft } from './useComposerDraft';

describe('useComposerDraft - the composer text as the send path sees it', () => {
  it('a write is visible to draft() IMMEDIATELY, before React re-renders', () => {
    const setInput = vi.fn();
    const { result } = renderHook(() => useComposerDraft('typed words', setInput));
    expect(result.current.draft()).toBe('typed words');

    result.current.setInput(''); // the box is cleared as an offer starts

    expect(result.current.draft()).toBe(''); // no render has happened - the read does not lag
    expect(setInput).toHaveBeenCalledWith('');
  });

  it('fillIfEmpty puts text back only into an empty box, and says so through the updater', () => {
    const setInput = vi.fn();
    const { result } = renderHook(() => useComposerDraft('', setInput));

    result.current.fillIfEmpty('given back');

    expect(result.current.draft()).toBe('given back');
    const updater = setInput.mock.calls[0]![0] as (cur: string) => string;
    expect(updater('')).toBe('given back');
    expect(updater('something newer')).toBe('something newer');
  });

  it('a newer draft is never overwritten by fillIfEmpty', () => {
    const setInput = vi.fn();
    const { result } = renderHook(() => useComposerDraft('newer', setInput));
    result.current.fillIfEmpty('older');
    expect(result.current.draft()).toBe('newer');
  });

  it('follows the render\'s own value (the person typing)', () => {
    const setInput = vi.fn();
    const { result, rerender } = renderHook(({ input }: { input: string }) => useComposerDraft(input, setInput), { initialProps: { input: '' } });
    act(() => rerender({ input: 'typing' }));
    expect(result.current.draft()).toBe('typing');
  });
});
