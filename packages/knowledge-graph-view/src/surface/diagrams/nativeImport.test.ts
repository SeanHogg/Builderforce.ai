import { describe, expect, it } from 'vitest';
import { nativeDiagram } from './nativeImport';
import { schemaDiagram } from './schema';

describe('standards import', () => {
    it('reads BPMN gateways, sequence flows and authored coordinates', () => {
        const xml = `<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">
            <process id="p" name="Approval"><startEvent id="a"/><exclusiveGateway id="b" name="Approve?"/>
            <sequenceFlow id="flow" sourceRef="a" targetRef="b"/></process>
            <BPMNShape bpmnElement="b"><Bounds x="90" y="40"/></BPMNShape></definitions>`;
        const diagram = nativeDiagram('bpmnProcess', xml);
        expect(diagram?.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'b', kind: 'gateway', x: 90, y: 40, group: 'Approval' })]));
        expect(diagram?.edges).toEqual([{ from: 'a', to: 'b', kind: 'sequenceFlow' }]);
        expect(nativeDiagram('bpmnCollaboration', xml)).toBeNull();
    });

    it('imports DMN decisions and decision requirements, and Petri places and transitions', () => {
        const dmn = '<definitions><inputData id="i"/><decision id="d"><informationRequirement><requiredInput href="#i"/></informationRequirement></decision></definitions>';
        expect(nativeDiagram('dmn', dmn)?.edges).toEqual([{ from: 'i', to: 'd', kind: 'informationRequirement' }]);
        const pnml = '<pnml><net><page><place id="p"><initialMarking><text>2</text></initialMarking></place><transition id="t"/><arc source="p" target="t"/></page></net></pnml>';
        expect(nativeDiagram('petri', pnml)).toMatchObject({ nodes: [{ kind: 'place', members: [{ text: '2' }] }, { kind: 'transition' }], edges: [{ from: 'p', to: 't' }] });
    });

    it('reads lineage job input and output directions from OpenLineage events', () => {
        const line = JSON.stringify({ eventType: 'COMPLETE', run: { runId: 'r' }, job: { namespace: 'batch', name: 'transform' },
            inputs: [{ namespace: 'db', name: 'raw' }], outputs: [{ namespace: 'db', name: 'clean' }] });
        const diagram = nativeDiagram('lineage', `${line}\n${line}`);
        expect(diagram?.edges.map(({ kind }) => kind)).toEqual(['reads', 'writes']);
        expect(diagram?.nodes.map(({ label }) => label).sort()).toEqual(['clean', 'raw', 'transform']);
    });

    it('orders OTLP spans by precise nanosecond times and connects the recorded services', () => {
        const bundle = (service: string, spans: object[]) => ({ resource: { attributes: [{ key: 'service.name', value: { stringValue: service } }] }, scopeSpans: [{ spans }] });
        const span = (spanId: string, name: string, start: string, end: string, parentSpanId?: string) =>
            ({ traceId: 'abc', spanId, parentSpanId, name, startTimeUnixNano: start, endTimeUnixNano: end });
        const json = JSON.stringify({ resourceSpans: [
            bundle('db', [span('2', 'read', '1785530010001500000', '1785530010002000000', '1')]),
            bundle('api', [span('1', 'request', '1785530010001000000', '1785530010003000000')]),
        ] });
        expect(nativeDiagram('sequenceDiagram', json)?.edges).toEqual([{ from: 'api', to: 'db', kind: 'calls', label: 'read', time: 0.5 }]);
        expect(nativeDiagram('timingDiagram', json)?.nodes.map(({ x }) => x)).toEqual([0, 2, 0.5, 1]);
    });

    it('keeps Wardley coordinates and STRIDE boundaries from authored evidence', () => {
        expect(nativeDiagram('wardley', JSON.stringify({ components: [{ id: 'db', name: 'Storage', evolution: 0.8, visibility: 0.2 }] }))
            ?.nodes[0]).toMatchObject({ x: 0.8, y: 0.2 });
        const threat = nativeDiagram('threatDfd', JSON.stringify({ elements: [{ id: 'api', name: 'API', boundary: 'Private network' }],
            threats: [{ element: 'api', category: 'Tampering', description: 'Validate the payload' }] }));
        expect(threat?.nodes[0]).toMatchObject({ group: 'Private network', members: [{ text: 'Tampering · Validate the payload' }] });
        expect(nativeDiagram('statechart', '<!DOCTYPE scxml><scxml/>')).toBeNull();
    });
});

describe('schema relationships', () => {
    it('resolves SQL and Drizzle foreign keys across files while keeping their source refs', () => {
        const result = schemaDiagram([
            { ref: 'users', path: 'db/schema/users.ts', text: 'export const users = pgTable("users", {\n id: uuid("id")\n});' },
            { ref: 'orders', path: 'db/schema/orders.ts', text: 'export const orders = pgTable("orders", {\n userId: uuid("user_id").references(() => users.id)\n});' },
            { ref: 'customers', path: 'db/customers.sql', text: 'CREATE TABLE customers (id int PRIMARY KEY);\nCREATE TABLE carts (id int REFERENCES customers(id));' },
        ]);
        expect(result.nodes.map(({ label }) => label)).toEqual(['users', 'orders', 'customers', 'carts']);
        const key = (label: string) => result.nodes.find((node) => node.label === label)?.id;
        expect(result.edges).toEqual([{ from: key('users'), to: key('orders'), kind: 'oneToMany' }, { from: key('customers'), to: key('carts'), kind: 'oneToMany' }]);
    });
});
