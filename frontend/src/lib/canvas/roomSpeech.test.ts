import { describe, expect, it } from 'vitest';
import { ROOM_SPEECH_MAX_CHARS, roomSpeech, speechExcerpt } from './roomSpeech';
import type { BoardAgent } from './boardAgents';

const cfo: BoardAgent = { objectId: 'card-cfo', ref: 'cfo-t2', name: 'CFO', seat: 'CFO' };
const counsel: BoardAgent = { objectId: 'card-counsel', ref: null, name: 'Counsel', seat: null };
const user = (body: string) => ({ messageRole: 'user' as const, body });
const said = (body: string, author: { ref: string; name: string }, extra: { error?: boolean } = {}) => ({
  messageRole: 'assistant' as const, body, metadata: { authoredBy: { kind: 'agent' as const, ...author }, ...extra },
});
const brain = (body: string) => ({
  messageRole: 'assistant' as const, body, metadata: { authoredBy: { kind: 'brain' as const, ref: 'brain', name: 'Brain' } },
});

describe('roomSpeech', () => {
  it("puts each agent's reply to the latest turn over its own seat, and nothing over Brain", () => {
    const speech = roomSpeech([
      user('@CFO @Counsel what is our runway?'),
      said('Eighteen months.', { ref: 'cfo-t2', name: 'CFO' }),
      said('No legal blockers.', { ref: 'card-counsel', name: 'Counsel' }),
      brain('Summary of both.'),
    ], [cfo, counsel], new Set());
    expect(speech.get('agent:cfo-t2')).toEqual({ text: 'Eighteen months.', pending: false });
    expect(speech.get('agent:counsel')).toEqual({ text: 'No legal blockers.', pending: false });
    expect(speech.size).toBe(2);
  });

  it('clears the table once a new question is asked', () => {
    expect(roomSpeech([user('first'), said('Old answer', { ref: 'cfo-t2', name: 'CFO' }), user('second')], [cfo], new Set()).size).toBe(0);
  });

  it('shows an agent still working as pending, until its reply lands', () => {
    expect(roomSpeech([user('go')], [counsel], new Set(['card-counsel'])).get('agent:counsel')).toEqual({ text: null, pending: true });
    expect(roomSpeech([user('go'), said('Done', { ref: 'card-counsel', name: 'Counsel' })], [counsel], new Set(['card-counsel']))
      .get('agent:counsel')).toEqual({ text: 'Done', pending: false });
  });

  it('matches an author by name when the card carries no roster ref', () => {
    expect(roomSpeech([user('go'), said('Hi', { ref: 'agent-99', name: 'counsel' })], [counsel], new Set()).get('agent:counsel')?.text).toBe('Hi');
  });

  it('skips failure notices and replies from nobody at the table', () => {
    const speech = roomSpeech([
      user('go'),
      said('boom', { ref: 'cfo-t2', name: 'CFO' }, { error: true }),
      said('hello', { ref: 'x', name: 'Stranger' }),
    ], [cfo], new Set());
    expect(speech.size).toBe(0);
  });
});

describe('speechExcerpt', () => {
  it('reads markdown as plain text', () => {
    expect(speechExcerpt('**Revenue:** grow `ARR` via [partners](https://example.com)\n\n- one\n- two'))
      .toBe('Revenue: grow ARR via partners one two');
  });

  it('clips a long reply at a word, with an ellipsis', () => {
    const text = speechExcerpt('word '.repeat(200));
    expect(text.length).toBeLessThanOrEqual(ROOM_SPEECH_MAX_CHARS);
    expect(text.endsWith('…')).toBe(true);
    expect(text).not.toMatch(/\s…$/);
  });
});
