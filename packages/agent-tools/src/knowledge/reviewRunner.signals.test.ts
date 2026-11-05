import { describe, expect, it } from 'vitest';
import { localSnapshotStore, type AnalyzerPort } from '@seanhogg/builderforce-memory/knowledge';
import { InMemoryIngestManifest } from '@seanhogg/builderforce-memory/ingest';
import { repoGraphToExtracted } from './codeExtracted.js';
import type { HistoryPort } from './historyPort.js';
import { memoryKnowledgeFs } from './memoryKnowledgeFs.test-util.js';
import { memorySource } from './reviewRunner.fixtures.test-util.js';
import { buildStoredGraph, reviewPacks, runKnowledgeReview, type KnowledgeReviewPorts } from './reviewRunner.js';

const FILES: Record<string, string> = {
  'package.json': '{"main":"./src/boot.ts"}',
  'src/boot.ts': 'export function start() { return 1; }\n',
  'src/core.ts': 'export function run() { return 1; }\n',
};

const istanbul = JSON.stringify({
  '/repo/src/boot.ts': { statementMap: { 0: { start: { line: 1 } }, 1: { start: { line: 2 } } }, s: { 0: 1, 1: 0 } },
  '/repo/src/ghost.ts': { statementMap: { 0: { start: { line: 1 } } }, s: { 0: 1 } },
});

function reviewPorts(): KnowledgeReviewPorts {
  let snapshot: string | undefined;
  const analyzers: AnalyzerPort = {
    analyse: async (rootId) => repoGraphToExtracted({ graph: { paths: ['src/boot.ts', 'src/core.ts'], out: [[[1, 1]], []] } }, rootId),
  };
  const history: HistoryPort = { commitsTouching: async () => new Map([['src/boot.ts', 2], ['src/ghost.ts', 5]]) };
  return {
    source: memorySource(FILES),
    store: localSnapshotStore({ read: async () => snapshot, write: async (s) => { snapshot = s; } }),
    manifest: new InMemoryIngestManifest(),
    analyzers,
    history,
    rootFiles: {
      fs: memoryKnowledgeFs({ '/repo/CODEOWNERS': '* @team\n', '/repo/coverage/coverage-final.json': istanbul }),
      rootPath: '/repo',
    },
  };
}

describe('review → stored graph', () => {
  it('carries coverage, churn and owner to the graph for reviewed files only, and lets the manifest entry point drive the layers', async () => {
    const p = reviewPorts();
    const report = await runKnowledgeReview(p);
    const graph = (await buildStoredGraph({ rootId: report.rootId, store: p.store, manifest: p.manifest, packs: reviewPacks(p) }))!;
    const node = (path: string) => graph.nodes.find((n) => n.ref === `src:${report.rootId}::${path}`);

    expect(node('src/boot.ts')).toMatchObject({
      partition: 'entry',
      badges: { entry: 1, owner: '@team', churn: 2, coverage: 0.5, layerRule: 'name', complexity: 1 },
    });
    // Imported by the entry point, placed one layer below it by import direction.
    expect(node('src/core.ts')).toMatchObject({ partition: 'presentation', badges: { owner: '@team', layerRule: 'imports' } });
    // Coverage and churn name a file the review never extracted: no node, no signal.
    expect(node('src/ghost.ts')).toBeUndefined();
  });
});
