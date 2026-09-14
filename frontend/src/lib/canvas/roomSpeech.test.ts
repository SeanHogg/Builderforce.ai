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
    expect(speech.get('agent:cfo-t2')).toEqual({ text: 'Eighteen months.', pending: false, messageId: 2 });
    expect(speech.get('agent:counsel')).toEqual({ text: 'No legal blockers.', pending: false, messageId: 3 });
    expect(speech.size).toBe(2);
  });

  it('clears the table once a new question is asked', () => {
    expect(roomSpeech([user('first'), said('Old answer', { ref: 'cfo-t2', name: 'CFO' }), user('second')], [cfo], new Set()).size).toBe(0);
  });

  it('shows an agent still working as pending, until its reply lands', () => {
    expect(roomSpeech([user('go')], [counsel], new Set(['card-counsel'])).get('agent:counsel')).toEqual({ text: null, pending: true, messageId: null });
    expect(roomSpeech([user('go'), said('Done', { ref: 'card-counsel', name: 'Counsel' })], [counsel], new Set(['card-counsel']))
      .get('agent:counsel')).toEqual({ text: 'Done', pending: false, messageId: 2 });
  });

  it('matches an author by name when the card carries no roster ref', () => {
    expect(roomSpeech([user('go'), said('Hi', { ref: 'agent-99', name: 'counsel' })], [counsel], new Set()).get('agent:counsel')?.text).toBe('Hi');
  });

  it('gives a reply to the agent whose ref it carries, not an earlier card wearing the same title', () => {
    // The standup bug: a draft card NAMED "Security" sits before the rostered
    // Security agent, so a first-match-wins lookup gave it that agent's reply —
    // one head wearing someone else's words, and the real speaker left silent.
    const draft: BoardAgent = { objectId: 'card-sec-draft', ref: null, name: 'Security', seat: null };
    const rostered: BoardAgent = { objectId: 'card-sec', ref: 'sec-t7', name: 'Security Lead', seat: 'Security' };
    const speech = roomSpeech([
      user('standup'),
      said('No open vulnerabilities.', { ref: 'sec-t7', name: 'Security' }),
    ], [draft, rostered], new Set());
    expect(speech.get('agent:sec-t7')?.text).toBe('No open vulnerabilities.');
    expect(speech.has('agent:security')).toBe(false);
  });

  it('matches a card id only when no agent claims the ref outright', () => {
    const other: BoardAgent = { objectId: 'cfo-t2', ref: 'ceo-t1', name: 'CEO', seat: 'CEO' };
    // `other.objectId` collides with `cfo`'s ref: the exact ref owner must still win.
    const speech = roomSpeech([user('go'), said('Runway is fine.', { ref: 'cfo-t2', name: 'CFO' })], [other, cfo], new Set());
    expect(speech.get('agent:cfo-t2')?.text).toBe('Runway is fine.');
    expect(speech.has('agent:ceo-t1')).toBe(false);
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
