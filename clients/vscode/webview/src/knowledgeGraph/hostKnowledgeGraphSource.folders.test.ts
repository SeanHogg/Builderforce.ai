import { describe, expect, it } from 'vitest';
import type { KnowledgeCall } from '../../../src/knowledge/knowledgeProtocol';
import { createHostKnowledgeGraphSource, type KnowledgeTransport } from './hostKnowledgeGraphSource';

describe('the editor knowledge source — folders', () => {
  it('asks the extension to exclude the folder from review', async () => {
    const calls: KnowledgeCall[] = [];
    const t: KnowledgeTransport = { call: async <T,>(call: KnowledgeCall) => { calls.push(call); return null as T; }, onEvent: () => () => undefined };
    await createHostKnowledgeGraphSource(t).folders!.exclude('r', 'bf-membump');
    expect(calls).toEqual([{ op: 'excludeFromReview', rootId: 'r', path: 'bf-membump' }]);
  });

  it('passes the extension refusal through', async () => {
    const t: KnowledgeTransport = { call: () => Promise.reject(new Error('A review of this folder is already running.')), onEvent: () => () => undefined };
    await expect(createHostKnowledgeGraphSource(t).folders!.exclude('r', 'x')).rejects.toThrow('already running');
  });
});
