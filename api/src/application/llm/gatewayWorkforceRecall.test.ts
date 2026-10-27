import { beforeEach, describe, expect, it, vi } from 'vitest';
import { volatileTail } from '@seanhogg/builderforce-memory/handoff';

// WS-C: a workforce model's per-request recall rides the latest user message, never the
// system prompt — so the system prefix (persona) is byte-identical on every request.

const resolveWorkforceModel = vi.hoisted(() => vi.fn());
vi.mock('../agent/agentPrompt', () => ({
  resolveWorkforceModel,
  WORKFORCE_MODEL_REF_PREFIX: 'builderforce/workforce-',
}));

import { expandGatewayModelRefs } from './gatewayChatSupport';

const env = {} as never;
const getDb = () => { throw new Error('no db for a workforce ref'); };
const RECALL = "Relevant knowledge (recalled from this agent's memory):\nRefunds within 30 days.";

beforeEach(() => {
  resolveWorkforceModel.mockReset();
  resolveWorkforceModel.mockResolvedValue({ baseModel: 'anthropic/claude-sonnet-5', directives: 'You are Ada.', inferenceMode: 'base', execParams: {}, recallBlock: RECALL });
});

describe('workforce model recall placement', () => {
  it('asks for the recall separately and keeps it out of the system prompt', async () => {
    const body: Record<string, unknown> = {
      model: 'builderforce/workforce-42',
      messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'What is the refund window?' }],
    };
    await expandGatewayModelRefs(env, getDb, 1, body);
    expect(resolveWorkforceModel).toHaveBeenCalledWith(env, 1, 'builderforce/workforce-42', 'What is the refund window?', { recall: 'separate' });
    const [system, user] = body.messages as Array<{ role: string; content: string }>;
    expect(system!.content).toBe('You are Ada.\n\nBe brief.');
    expect(system!.content).not.toContain('Refunds');
    expect(user!.content).toBe(`What is the refund window?\n\n${RECALL}`);
    expect(body.model).toBe('anthropic/claude-sonnet-5');
  });

  it('attaches to the latest REAL user message, never the <run-state> tail, and keeps the tail last', async () => {
    const tail = volatileTail(['budget: 40%'])!;
    const original = { role: 'user', content: 'What is the refund window?' };
    const body: Record<string, unknown> = {
      model: 'builderforce/workforce-42',
      messages: [original, { role: 'assistant', content: 'Checking.' }, tail],
    };
    await expandGatewayModelRefs(env, getDb, 1, body);
    const msgs = body.messages as Array<{ role: string; content: unknown }>;
    // No system message in the request: the persona is prepended, and the recall still
    // lands on the user message it was meant for (not on the shifted index).
    expect(msgs[0]).toEqual({ role: 'system', content: 'You are Ada.' });
    expect(msgs[1]!.content).toBe(`What is the refund window?\n\n${RECALL}`);
    expect(original.content).toBe('What is the refund window?'); // the caller's object is never mutated
    expect(msgs).toHaveLength(4);
    expect(msgs[3]).toBe(tail);
  });

  it('appends a text part to a vision (array-content) user message', async () => {
    const body: Record<string, unknown> = {
      model: 'builderforce/workforce-42',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Is this refundable?' }, { type: 'image_url', image_url: { url: 'data:x' } }] }],
    };
    await expandGatewayModelRefs(env, getDb, 1, body);
    // The request had no system message, so the persona is PREPENDED (as in the test
    // above) and the user message is at index 1 — index 0 is the persona string.
    const msgs = body.messages as Array<{ role: string; content: unknown[] }>;
    expect(msgs[0]).toEqual({ role: 'system', content: 'You are Ada.' });
    const content = msgs.find((m) => m.role === 'user')!.content;
    expect(content.at(-1)).toEqual({ type: 'text', text: RECALL });
    // The vision message's text grounds the recall, as a string message's does.
    expect(resolveWorkforceModel).toHaveBeenCalledWith(env, 1, 'builderforce/workforce-42', 'Is this refundable?', { recall: 'separate' });
    expect(content.slice(0, 2)).toEqual([{ type: 'text', text: 'Is this refundable?' }, { type: 'image_url', image_url: { url: 'data:x' } }]);
  });
});
