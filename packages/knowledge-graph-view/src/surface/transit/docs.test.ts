import { describe, expect, it } from 'vitest';
import { buildStations } from '../stations';
import { describesLinks, docStations } from './docs';
import { withDocs } from './testFixtures';

const graph = withDocs();
const model = buildStations(graph);
const nameOf = (id: string) => model.byId.get(id)!.name;

describe('docs on the map', () => {
    it('marks the stations made of docs-pack files', () => {
        const docs = docStations(graph, model);
        expect([...docs].map(nameOf)).toEqual(['docs']);
    });
    it('links a document station to the code station it links to, once', () => {
        const docs = docStations(graph, model);
        const links = describesLinks(graph, model, docs);
        expect(links.map((l) => [nameOf(l.from), nameOf(l.to), l.count])).toEqual([['docs', 'API', 1]]);
    });
    it('has none when there are no documents', () => {
        const plain = buildStations({ ...graph, nodes: graph.nodes.filter((n) => n.pack !== 'docs'), edges: graph.edges.filter((e) => e.kind !== 'links') });
        expect(describesLinks(graph, plain, new Set())).toEqual([]);
    });
});
