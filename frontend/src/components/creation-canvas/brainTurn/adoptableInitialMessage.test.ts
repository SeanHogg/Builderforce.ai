import { describe, expect, it } from 'vitest';
import { adoptableInitialMessage } from './adoptableInitialMessage';
import type { CanvasTimelineMessage } from '../canvasBoardTypes';

const message = (clientMessageId: string, body: string, messageRole: CanvasTimelineMessage['messageRole'] = 'user'): CanvasTimelineMessage =>
  ({ clientMessageId, body, messageRole, createdAt: '2026-10-09T05:03:21.615Z' });

describe('adoptableInitialMessage', () => {
  const PROMPT = 'Build a social media website that offers phone plans';

  it('adopts the seeded prompt for the turn that first answers it', () => {
    expect(adoptableInitialMessage([message('initial:a', PROMPT)], PROMPT)?.clientMessageId).toBe('initial:a');
    expect(adoptableInitialMessage([message('claim:b', PROMPT)], PROMPT)?.clientMessageId).toBe('claim:b');
  });

  it('does not adopt it once it has a reply, so a re-sent prompt gets its own id and its own answer', () => {
    const timeline = [message('initial:a', PROMPT), message('initial:a:assistant', 'I created the project.', 'assistant')];
    expect(adoptableInitialMessage(timeline, PROMPT)).toBeUndefined();
    const failed = [message('initial:a', PROMPT), message('initial:a:error', 'failed', 'system')];
    expect(adoptableInitialMessage(failed, PROMPT)).toBeUndefined();
  });

  it('adopts only the seeded message with the same text', () => {
    expect(adoptableInitialMessage([message('initial:a', PROMPT)], 'something else')).toBeUndefined();
    expect(adoptableInitialMessage([message('typed-1', PROMPT)], PROMPT)).toBeUndefined();
  });
});
