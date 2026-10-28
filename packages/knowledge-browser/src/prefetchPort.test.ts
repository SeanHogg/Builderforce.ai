import { describe, expect, it, vi } from 'vitest';
import { offeredActions } from '@builderforce/prefetch';
import {
  KNOWLEDGE_GRAPH, KNOWLEDGE_REVIEW_DIR, OPEN_KNOWLEDGE_GRAPH_COMMAND, OPEN_KNOWLEDGE_REVIEW_COMMAND,
} from '@builderforce/agent-tools/prefetch';
import { KNOWLEDGE_ASK } from '@builderforce/agent-tools/knowledge-index';
import type { KnowledgeClient } from '@builderforce/knowledge-client';
import { createBrowserKnowledgePrefetchPort, knowledgeChipIntent, newestReviewedRoot, type CalibrationStore } from './prefetchPort';

const ROOT = 'web:upload:contracts';
const signal = new AbortController().signal;

function fakeClient(overrides: Partial<KnowledgeClient> = {}): KnowledgeClient {
  return {
    scopes: vi.fn(async () => [
      { rootId: 'web:vfs:7', title: 'Workspace', packs: ['code'], lastReviewedAt: '2026-10-01T00:00:00Z' },
      { rootId: ROOT, title: 'contracts', packs: ['docs'], lastReviewedAt: '2026-10-20T00:00:00Z' },
    ]),
    search: vi.fn(async () => [{ id: `src:${ROOT}::lease.md`, score: 0.5, tier: 'lexical' as const }]),
    graph: vi.fn(async () => ({
      scope: { rootId: ROOT, packs: ['docs'], digest: 'd1' },
      nodes: [
        { ref: `src:${ROOT}::lease.md`, kind: 'file', label: 'lease.md', pack: 'docs', importance: 0.5, origin: 'extracted' },
        { ref: 'ent:termination', kind: 'entity', label: 'Termination', pack: 'docs', importance: 0.4, origin: 'extracted' },
      ],
      edges: [{ from: `src:${ROOT}::lease.md`, to: 'ent:termination', kind: 'mentions', weight: 1, origin: 'extracted' }],
      findings: [],
      stats: { sources: 1, nodes: 2, edges: 1, stale: 0, truncated: false },
    })),
    ...overrides,
  } as unknown as KnowledgeClient;
}

describe('the browser knowledge PrefetchPort', () => {
  it('offers /review, /graph and knowledge.ask on the web surface', () => {
    const port = createBrowserKnowledgePrefetchPort({ client: fakeClient() });
    expect(port.ports.surface).toBe('web');
    const offered = offeredActions(port.registry, port.ports).map((a) => a.id).sort();
    expect(offered).toEqual([KNOWLEDGE_ASK, KNOWLEDGE_GRAPH, KNOWLEDGE_REVIEW_DIR].sort());
    for (const id of offered) expect(port.executors[id]).toBeDefined();
  });

  it('answers /graph with an Open-in-graph chip on the newest reviewed root, focused on the named paths', async () => {
    const port = createBrowserKnowledgePrefetchPort({ client: fakeClient() });
    const out = await port.executors[KNOWLEDGE_GRAPH]!.run('/graph docs/lease.md', signal);
    expect(out?.chips).toEqual([{
      labelKey: 'prefetch.chip.openInGraph', command: OPEN_KNOWLEDGE_GRAPH_COMMAND, args: { rootId: ROOT, focus: [`src:${ROOT}::docs/lease.md`] },
    }]);
    expect(out?.text).toContain('contracts');
  });

  it('answers /review with the view launcher chip, and lets it through without a second confirm', async () => {
    const port = createBrowserKnowledgePrefetchPort({ client: fakeClient() });
    const out = await port.executors[KNOWLEDGE_REVIEW_DIR]!.run('/review ./contracts', signal);
    expect(out?.chips).toEqual([{ labelKey: 'prefetch.chip.chooseFolderToReview', command: OPEN_KNOWLEDGE_REVIEW_COMMAND, args: { dir: 'contracts' } }]);
    const review = port.registry.find((a) => a.id === KNOWLEDGE_REVIEW_DIR)!;
    expect(await port.confirm!(review, '/review ./contracts')).toBe(true);
  });

  it('answers a knowledge question from search plus one graph hop, in the editor\'s format', async () => {
    const client = fakeClient();
    const port = createBrowserKnowledgePrefetchPort({ client });
    const out = await port.executors[KNOWLEDGE_ASK]!.run('what does the lease say about termination?', signal);
    expect(client.search).toHaveBeenCalledWith(ROOT, 'lease termination', 8);
    expect(client.graph).toHaveBeenCalledWith(ROOT, { focus: [`src:${ROOT}::lease.md`] });
    expect(out?.text).toContain('`lease.md`');
    expect(out?.text).toContain('Termination');
    expect(out?.confidence).toBeGreaterThan(0);
    expect(out?.data).toMatchObject({ digest: 'd1', hits: 1 });
  });

  it('asks nothing when no folder has been reviewed', async () => {
    const client = fakeClient({ scopes: vi.fn(async () => []) });
    const port = createBrowserKnowledgePrefetchPort({ client });
    expect(await port.executors[KNOWLEDGE_ASK]!.run('where is billing handled', signal)).toBeUndefined();
    expect(client.search).not.toHaveBeenCalled();
  });

  it('learns through the host calibration store', () => {
    let kept: string | undefined;
    const store: CalibrationStore = { read: () => kept, write: (s) => { kept = s; } };
    const port = createBrowserKnowledgePrefetchPort({ client: fakeClient(), calibration: store });
    port.record!({ actionId: KNOWLEDGE_GRAPH, route: 'answer', p: 0.9, tier: 1, features: [], accepted: true });
    expect(kept).toBeTruthy();
    expect(port.ports.calibration).toBeDefined();
  });

  it('picks the most recently reviewed root', () => {
    expect(newestReviewedRoot([{ rootId: 'a', title: 'a', packs: [] }, { rootId: 'b', title: 'b', packs: [], lastReviewedAt: '2026-01-01' }])?.rootId).toBe('b');
  });
});

describe('knowledgeChipIntent — what a host routes', () => {
  it('reads the graph and review chips, and nothing else', () => {
    expect(knowledgeChipIntent({ command: OPEN_KNOWLEDGE_GRAPH_COMMAND, args: { rootId: ROOT, focus: ['src:x::a', 3] } }))
      .toEqual({ review: false, focus: ['src:x::a'], rootId: ROOT });
    expect(knowledgeChipIntent({ command: OPEN_KNOWLEDGE_REVIEW_COMMAND, args: { dir: 'docs' } }))
      .toEqual({ review: true, focus: [], dir: 'docs' });
    expect(knowledgeChipIntent({ command: 'builderforce.somethingElse' })).toBeUndefined();
  });
});
