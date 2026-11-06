import { describe, expect, it } from 'vitest';
import type { KnowledgeCall } from '../../../src/knowledge/knowledgeProtocol';
import { createHostKnowledgeGraphSource, type KnowledgeTransport } from './hostKnowledgeGraphSource';

describe('the editor knowledge source: history', () => {
  it('maps the wire commits to the view Commit once, keeping the author only when there is one', async () => {
    const calls: KnowledgeCall[] = [];
    const t: KnowledgeTransport = {
      call: async <T,>(call: KnowledgeCall) => {
        calls.push(call);
        return { commits: [{ sha: 'a', title: 'one', at: '2026-01-01T00:00:00Z', refs: ['r1'], author: 'Sean' }, { sha: 'b', title: 'two', at: '2026-01-02T00:00:00Z', refs: [] }] } as T;
      },
      onEvent: () => () => undefined,
    };
    const out = await createHostKnowledgeGraphSource(t).history!('root');
    expect(calls).toEqual([{ op: 'history', rootId: 'root' }]);
    expect(out.commits).toEqual([
      { sha: 'a', title: 'one', at: '2026-01-01T00:00:00Z', refs: ['r1'], author: 'Sean' },
      { sha: 'b', title: 'two', at: '2026-01-02T00:00:00Z', refs: [] },
    ]);
  });
});
