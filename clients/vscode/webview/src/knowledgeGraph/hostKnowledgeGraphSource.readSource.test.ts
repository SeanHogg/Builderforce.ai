import { describe, expect, it } from 'vitest';
import type { KnowledgeCall } from '../../../src/knowledge/knowledgeProtocol';
import { createHostKnowledgeGraphSource, type KnowledgeTransport } from './hostKnowledgeGraphSource';

describe('the editor knowledge source — readSource', () => {
  it('asks the extension for some lines of one file of the root and returns them', async () => {
    const calls: KnowledgeCall[] = [];
    const text = { startLine: 3, lines: ['a', 'b'], truncated: false };
    const t: KnowledgeTransport = {
      call: async <T,>(call: KnowledgeCall) => { calls.push(call); return text as T; },
      onEvent: () => () => undefined,
    };
    expect(await createHostKnowledgeGraphSource(t).readSource!('r', 'src/a.ts', { startLine: 3, endLine: 4 })).toEqual(text);
    expect(calls).toEqual([{ op: 'readSource', rootId: 'r', path: 'src/a.ts', startLine: 3, endLine: 4 }]);
  });

  it('answers null when the extension refuses the path', async () => {
    const t: KnowledgeTransport = { call: async <T,>() => null as T, onEvent: () => () => undefined };
    expect(await createHostKnowledgeGraphSource(t).readSource!('r', '../x.ts', { startLine: 1, endLine: 1 })).toBeNull();
  });

  it('passes the extension error through (a root not open here)', async () => {
    const t: KnowledgeTransport = { call: () => Promise.reject(new Error('This folder is not open in the workspace.')), onEvent: () => () => undefined };
    await expect(createHostKnowledgeGraphSource(t).readSource!('r', 'a.ts', { startLine: 1, endLine: 1 })).rejects.toThrow('not open');
  });

  it('readSourceAt asks the extension for a file as it was at a commit', async () => {
    const calls: KnowledgeCall[] = [];
    const text = { startLine: 1, lines: ['old'], truncated: false };
    const t: KnowledgeTransport = {
      call: async <T,>(call: KnowledgeCall) => { calls.push(call); return text as T; },
      onEvent: () => () => undefined,
    };
    expect(await createHostKnowledgeGraphSource(t).readSourceAt!('r', 'src/a.ts', 'abc1234', { startLine: 1, endLine: 2 })).toEqual(text);
    expect(calls).toEqual([{ op: 'readSourceAt', rootId: 'r', path: 'src/a.ts', rev: 'abc1234', startLine: 1, endLine: 2 }]);
  });

  it('tells the host which root the view loads', async () => {
    const loaded: string[] = [];
    const t: KnowledgeTransport = { call: async <T,>() => null as T, onEvent: () => () => undefined };
    await createHostKnowledgeGraphSource(t, { onLoad: (rootId) => loaded.push(rootId) }).load('r1');
    expect(loaded).toEqual(['r1']);
  });
});
