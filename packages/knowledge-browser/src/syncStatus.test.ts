import { describe, expect, it } from 'vitest';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { browserSyncStatus } from './syncStatus';

const graph = (badges: Record<string, number | string> = {}, truncated = false): KnowledgeGraph => ({
  scope: { rootId: 'r', packs: ['code'], digest: 'd' },
  nodes: [
    { ref: 'src:r::a.ts', kind: 'file', label: 'a.ts', pack: 'code', importance: 0, origin: 'extracted', badges },
    { ref: 'src:r::README.md', kind: 'file', label: 'README.md', pack: 'docs', importance: 0, origin: 'extracted' },
  ],
  edges: [],
  findings: [],
  stats: { sources: 2, nodes: 2, edges: 7, stale: 0, truncated },
} as unknown as KnowledgeGraph);

describe('browserSyncStatus', () => {
  it('counts the server from the graph stats and the local from the last review record', () => {
    const status = browserSyncStatus({ graph: graph(), record: { counts: { files: 4, docs: 1 }, skipped: [{ path: 'x.png', reason: 'binary' }], at: 't' } });
    expect(status.server).toEqual({ files: 1, docs: 1, edges: 7 });
    expect(status.local).toEqual({ files: 4, docs: 1 });
    expect(status.skipped).toEqual([{ path: 'x.png', reason: 'binary' }]);
  });

  it('reads a source off the badges the server graph carries, and says absent otherwise', () => {
    const status = browserSyncStatus({ graph: graph({ coverage: 0.5, churn: 3 }), record: undefined });
    const state = Object.fromEntries(status.sources.map((s) => [s.id, s.state]));
    expect(state).toMatchObject({ code: 'collected', docs: 'collected', coverage: 'collected', history: 'collected', owners: 'absent', openapi: 'absent', usage: 'absent', traces: 'absent' });
  });

  it('answers unknown skips (no list) and zero local counts for a root this tab never reviewed', () => {
    const status = browserSyncStatus({ graph: null, record: undefined });
    expect(status).not.toHaveProperty('skipped');
    expect(status).not.toHaveProperty('server');
    expect(status.local).toEqual({ files: 0, docs: 0 });
    expect(status.sources.find((s) => s.id === 'code')?.state).toBe('absent');
  });

  it('flags a truncated platform graph', () => {
    expect(browserSyncStatus({ graph: graph({}, true), record: undefined }).server?.truncated).toBe(true);
  });
});
