import { describe, expect, it } from 'vitest';
import { makeCell } from './runCell';
import { attachTurnContext, restoreTurnContext, turnContextBlock } from './turnContext';
import { latestUserText } from './convoText';
import { routingQueryForTurn } from '../turnOptimization';
import type { ChatCompletionMessage } from '../streamChatCompletion';

describe('turnContextBlock', () => {
  it('is null when every part is empty', () => {
    expect(turnContextBlock([])).toBeNull();
    expect(turnContextBlock(['', '  ', null, undefined])).toBeNull();
  });

  it('wraps the non-empty parts as this turn\'s context', () => {
    const block = turnContextBlock(['RECALL', '', 'DIRECTIVE'])!;
    expect(block).toContain('RECALL\n\nDIRECTIVE');
    expect(block.startsWith('<turn_context>')).toBe(true);
    expect(block.endsWith('</turn_context>')).toBe(true);
  });
});

describe('attach / restore', () => {
  it('rides AFTER the history, on the latest user message, without moving any index', () => {
    const c = makeCell();
    const seedUser: ChatCompletionMessage = { role: 'user', content: 'first' };
    const convo: ChatCompletionMessage[] = [
      seedUser,
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'now' },
    ];
    expect(attachTurnContext(c, convo, 'CTX')).toBe(true);
    expect(convo).toHaveLength(3);
    expect(convo[0]).toBe(seedUser); // the history prefix is untouched (byte-identical)
    expect(convo[2]!.content).toBe('now\n\nCTX');
  });

  it('never mutates the original message object a host seed may share', () => {
    const c = makeCell();
    const original: ChatCompletionMessage = { role: 'user', content: 'ask' };
    const convo = [original];
    attachTurnContext(c, convo, 'CTX');
    expect(original.content).toBe('ask');
    restoreTurnContext(c);
    expect(convo[0]).toBe(original);
  });

  it('the next run restores the previous block before reading the history', () => {
    const c = makeCell();
    const convo: ChatCompletionMessage[] = [{ role: 'user', content: 'one' }];
    attachTurnContext(c, convo, 'OLD RECALL');
    convo.push({ role: 'assistant', content: 'answer' }, { role: 'user', content: 'two' });
    restoreTurnContext(c);
    expect(convo[0]!.content).toBe('one');
    expect(routingQueryForTurn(convo)).not.toContain('OLD RECALL');
    attachTurnContext(c, convo, 'NEW');
    expect(convo[2]!.content).toBe('two\n\nNEW');
    expect(convo[0]!.content).toBe('one');
    expect(latestUserText(convo)).toContain('two');
  });

  it('a vision turn gets a trailing text part', () => {
    const c = makeCell();
    const convo: ChatCompletionMessage[] = [{
      role: 'user',
      content: [{ type: 'text', text: 'look' }, { type: 'image_url', image_url: { url: 'data:x' } }],
    } as ChatCompletionMessage];
    attachTurnContext(c, convo, 'CTX');
    const parts = convo[0]!.content as Array<{ type: string; text?: string }>;
    expect(parts).toHaveLength(3);
    expect(parts[2]).toEqual({ type: 'text', text: 'CTX' });
  });

  it('no user message → reports false so the caller keeps the system-prompt placement', () => {
    expect(attachTurnContext(makeCell(), [{ role: 'assistant', content: 'x' }], 'CTX')).toBe(false);
  });

  it('restore is idempotent and leaves a re-seeded transcript alone', () => {
    const c = makeCell();
    const convo: ChatCompletionMessage[] = [{ role: 'user', content: 'a' }];
    attachTurnContext(c, convo, 'CTX');
    convo[0] = { role: 'user', content: 'replaced' };
    restoreTurnContext(c);
    restoreTurnContext(c);
    expect(convo[0]!.content).toBe('replaced');
  });
});
