import { describe, expect, it } from 'vitest';
import { estimateTokensFromChars } from '@builderforce/workload';
import { localTurnFeatures } from './turnFeatures';

describe('localTurnFeatures', () => {
  it('reads the raw counts the run.local-success task scales: prompt, context, window, tools, turn, attachments', () => {
    const f = localTurnFeatures(
      {
        messages: [
          { role: 'system', content: 'you are helpful' },
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'ok' },
          { role: 'user', content: [{ type: 'text', text: 'look at this' }, { type: 'image_url', image_url: { url: 'data:x' } }] },
        ],
        tools: [{ name: 'read' }, { name: 'write' }],
      },
      8192,
    );
    expect(f).toMatchObject({ servedContextTokens: 8192, tools: 2, turnIndex: 1, attachments: 1, codeHeavy: false });
    expect(f.promptTokens).toBeGreaterThan(0);
    expect(f.contextTokens).toBeGreaterThan(0);
  });

  it('marks code-heavy turns and reads an unknown window as 0', () => {
    const text = 'fix this\n```ts\nconst x = 1\n```';
    const f = localTurnFeatures({ messages: [{ role: 'user', content: text }] }, undefined);
    expect(f).toMatchObject({ codeHeavy: true, servedContextTokens: 0, turnIndex: 0, tools: 0, attachments: 0, contextTokens: 0 });
    expect(f.promptTokens).toBe(estimateTokensFromChars(text.length));
  });
});
