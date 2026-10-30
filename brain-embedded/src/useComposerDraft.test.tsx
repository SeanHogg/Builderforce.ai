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

  it('a turn given back in front of a newer draft is written whole, and draft() reads it at once', () => {
    const setInput = vi.fn();
    const { result } = renderHook(() => useComposerDraft('newer', setInput));

    result.current.setInput('older\n\nnewer');

    expect(result.current.draft()).toBe('older\n\nnewer');
    expect(setInput).toHaveBeenCalledWith('older\n\nnewer');
  });

  it('an UPDATER is applied to what the box holds now, draft() reads the result at once, and the same updater goes to the state setter', () => {
    const setInput = vi.fn();
    const { result } = renderHook(() => useComposerDraft('newer', setInput));
    const prepend = (cur: string) => `older\n\n${cur}`;

    result.current.setInput(prepend);

    expect(result.current.draft()).toBe('older\n\nnewer');
    expect(setInput).toHaveBeenCalledWith(prepend);
  });

  it('follows the render\'s own value (the person typing)', () => {
    const setInput = vi.fn();
    const { result, rerender } = renderHook(({ input }: { input: string }) => useComposerDraft(input, setInput), { initialProps: { input: '' } });
    act(() => rerender({ input: 'typing' }));
    expect(result.current.draft()).toBe('typing');
  });
});
