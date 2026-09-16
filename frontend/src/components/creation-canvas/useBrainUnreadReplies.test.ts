import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { BrainMessage } from '@seanhogg/builderforce-brain-embedded';
import { useBrainUnreadReplies } from './useBrainUnreadReplies';

function assistant(id: number): BrainMessage {
  return { id, role: 'assistant', content: 'reply', metadata: null, seq: id, createdAt: '2026-01-01T00:00:00.000Z' };
}
function user(id: number): BrainMessage {
  return { id, role: 'user', content: 'ask', metadata: null, seq: id, createdAt: '2026-01-01T00:00:00.000Z' };
}

describe('useBrainUnreadReplies', () => {
  it('is zero while the conversation is on screen, even as replies arrive', () => {
    const { result, rerender } = renderHook(
      ({ messages, open }: { messages: BrainMessage[]; open: boolean }) => useBrainUnreadReplies(messages, open),
      { initialProps: { messages: [user(1)], open: true } },
    );
    expect(result.current).toBe(0);

    rerender({ messages: [user(1), assistant(2)], open: true });
    expect(result.current).toBe(0);
  });

  it('counts only assistant replies that landed while closed', () => {
    const { result, rerender } = renderHook(
      ({ messages, open }: { messages: BrainMessage[]; open: boolean }) => useBrainUnreadReplies(messages, open),
      { initialProps: { messages: [user(1), assistant(2)], open: true } },
    );
    rerender({ messages: [user(1), assistant(2)], open: false });
    expect(result.current).toBe(0);

    rerender({ messages: [user(1), assistant(2), assistant(3)], open: false });
    expect(result.current).toBe(1);
  });

  it('does not count the reader\'s own lines', () => {
    const { result, rerender } = renderHook(
      ({ messages, open }: { messages: BrainMessage[]; open: boolean }) => useBrainUnreadReplies(messages, open),
      { initialProps: { messages: [] as BrainMessage[], open: false } },
    );
    rerender({ messages: [user(1), user(2)], open: false });
    expect(result.current).toBe(0);
  });

  it('clamps to zero when a restore shortens the transcript', () => {
    const long = [user(1), assistant(2), assistant(3)];
    const { result, rerender } = renderHook(
      ({ messages, open }: { messages: BrainMessage[]; open: boolean }) => useBrainUnreadReplies(messages, open),
      { initialProps: { messages: long, open: false } },
    );
    rerender({ messages: [user(1)], open: false });
    expect(result.current).toBe(0);
  });
});
