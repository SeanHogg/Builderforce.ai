import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { BrainMessage } from '@seanhogg/builderforce-brain-embedded';
import { useBrainUnreadReplies } from './useBrainUnreadReplies';

function assistant(id: string): BrainMessage {
  return { id, role: 'assistant', content: 'reply' } as BrainMessage;
}
function user(id: string): BrainMessage {
  return { id, role: 'user', content: 'ask' } as BrainMessage;
}

describe('useBrainUnreadReplies', () => {
  it('is zero while the conversation is on screen, even as replies arrive', () => {
    const { result, rerender } = renderHook(
      ({ messages, open }: { messages: BrainMessage[]; open: boolean }) => useBrainUnreadReplies(messages, open),
      { initialProps: { messages: [user('u1')], open: true } },
    );
    expect(result.current).toBe(0);

    rerender({ messages: [user('u1'), assistant('a1')], open: true });
    expect(result.current).toBe(0);
  });

  it('counts only assistant replies that landed while closed', () => {
    const { result, rerender } = renderHook(
      ({ messages, open }: { messages: BrainMessage[]; open: boolean }) => useBrainUnreadReplies(messages, open),
      { initialProps: { messages: [user('u1'), assistant('a1')], open: true } },
    );
    rerender({ messages: [user('u1'), assistant('a1')], open: false });
    expect(result.current).toBe(0);

    rerender({ messages: [user('u1'), assistant('a1'), assistant('a2')], open: false });
    expect(result.current).toBe(1);
  });

  it('does not count the reader\'s own lines', () => {
    const { result, rerender } = renderHook(
      ({ messages, open }: { messages: BrainMessage[]; open: boolean }) => useBrainUnreadReplies(messages, open),
      { initialProps: { messages: [], open: false } },
    );
    rerender({ messages: [user('u1'), user('u2')], open: false });
    expect(result.current).toBe(0);
  });

  it('clamps to zero when a restore shortens the transcript', () => {
    const long = [user('u1'), assistant('a1'), assistant('a2')];
    const { result, rerender } = renderHook(
      ({ messages, open }: { messages: BrainMessage[]; open: boolean }) => useBrainUnreadReplies(messages, open),
      { initialProps: { messages: long, open: false } },
    );
    rerender({ messages: [user('u1')], open: false });
    expect(result.current).toBe(0);
  });
});
