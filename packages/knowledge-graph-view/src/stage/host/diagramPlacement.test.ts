import { describe, expect, it } from 'vitest';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import { MARK_TYPE_ORDER } from '../../shapes';
import { diagramKey, placeDiagram } from './diagramPlacement';

const nodes = [
    { id: 'orders', kind: 'class', label: 'Orders', ref: 'src:sys::orders.ts#Orders' },
    { id: 'store', kind: 'interface', label: 'Store' },
];
const model = { nodes, edges: [{ from: 'orders', to: 'store', kind: 'implements', count: 2 }] };

describe('diagram placement on the shared stage', () => {
    it('uses the standard class and interface marks, arrow geometry and orbit rig', () => {
        const { marks, placement } = placeDiagram({ id: 'classDiagram', model }, L, 7);
        expect(marks.keys).toEqual(nodes.map((n) => diagramKey(n.id)));
        expect(Array.from(marks.type, (type) => MARK_TYPE_ORDER[type])).toEqual(['class', 'interface']);
        expect(placement.generation).toBe(marks.generation);
        expect(placement.rig).toMatchObject({ projection: 'perspective', depth: { orbit: true }, view: { flatDepth: 0.03 } });
        expect(placement.links.map((batch) => [batch.family, batch.group.length])).toEqual([['edge', 1], ['arrow', 2]]);
    });

    it('places the dependency count at the intersection of the source row and target column', () => {
        const { placement } = placeDiagram({ id: 'dsm', model }, L, 7);
        expect(placement.labels.map(({ text }) => text)).toEqual(['Orders', 'Store', '2']);
        expect(placement.position[6]).toBe(placement.position[3]);
        expect(placement.position[8]).toBe(placement.position[0]);
    });
});
