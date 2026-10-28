import { describe, expect, it } from 'vitest';
import { srcRef, type KEdge, type KNode, type KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { applyLiveOverlay } from './liveOverlay';

const ROOT = 'web:vfs:7';

function graphOf(paths: string[]): KnowledgeGraph {
  const nodes: KNode[] = paths.map((path) => ({
    ref: srcRef(ROOT, path), kind: 'file', label: path, pack: 'code', importance: 0.5, origin: 'extracted',
  }) as KNode);
  const edges: KEdge[] = [{ from: nodes[0]!.ref, to: nodes[1]!.ref, kind: 'references', weight: 1, origin: 'extracted' } as KEdge];
  return {
    scope: { rootId: ROOT, packs: ['code'], digest: 'd' }, nodes, edges, findings: [],
    stats: { sources: nodes.length, nodes: nodes.length, edges: edges.length, stale: 0, truncated: false },
  } as KnowledgeGraph;
}

describe('Live overlay', () => {
  it('badges the changed files and links them pairwise as co-changed', () => {
    const graph = graphOf(['app/page.tsx', 'domain/invoice.ts', 'infra/db.ts']);
    const out = applyLiveOverlay(graph, ['app/page.tsx', 'domain/invoice.ts', 'not/in/graph.ts']);
    const changed = out.nodes.filter((n) => n.badges?.changed === 1).map((n) => n.label).sort();
    expect(changed).toEqual(['app/page.tsx', 'domain/invoice.ts']);
    expect(out.edges.filter((e) => e.kind === 'co-changed')).toHaveLength(1);
    expect(out.stats.edges).toBe(out.edges.length);
  });

  it('returns the same graph when nothing it draws changed', () => {
    const graph = graphOf(['a.ts', 'b.ts']);
    expect(applyLiveOverlay(graph, ['elsewhere.md'])).toBe(graph);
  });
});
