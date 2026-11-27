import { describe, expect, it } from 'vitest';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS } from '../../labels';
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
        expect(diagramFromFile('sequenceDiagram', { nodes, edges })?.edges.map((edge) => edge.time)).toEqual([1, 3]);
        expect(diagramFromFile('timingDiagram', { nodes, edges })).toBeNull();
    });

    it('reads operations from an OpenAPI JSON contract', () => {
        const value = { openapi: '3.1.0', paths: { '/logs': { get: { operationId: 'readLog' }, parameters: [] } } };
        expect(diagramFromFile('openapi', value)?.nodes[0]?.members).toEqual([{ text: 'GET · readLog' }]);
        expect(diagramFromFile('asyncapi', value)).toBeNull();
    });
});
