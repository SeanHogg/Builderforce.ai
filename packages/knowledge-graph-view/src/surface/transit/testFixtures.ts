/**
 * Fixtures of the transit map's modules: the surface graph with symbol nodes added to
 * `api/useCase.ts` (a class with a method that calls an error symbol), and a docs file that
 * describes the API area. Not a test file; it imports no testing library.
 */

import type { KEdge, KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { surfaceFixture } from '../../testing';

export const USE_CASE = 'src:sys::api/useCase.ts';
export const CLASS_REF = `${USE_CASE}#UseCase`;
export const RUN_REF = `${USE_CASE}#UseCase.run`;
export const FAIL_REF = `${USE_CASE}#UseCase.UseCaseError`;

const symbol = (ref: string, label: string, badges: KNode['badges'], importance: number): KNode =>
    ({ ref: ref as KNode['ref'], kind: 'symbol', label, pack: 'code', importance, origin: 'extracted', ...(badges ? { badges } : {}) });
const edge = (from: string, to: string, kind = 'references'): KEdge =>
    ({ from: from as KEdge['from'], to: to as KEdge['to'], kind, weight: 1, origin: 'extracted' });

export function withSymbols(graph: KnowledgeGraph = surfaceFixture()): KnowledgeGraph {
    return {
        ...graph,
        nodes: [
            ...graph.nodes,
            symbol(CLASS_REF, 'UseCase', { symbolKind: 'class' }, 0.9),
            symbol(RUN_REF, 'UseCase.run', { symbolKind: 'method', parent: 'UseCase' }, 0.6),
            symbol(FAIL_REF, 'UseCase.UseCaseError', { symbolKind: 'method', parent: 'UseCase' }, 0.3),
        ],
        edges: [...graph.edges, edge(RUN_REF, FAIL_REF), edge(RUN_REF, 'src:sys::db/repo.ts')],
    };
}

/** The surface graph plus a docs-pack file that links to `api/routes.ts`. */
export function withDocs(graph: KnowledgeGraph = surfaceFixture()): KnowledgeGraph {
    const doc: KNode = { ref: 'src:sys::docs/api.md' as KNode['ref'], kind: 'file', label: 'docs/api.md', pack: 'docs', importance: 0.2, origin: 'extracted', partition: 'docs' };
    return { ...graph, nodes: [...graph.nodes, doc], edges: [...graph.edges, edge(doc.ref, 'src:sys::api/routes.ts', 'links')] };
}
