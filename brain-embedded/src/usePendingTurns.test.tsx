import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePendingTurns } from './usePendingTurns';
import type { BrainMessage } from './types';

const row = (id: number, role: string, content: string): BrainMessage => ({ id, role, content, metadata: null, seq: id, createdAt: '' });

describe('the just-sent turn', () => {
  it('is shown from the moment it opens, in its own chat only', () => {
    const { result } = renderHook(() => usePendingTurns(5, []));
    act(() => result.current.open(5, 'fix the build'));
    expect(result.current.pendingTurn?.text).toBe('fix the build');

    const other = renderHook(() => usePendingTurns(6, []));
    act(() => other.result.current.open(5, 'fix the build'));
    expect(other.result.current.pendingTurn).toBeNull();
  });

  it('is gone once its saved row is in the transcript - never doubled', () => {
    const { result, rerender } = renderHook(({ messages }: { messages: BrainMessage[] }) => usePendingTurns(5, messages), {
      initialProps: { messages: [row(1, 'user', 'earlier')] },
    });
    act(() => result.current.open(5, 'go'));
    expect(result.current.pendingTurn?.text).toBe('go');

    rerender({ messages: [row(1, 'user', 'earlier'), row(2, 'user', 'go\n\n[a.txt](x)')] });

    expect(result.current.pendingTurn).toBeNull();
  });

  it('the same words sent twice: the earlier row does not hide the new pending turn', () => {
    const { result } = renderHook(() => usePendingTurns(5, [row(1, 'user', 'continue')]));
    act(() => result.current.open(5, 'continue'));
    expect(result.current.pendingTurn?.text).toBe('continue');
  });

  it('close withdraws it (a failed send goes back to the composer)', () => {
    const { result } = renderHook(() => usePendingTurns(5, []));
    act(() => result.current.open(5, 'x'));
    act(() => result.current.close(5));
    expect(result.current.pendingTurn).toBeNull();
  });

  it('a draft chat\'s turn follows the chat its send creates', () => {
    const { result, rerender } = renderHook(({ chat }: { chat: number | null }) => usePendingTurns(chat, []), { initialProps: { chat: null as number | null } });
    act(() => result.current.open(null, 'first message'));
    expect(result.current.pendingTurn?.text).toBe('first message');

    act(() => result.current.rekey(null, 9));
    rerender({ chat: 9 });

    expect(result.current.pendingTurn?.text).toBe('first message');
  });
});
