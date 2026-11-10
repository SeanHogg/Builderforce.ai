import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeClient, KnowledgeScopeRecord } from '@builderforce/knowledge-client';
import { createKnowledgeSource } from './knowledgeSource';

const ROOT = 'web:folder:app';
const V5 = { extractorVersion: '5', toolVersions: {} };
const V6 = { extractorVersion: '6', toolVersions: {} };
const before: KnowledgeGraph = {
  scope: { rootId: ROOT, packs: ['docs'], digest: 'd1' }, nodes: [], edges: [], findings: [],
  stats: { sources: 0, nodes: 0, edges: 0, stale: 0, truncated: false },
};

function sourceWith(record: KnowledgeScopeRecord) {
  const client = {
    scopes: vi.fn(async () => [record]),
    graph: vi.fn(async () => before),
    store: {},
    judgement: {},
  } as unknown as KnowledgeClient;
  return { client, source: createKnowledgeSource({ projectId: 7, client, directorySources: async () => [], onDegraded: vi.fn() }) };
}
const scope = (extra: Partial<KnowledgeScopeRecord>): KnowledgeScopeRecord => ({ rootId: ROOT, title: 'app', packs: ['docs'], lastDigest: 'd2', previousDigest: 'd1', ...extra });

describe('web Compare applies C9 (PRD 41 §C9): the previous review against the latest, by what each was measured with', () => {
  it('is comparable when both reviews were measured alike, at the previous digest', async () => {
    const { client, source } = sourceWith(scope({ measured: V5, previousMeasured: V5 }));
    await source.scopes();
    expect(await source.baseline!(ROOT)).toEqual({ graph: before, comparable: true, reasons: [] });
    expect(client.graph).toHaveBeenCalledWith(ROOT, { at: 'd1' });
  });

  it('is not comparable across an extractor upgrade, and says why', async () => {
    const { source } = sourceWith(scope({ measured: V6, previousMeasured: V5 }));
    await source.scopes();
    expect(await source.baseline!(ROOT)).toMatchObject({ comparable: false, reasons: ['extractor-version-changed'] });
  });

  it('a previous review stored before versions were recorded is unknown — never comparable, even to another unknown', async () => {
    const { source } = sourceWith(scope({ measured: V5 }));
    await source.scopes();
    expect(await source.baseline!(ROOT)).toMatchObject({ comparable: false, reasons: ['extractor-version-changed', 'measured-unknown'] });
    const both = sourceWith(scope({}));
    await both.source.scopes();
    expect(await both.source.baseline!(ROOT)).toMatchObject({ comparable: false, reasons: ['measured-unknown'] });
  });

  it('a pack that reviewed only the latest side is named', async () => {
    const { source } = sourceWith(scope({ packs: ['docs', 'code'], measured: V5, previousMeasured: V5 }));
    await source.scopes();
    expect(await source.baseline!(ROOT)).toMatchObject({ comparable: false, reasons: ['tool-missing:pack:code'] });
  });
});
