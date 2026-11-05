import { describe, expect, it } from 'vitest';
import type { Finding } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeCall } from '../../../src/knowledge/knowledgeProtocol';
import { createHostKnowledgeGraphSource, type KnowledgeTransport } from './hostKnowledgeGraphSource';

const FINDING: Finding = {
  id: 'f1', kind: 'unused-export', pack: 'code', nodes: ['src:vscode:repo:web::src/a.ts'], severity: 'warn', params: {},
};

function transport(answers: Record<string, unknown> = {}) {
  const calls: KnowledgeCall[] = [];
  const t: KnowledgeTransport = {
    async call<T>(call: KnowledgeCall): Promise<T> {
      calls.push(call);
      return answers[call.op] as T;
    },
    onEvent: () => () => undefined,
  };
  return { t, calls };
}

describe('the editor knowledge source - review ports', () => {
  it('sends a screenshot as a base64 data URL with its root', async () => {
    const { t, calls } = transport({ pinpoint: { description: 'stuck', anchors: [], matches: [] } });
    const out = await createHostKnowledgeGraphSource(t).pinpoint!(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), 'ws');
    expect(out.description).toBe('stuck');
    expect(calls).toEqual([{ op: 'pinpoint', rootId: 'ws', image: 'data:image/png;base64,AQID' }]);
  });

  it('refuses a screenshot that is not an image before encoding it', async () => {
    const { t, calls } = transport();
    await expect(createHostKnowledgeGraphSource(t).pinpoint!(new Blob(['x'], { type: 'text/plain' }), 'ws')).rejects.toThrow(/PNG/);
    expect(calls).toEqual([]);
  });

  it('asks the host for history and sync status by root', async () => {
    const { t, calls } = transport({ history: { commits: [] }, syncStatus: { local: { files: 1, docs: 3 }, sources: [] } });
    const source = createHostKnowledgeGraphSource(t);
    expect(await source.history!('ws')).toEqual({ commits: [] });
    expect((await source.syncStatus!('ws')).local.files).toBe(1);
    expect(calls).toEqual([{ op: 'history', rootId: 'ws' }, { op: 'syncStatus', rootId: 'ws' }]);
  });

  it('applies a fix on the root its finding belongs to, and rejects a finding with no source', async () => {
    const { t, calls } = transport({ applyFix: { changed: ['src/a.ts'] } });
    const source = createHostKnowledgeGraphSource(t);
    expect(await source.applyFix!(FINDING)).toEqual({ changed: ['src/a.ts'] });
    expect(calls).toEqual([{ op: 'applyFix', rootId: 'vscode:repo:web', finding: FINDING }]);
    await expect(source.applyFix!({ ...FINDING, nodes: ['fact:1'] })).rejects.toThrow();
  });
});
