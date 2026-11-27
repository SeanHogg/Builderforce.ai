import { describe, expect, it } from 'vitest';
import type { KNode } from '@seanhogg/builderforce-memory/knowledge';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS } from '../../labels';
import { pathOf } from '../../graphModel';
import { surfaceFixture } from '../../testing';
import type { SymbolRecord } from '../../types';
import { buildStations } from '../stations';
import { DIAGRAM_IDS, UML_BEHAVIOR, UML_INTERACTION, UML_STRUCTURE } from './catalog';
import { checkedDiagram, diagramFromFile, sourceDiagram } from './model';

const file = 'src:sys::api/useCase.ts';
const iface = `${file}#Logger@1`;
const cls = `${file}#AppLogger@4`;
const run = `${file}#AppLogger.log@5`;
const records: SymbolRecord[] = [
    { ref: iface, parent: file, name: 'Logger', kind: 'interface', line: 1, exported: true },
    { ref: cls, parent: file, name: 'AppLogger', kind: 'class', line: 4, exported: false,
        relations: [{ kind: 'implements', to: `${file}#Logger` }] },
    { ref: run, parent: cls, name: 'log', kind: 'method', line: 5, exported: false },
];

describe('diagram models', () => {
    it('registers all fourteen UML types and labels every entry', () => {
        expect([...UML_STRUCTURE, ...UML_BEHAVIOR, ...UML_INTERACTION]).toHaveLength(14);
        expect(new Set(DIAGRAM_IDS).size).toBe(DIAGRAM_IDS.length);
        for (const id of DIAGRAM_IDS) expect(DEFAULT_KNOWLEDGE_GRAPH_LABELS.surface.code[id]).toBeTruthy();
    });

    it('shows a class, its own members and its declared relationship to an interface', () => {
        const diagram = sourceDiagram('classDiagram', surfaceFixture(), records, cls, []);
        expect(diagram.nodes.find((node) => node.id === cls)?.members).toEqual([{ text: 'log()', ref: run }]);
        expect(diagram.nodes.find((node) => node.id === iface)?.kind).toBe('interface');
        expect(diagram.edges).toEqual([{ from: cls, to: iface, kind: 'implements' }]);
    });

    it('rolls package dependencies up from source references', () => {
        const graph = surfaceFixture();
        const result = sourceDiagram('packageDiagram', graph, [], null, buildStations(graph).stations);
        expect(result.edges).toContainEqual({ from: 'package:web', to: 'package:api', kind: 'references', count: 1 });
    });

    it('leaves runtime snapshots empty until supplied and rejects malformed imported links', () => {
        expect(sourceDiagram('objectDiagram', surfaceFixture(), records, file, []).nodes).toEqual([]);
        const nodes = [{ id: 'o', label: 'logger: Logger', kind: 'instance' }];
        expect(checkedDiagram({ nodes, edges: [] })).toEqual({ nodes, edges: [] });
        expect(checkedDiagram({ nodes, edges: [{ from: 'o', to: 'missing', kind: 'link' }] })).toBeNull();
        expect(checkedDiagram({ nodes: [{ ...nodes[0], ref: file }], edges: [] })).toBeNull();
    });

    it('uses recorded order for trace messages and requires observed coordinates for timing', () => {
        const nodes = [{ id: 'a', kind: 'participant', label: 'A' }, { id: 'b', kind: 'participant', label: 'B' }];
        const edges = [{ from: 'a', to: 'b', kind: 'calls', time: 3 }, { from: 'b', to: 'a', kind: 'calls', time: 1 }];
        expect(diagramFromFile('communicationDiagram', { nodes, edges })?.edges.map((edge) => edge.time)).toEqual([1, 3]);
        expect(diagramFromFile('timingDiagram', { nodes, edges })).toBeNull();
    });

    it('reads operations from an OpenAPI JSON contract', () => {
        const value = { openapi: '3.1.0', paths: { '/logs': { get: { operationId: 'readLog' }, parameters: [] } } };
        expect(diagramFromFile('openapi', value)?.nodes[0]?.members).toEqual([{ text: 'GET · readLog' }]);
        expect(diagramFromFile('asyncapi', value)).toBeNull();
    });

    it('reads a Swagger 2 contract for the OpenAPI view', () => {
        const value = { swagger: '2.0', paths: { '/logs': { post: { operationId: 'addLog' } } } };
        expect(diagramFromFile('openapi', value)?.nodes[0]?.members).toEqual([{ text: 'POST · addLog' }]);
        expect(diagramFromFile('openapi', { swagger: '1.2', paths: {} })).toBeNull();
    });

    it('reads AsyncAPI 2 publish and subscribe, and AsyncAPI 3 send and receive operations on their channel', () => {
        const v2 = { asyncapi: '2.6.0', channels: { logs: { publish: { operationId: 'emit' }, subscribe: {} } } };
        expect(diagramFromFile('asyncapi', v2)?.nodes[0]?.members).toEqual([{ text: 'PUBLISH · emit' }, { text: 'SUBSCRIBE' }]);
        const v3 = {
            asyncapi: '3.0.0',
            channels: { logs: {}, quiet: {}, 'logs/~/daily news': {} },
            operations: {
                sendLog: { action: 'send', channel: { $ref: '#/channels/logs' } },
                onLog: { action: 'receive', channel: { $ref: '#/channels/logs' } },
                odd: { action: 'publish', channel: { $ref: '#/channels/logs' } },
                lost: { action: 'send', channel: { $ref: '#/channels/missing' } },
                daily: { action: 'receive', channel: { $ref: '#/channels/logs~1~0~1daily%20news' } },
            },
        };
        const diagram = diagramFromFile('asyncapi', v3);
        expect(diagram?.nodes.find((node) => node.id === 'logs')?.members).toEqual([{ text: 'SEND · sendLog' }, { text: 'RECEIVE · onLog' }]);
        expect(diagram?.nodes.find((node) => node.id === 'quiet')?.members).toEqual([]);
        expect(diagram?.nodes.find((node) => node.id === 'logs/~/daily news')?.members).toEqual([{ text: 'RECEIVE · daily' }]);
    });

    it('regression: an imported edge count must be a positive integer, never an object or string that reaches the page', () => {
        const nodes = [{ id: 'a', label: 'A', kind: 'component' }, { id: 'b', label: 'B', kind: 'component' }];
        const edge = (count: unknown) => ({ nodes, edges: [{ from: 'a', to: 'b', kind: 'references', count }] });
        expect(checkedDiagram(edge(3))?.edges[0]?.count).toBe(3);
        expect(checkedDiagram({ nodes, edges: [{ from: 'a', to: 'b', kind: 'references' }] })).not.toBeNull();
        for (const bad of [{ x: 1 }, '3', 0, -1, 1.5, Number.NaN, Infinity, 2e9, null, []]) expect(checkedDiagram(edge(bad))).toBeNull();
    });

    it('selects the owning class when the scope is one of its methods', () => {
        const withUnrelatedType: SymbolRecord[] = [...records,
            { ref: `${file}#Other@15`, parent: file, name: 'Other', kind: 'class', line: 15, exported: false }];
        const diagram = sourceDiagram('classDiagram', surfaceFixture(), withUnrelatedType, run, []);
        expect(diagram.nodes.map((node) => node.id)).toEqual([cls, iface]);
        expect(diagram.nodes.find((node) => node.id === cls)?.members).toEqual([{ text: 'log()', ref: run }]);
        const composite = sourceDiagram('compositeDiagram', surfaceFixture(), withUnrelatedType, run, []);
        expect(composite.nodes.map(({ id, kind }) => ({ id, kind }))).toEqual([{ id: cls, kind: 'class' }]);
    });

    it('narrows C4 containers to the system of the scope file and components to its app', () => {
        const base = surfaceFixture();
        const tag = (path: string): Partial<KNode> =>
            path.startsWith('web/') ? { system: 'ui', app: 'web' } : path.startsWith('api/') ? { system: 'srv', app: 'api' }
                : path.startsWith('db/') ? { system: 'srv', app: 'db' } : {};
        const graph = { ...base, nodes: base.nodes.map((node) => ({ ...node, ...tag(pathOf(node.ref) ?? '') })) } as typeof base;
        const stations = buildStations(graph).stations;
        const scope = graph.nodes.find((node) => pathOf(node.ref) === 'api/useCase.ts')!.ref;
        const labels = (id: 'c4Containers' | 'c4Components', at: string | null) =>
            sourceDiagram(id, graph, [], at, stations).nodes.map((node) => node.label).sort();
        expect(labels('c4Containers', null)).toContain('web');
        expect(labels('c4Containers', scope)).toEqual(['api', 'db']);
        expect(labels('c4Components', scope)).toEqual(['api']);
    });
});
