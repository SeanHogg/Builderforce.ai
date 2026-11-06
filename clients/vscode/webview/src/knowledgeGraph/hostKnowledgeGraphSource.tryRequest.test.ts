import { describe, expect, it } from 'vitest';
import type { KnowledgeCall } from '../../../src/knowledge/knowledgeProtocol';
import { createHostKnowledgeGraphSource, type KnowledgeTransport } from './hostKnowledgeGraphSource';

describe('the editor knowledge source — the API sandbox', () => {
  it('hands the request to the extension and returns its answer', async () => {
    const calls: KnowledgeCall[] = [];
    const t: KnowledgeTransport = {
      call: async <T,>(call: KnowledgeCall) => { calls.push(call); return { status: 200, headers: {}, body: 'ok', ms: 3 } as T; },
      onEvent: () => () => undefined,
    };
    const req = { method: 'GET', url: 'http://localhost:3000/users' };
    expect(await createHostKnowledgeGraphSource(t).tryRequest!(req)).toEqual({ status: 200, headers: {}, body: 'ok', ms: 3 });
    expect(calls).toEqual([{ op: 'tryRequest', req }]);
  });

  it('passes the extension refusal through', async () => {
    const t: KnowledgeTransport = { call: () => Promise.reject(new Error('Send only reaches localhost')), onEvent: () => () => undefined };
    await expect(createHostKnowledgeGraphSource(t).tryRequest!({ method: 'GET', url: 'https://x.com' })).rejects.toThrow('localhost');
  });
});
