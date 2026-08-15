import { describe, expect, it } from 'vitest';
import { ratedTurnContext, ratedTurnTool } from './turnRating';
import { STEP_MESSAGE_ROLE } from './types';

const step = (id: number, category: string, label: string) => ({
  id,
  role: STEP_MESSAGE_ROLE,
  metadata: JSON.stringify({ kind: 'step', category, label, ts: '2026-08-15T00:00:00.000Z' }),
});

const reply = (id: number, model?: string) => ({
  id,
  role: 'assistant',
  metadata: model ? JSON.stringify({ provenance: { model, account: 'shared' } }) : null,
});

describe('ratedTurnTool', () => {
  const messages = [
    { id: 1, role: 'user', metadata: null },
    step(2, 'tool', 'canvas_add_object'),
    step(3, 'tool', 'canvas_connect'),
    reply(4, 'minimaxai/minimax-m3'),
  ];

  it('names the LAST tool of the turn — the one the reply is reporting on', () => {
    expect(ratedTurnTool(messages, 4)).toBe('canvas_connect');
  });

  it('does not reach back into a previous exchange', () => {
    const twoTurns = [
      ...messages,
      { id: 5, role: 'user', metadata: null },
      reply(6, 'minimaxai/minimax-m3'),
    ];
    // Turn two called nothing. Attributing turn one's tool to it would libel that tool.
    expect(ratedTurnTool(twoTurns, 6)).toBeNull();
  });

  it('ignores non-tool steps (memory recall / learn) when looking for the tool', () => {
    const withMemory = [
      { id: 1, role: 'user', metadata: null },
      step(2, 'tool', 'roadmap_create_ticket'),
      step(3, 'learn', 'evermind.learn'),
      reply(4, 'claude-sonnet-5'),
    ];
    expect(ratedTurnTool(withMemory, 4)).toBe('roadmap_create_ticket');
  });

  it('returns null for a prose-only reply and for an unknown message', () => {
    expect(ratedTurnTool([{ id: 1, role: 'user', metadata: null }, reply(2, 'm')], 2)).toBeNull();
    expect(ratedTurnTool(messages, 999)).toBeNull();
  });
});

describe('ratedTurnContext', () => {
  it('reads the model off the reply’s own provenance, not the composer', () => {
    const messages = [{ id: 1, role: 'user', metadata: null }, step(2, 'tool', 'search_code'), reply(3, '@cf/zai-org/glm-4.7-flash')];
    expect(ratedTurnContext(messages, 3)).toEqual({ model: '@cf/zai-org/glm-4.7-flash', toolName: 'search_code' });
  });

  it('reports an empty model for a pre-provenance turn, so the caller can skip it', () => {
    // A rating with no attribution would invent evidence for whichever model we
    // guessed, so it must be recognisable as unattributed rather than defaulted.
    expect(ratedTurnContext([reply(1)], 1).model).toBe('');
  });
});
