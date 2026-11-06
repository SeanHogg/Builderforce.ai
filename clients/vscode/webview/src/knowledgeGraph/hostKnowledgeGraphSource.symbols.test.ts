import { describe, expect, it } from 'vitest';
import type { KnowledgeCall } from '../../../src/knowledge/knowledgeProtocol';
import { createHostKnowledgeGraphSource, type KnowledgeTransport } from './hostKnowledgeGraphSource';

describe('the editor knowledge source — symbols', () => {
  it('asks the extension for the definitions of some files and returns them', async () => {
    const calls: KnowledgeCall[] = [];
    const records = [{ ref: 'src:r::a.ts#A', name: 'A', kind: 'class', parent: 'src:r::a.ts', line: 1, exported: true }];
    const t: KnowledgeTransport = {
      call: async <T,>(call: KnowledgeCall) => { calls.push(call); return records as T; },
      onEvent: () => () => undefined,
    };
    expect(await createHostKnowledgeGraphSource(t).symbolsOf!('r', ['src:r::a.ts'])).toEqual(records);
    expect(calls).toEqual([{ op: 'symbols', rootId: 'r', fileRefs: ['src:r::a.ts'] }]);
  });

  it('passes the extension refusal through', async () => {
    const t: KnowledgeTransport = { call: () => Promise.reject(new Error('This folder is not open in the workspace.')), onEvent: () => () => undefined };
    await expect(createHostKnowledgeGraphSource(t).symbolsOf!('r', [])).rejects.toThrow('not open');
  });
});
