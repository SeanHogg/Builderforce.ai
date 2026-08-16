// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  DIAGRAM_TARGETS, convertDiagramSource, detectDiagramSource, diagramNotation,
  notationForFileName, readDiagramSource,
} from './diagramNotations';
import { layoutDiagramGraph, resolveEdgeEndpoints, type DiagramGraph } from './diagramGraph';
import { readMermaid, writeMermaid } from './diagramMermaid';
import { readDot, writeDot } from './diagramDot';
import { readPlantuml, writePlantuml } from './diagramPlantuml';
import { readBpmn, writeBpmn } from './diagramBpmn';
import { readExcalidraw, writeExcalidraw } from './diagramExcalidraw';
import { readArchimate } from './diagramArchimate';
import { readSvgShapes } from './diagramSvg';
import { readVsdx } from './diagramVsdx';

const label = (graph: DiagramGraph | null) => (graph?.vertices ?? []).map((vertex) => vertex.label).sort();
const shapes = (graph: DiagramGraph | null) => Object.fromEntries((graph?.vertices ?? []).map((vertex) => [vertex.label, vertex.shape]));

describe('Mermaid', () => {
  const FLOW = `flowchart TD
  start((Order placed)) --> check{In stock?}
  check -->|yes| pack[Pack the order]
  check -.->|no| back[(Backorder)]
  pack --> done((Shipped))`;

  it('reads nodes, their shapes, and labelled edges', () => {
    const graph = readMermaid(FLOW)!;
    expect(label(graph)).toEqual(['Backorder', 'In stock?', 'Order placed', 'Pack the order', 'Shipped']);
    expect(shapes(graph)).toMatchObject({ 'Order placed': 'ellipse', 'In stock?': 'rhombus', 'Pack the order': 'rect', Backorder: 'cylinder' });
    expect(graph.edges).toHaveLength(4);
    expect(graph.edges.find((edge) => edge.label === 'no')?.dashed).toBe(true);
  });

  it('reads a chained line as two edges, not one', () => {
    const graph = readMermaid('flowchart LR\n  a[A] --> b[B] --> c[C]')!;
    expect(graph.edges.map((edge) => [edge.source, edge.target])).toEqual([['a', 'b'], ['b', 'c']]);
  });

  it('round-trips through its own writer', () => {
    const written = writeMermaid(readMermaid(FLOW)!);
    const reread = readMermaid(written)!;
    expect(label(reread)).toEqual(label(readMermaid(FLOW)));
    expect(reread.edges).toHaveLength(4);
  });

  it('escapes a label that would otherwise end the quoted string or the edge label', () => {
    const graph = layoutDiagramGraph([{ id: 'a', label: 'Say "hi" | now', shape: 'rect' }], [])!;
    const written = writeMermaid(graph);
    expect(written).not.toMatch(/"Say "hi"/);
    expect(readMermaid(written)?.vertices[0]?.label).toBe('Say "hi" | now');
  });

  it('leaves diagram types that are not node-and-edge graphs unread', () => {
    // A sequence diagram's meaning is the ORDER of its messages, which vertices
    // and edges cannot carry. Reading it would render a picture that lies.
    expect(readMermaid('sequenceDiagram\n  Alice->>Bob: Hello')).toBeNull();
    // It is still recognised AS Mermaid, so it renders and exports correctly.
    expect(detectDiagramSource('sequenceDiagram\n  Alice->>Bob: Hello')?.format).toBe('mermaid');
  });
});

describe('Graphviz DOT', () => {
  const DOT = `digraph deps {
  rankdir=LR;
  node [shape=box];
  api [label="API", shape=box];
  db [label="Database", shape=cylinder];
  worker [label="Worker"];
  api -> db [label="reads"];
  worker -> db [style=dashed];
}`;

  it('reads labels, shapes and edge attributes', () => {
    const graph = readDot(DOT)!;
    expect(label(graph)).toEqual(['API', 'Database', 'Worker']);
    expect(shapes(graph)).toMatchObject({ API: 'rect', Database: 'cylinder' });
    expect(graph.edges.find((edge) => edge.label === 'reads')).toBeTruthy();
    expect(graph.edges.find((edge) => edge.source === 'worker')?.dashed).toBe(true);
  });

  it('takes the default node shape from a `node [...]` statement', () => {
    // Graphviz's own default is an ellipse; a file that overrides it means it.
    expect(shapes(readDot(DOT))).toMatchObject({ Worker: 'rect' });
    expect(shapes(readDot('digraph g { a [label="A"]; }'))).toMatchObject({ A: 'ellipse' });
  });

  it('does not split a statement inside a quoted label', () => {
    const graph = readDot('digraph g { a [label="one; two"]; b [label="B"]; a -> b; }')!;
    expect(label(graph)).toEqual(['B', 'one; two']);
  });

  it('round-trips through its own writer', () => {
    const reread = readDot(writeDot(readDot(DOT)!))!;
    expect(label(reread)).toEqual(['API', 'Database', 'Worker']);
    expect(reread.edges).toHaveLength(2);
  });

  it('reads a chained edge statement as two edges', () => {
    expect(readDot('digraph g { a -> b -> c; }')!.edges).toHaveLength(2);
  });
});

describe('PlantUML', () => {
  const PUML = `@startuml
skinparam shadowing false
rectangle "Web app" as web
database "Postgres" as db
usecase "Checkout" as checkout

web --> db : queries
checkout ..> web : uses
@enduml`;

  it('reads declarations with their keyword shape and arrow labels', () => {
    const graph = readPlantuml(PUML)!;
    expect(label(graph)).toEqual(['Checkout', 'Postgres', 'Web app']);
    expect(shapes(graph)).toMatchObject({ 'Web app': 'rect', Postgres: 'cylinder', Checkout: 'ellipse' });
    expect(graph.edges.find((edge) => edge.label === 'queries')).toBeTruthy();
    expect(graph.edges.find((edge) => edge.label === 'uses')?.dashed).toBe(true);
  });

  it('reads component and use-case shorthand', () => {
    const graph = readPlantuml('@startuml\n[Gateway] --> (Login)\n@enduml')!;
    expect(label(graph)).toEqual(['Gateway', 'Login']);
    expect(shapes(graph)).toMatchObject({ Gateway: 'rect', Login: 'ellipse' });
  });

  it('flips a reversed arrow rather than pointing it the wrong way', () => {
    const graph = readPlantuml('@startuml\nrectangle "A" as a\nrectangle "B" as b\na <-- b\n@enduml')!;
    expect(graph.edges[0]).toMatchObject({ source: 'b', target: 'a' });
  });

  it('round-trips through its own writer', () => {
    const reread = readPlantuml(writePlantuml(readPlantuml(PUML)!))!;
    expect(label(reread)).toEqual(['Checkout', 'Postgres', 'Web app']);
    expect(reread.edges).toHaveLength(2);
  });
});

describe('BPMN 2.0', () => {
  const WITH_DI = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI">
  <bpmn:process id="Process_1">
    <bpmn:startEvent id="s1" name="Order received" />
    <bpmn:task id="t1" name="Check stock" />
    <bpmn:exclusiveGateway id="g1" name="In stock?" />
    <bpmn:endEvent id="e1" name="Shipped" />
    <bpmn:sequenceFlow id="f1" sourceRef="s1" targetRef="t1" />
    <bpmn:sequenceFlow id="f2" sourceRef="t1" targetRef="g1" name="checked" />
    <bpmn:sequenceFlow id="f3" sourceRef="g1" targetRef="e1" name="yes" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="d1"><bpmndi:BPMNPlane id="p1" bpmnElement="Process_1">
    <bpmndi:BPMNShape id="s1_di" bpmnElement="s1"><dc:Bounds x="150" y="100" width="36" height="36" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="t1_di" bpmnElement="t1"><dc:Bounds x="240" y="78" width="100" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="g1_di" bpmnElement="g1"><dc:Bounds x="400" y="93" width="50" height="50" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="e1_di" bpmnElement="e1"><dc:Bounds x="520" y="100" width="36" height="36" /></bpmndi:BPMNShape>
    <bpmndi:BPMNEdge id="f1_di" bpmnElement="f1"><di:waypoint x="186" y="118" /><di:waypoint x="240" y="118" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="f2_di" bpmnElement="f2"><di:waypoint x="340" y="118" /><di:waypoint x="400" y="118" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="f3_di" bpmnElement="f3"><di:waypoint x="450" y="118" /><di:waypoint x="520" y="118" /></bpmndi:BPMNEdge>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;

  it('reads the real coordinates when the file carries diagram interchange', () => {
    const graph = readBpmn(WITH_DI)!;
    expect(shapes(graph)).toMatchObject({ 'Order received': 'ellipse', 'Check stock': 'rounded', 'In stock?': 'rhombus' });
    expect(graph.vertices.find((vertex) => vertex.label === 'Check stock')).toMatchObject({ x: 240, y: 78, width: 100 });
    expect(graph.edges).toHaveLength(3);
  });

  it('lays out a process that has no drawing attached to it', () => {
    // Code-generated BPMN routinely omits BPMNDiagram. The process is still a
    // process, and that is the case where seeing it matters most.
    const headless = WITH_DI.replace(/<bpmndi:BPMNDiagram[\s\S]*?<\/bpmndi:BPMNDiagram>/, '');
    const graph = readBpmn(headless)!;
    expect(label(graph)).toEqual(['Check stock', 'In stock?', 'Order received', 'Shipped']);
    expect(graph.edges).toHaveLength(3);
    expect(new Set(graph.vertices.map((vertex) => vertex.y)).size).toBeGreaterThan(1);
  });

  it('writes a start event, an end event and a gateway from where they sit in the flow', () => {
    const written = writeBpmn(readBpmn(WITH_DI)!);
    expect(written).toMatch(/<bpmn:startEvent [^>]*name="Order received"/);
    expect(written).toMatch(/<bpmn:endEvent [^>]*name="Shipped"/);
    expect(written).toMatch(/<bpmn:exclusiveGateway [^>]*name="In stock\?"/);
    expect(readBpmn(written)!.edges).toHaveLength(3);
  });

  it('writes an annotation as an association, never a sequence flow', () => {
    // A sequenceFlow to a textAnnotation is invalid BPMN and every engine
    // rejects the whole file for it.
    const graph = layoutDiagramGraph(
      [{ id: 'a', label: 'Task', shape: 'rounded' }, { id: 'n', label: 'Watch out', shape: 'note' }],
      [{ source: 'a', target: 'n' }],
    )!;
    const written = writeBpmn(graph);
    expect(written).toMatch(/<bpmn:association /);
    expect(written).not.toMatch(/<bpmn:sequenceFlow /);
    expect(written).toMatch(/<bpmn:textAnnotation[^>]*><bpmn:text>Watch out<\/bpmn:text>/);
  });
});

describe('Excalidraw', () => {
  const SCENE = JSON.stringify({
    type: 'excalidraw',
    version: 2,
    elements: [
      { id: 'r1', type: 'rectangle', x: 100, y: 80, width: 180, height: 90, backgroundColor: '#e0f2fe', strokeColor: '#0369a1' },
      { id: 'r1-text', type: 'text', containerId: 'r1', text: 'Ingest', x: 110, y: 110 },
      { id: 'd1', type: 'diamond', x: 360, y: 70, width: 140, height: 110 },
      { id: 'd1-text', type: 'text', containerId: 'd1', text: 'Valid?', x: 380, y: 110 },
      { id: 'gone', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, isDeleted: true },
      { id: 'a1', type: 'arrow', x: 280, y: 125, points: [[0, 0], [80, 0]], startBinding: { elementId: 'r1' }, endBinding: { elementId: 'd1' } },
    ],
  });

  it('reads shapes, their bound text as labels, and bindings as endpoints', () => {
    const graph = readExcalidraw(SCENE)!;
    expect(label(graph)).toEqual(['Ingest', 'Valid?']);
    expect(shapes(graph)).toMatchObject({ Ingest: 'rect', 'Valid?': 'rhombus' });
    expect(graph.edges[0]).toMatchObject({ source: 'r1', target: 'd1' });
  });

  it('leaves deleted elements out', () => {
    expect(readExcalidraw(SCENE)!.vertices).toHaveLength(2);
  });

  it('writes a label as its own bound text element, which is the only way one renders', () => {
    const written = writeExcalidraw(readExcalidraw(SCENE)!);
    const parsed = JSON.parse(written) as { elements: Array<{ type: string; containerId?: string; text?: string }> };
    const bound = parsed.elements.filter((element) => element.type === 'text' && element.containerId);
    expect(bound.map((element) => element.text).sort()).toEqual(['Ingest', 'Valid?']);
    expect(label(readExcalidraw(written))).toEqual(['Ingest', 'Valid?']);
  });

  it('writes the same file every time, rather than a new one per export', () => {
    const graph = readExcalidraw(SCENE)!;
    expect(writeExcalidraw(graph)).toBe(writeExcalidraw(graph));
  });

  it('refuses JSON that is not an Excalidraw scene', () => {
    expect(readExcalidraw('{"type":"something-else","elements":[]}')).toBeNull();
    expect(readExcalidraw('[{"name":"a row"}]')).toBeNull();
  });
});

describe('SVG', () => {
  const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="300">
    <g transform="translate(20,10)">
      <rect x="0" y="0" width="160" height="70" fill="#eef2ff" stroke="#4338ca" />
      <text x="80" y="40">Collect</text>
      <polygon points="260,0 340,45 260,90 180,45" />
      <text x="260" y="50">Ready?</text>
      <line x1="160" y1="35" x2="180" y2="45" stroke="#333" />
    </g>
    <text x="10" y="290">Pipeline v2</text>
  </svg>`;

  it('reads shapes with their transform applied, and labels them from the text inside', () => {
    const graph = readSvgShapes(SVG)!;
    const rect = graph.vertices.find((vertex) => vertex.label === 'Collect')!;
    expect(rect).toMatchObject({ shape: 'rect', x: 20, y: 10, width: 160, height: 70 });
    expect(graph.vertices.find((vertex) => vertex.label === 'Ready?')?.shape).toBe('rhombus');
    expect(graph.edges).toHaveLength(1);
  });

  it('keeps text that belongs to no shape as a borderless label', () => {
    const loose = readSvgShapes(SVG)!.vertices.find((vertex) => vertex.label === 'Pipeline v2');
    expect(loose?.shape).toBe('text');
  });

  it('reads nothing from a picture with no shapes in it', () => {
    expect(readSvgShapes('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 C10 10 20 0 30 10" fill="#f00"/></svg>')).toBeNull();
  });
});

describe('ArchiMate', () => {
  const MODEL = `<?xml version="1.0" encoding="UTF-8"?>
<archimate:model xmlns:archimate="http://www.archimatetool.com/archimate" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" name="Estate" id="m1">
  <folder name="Business" type="business">
    <element xsi:type="archimate:BusinessActor" name="Customer" id="e1" />
    <element xsi:type="archimate:ApplicationComponent" name="Billing" id="e2" />
    <element xsi:type="archimate:ServingRelationship" name="serves" id="r1" source="e2" target="e1" />
  </folder>
  <folder name="Views" type="diagrams">
    <element xsi:type="archimate:ArchimateDiagramModel" name="Overview" id="v1">
      <children xsi:type="archimate:DiagramObject" id="o1" archimateElement="e1">
        <bounds x="24" y="36" width="120" height="55" />
        <sourceConnection xsi:type="archimate:Connection" id="c1" source="o1" target="o2" archimateRelationship="r1" />
      </children>
      <children xsi:type="archimate:DiagramObject" id="o2" archimateElement="e2">
        <bounds x="264" y="36" width="120" height="55" />
      </children>
    </element>
  </folder>
</archimate:model>`;

  it('names a view object from the model element it refers to', () => {
    // The label is never in the box: an ArchiMate view REFERENCES elements that
    // live once in the model, which is why a naive reader gets empty rectangles.
    const graph = readArchimate(MODEL)!;
    expect(label(graph)).toEqual(['Billing', 'Customer']);
    expect(shapes(graph)).toMatchObject({ Customer: 'rounded', Billing: 'rect' });
  });

  it('reads a connection between two view objects, with the relationship name', () => {
    expect(readArchimate(MODEL)!.edges[0]).toMatchObject({ source: 'o1', target: 'o2', label: 'serves' });
  });
});

describe('Visio', () => {
  /** A stored-only ZIP, so the reader is exercised without a compressor. */
  function zip(entries: ReadonlyArray<readonly [string, string]>): Uint8Array {
    const encoder = new TextEncoder();
    const table = Array.from({ length: 256 }, (_, index) => {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      return value >>> 0;
    });
    const crc32 = (bytes: Uint8Array): number => {
      let value = 0xffffffff;
      for (const byte of bytes) value = table[(value ^ byte) & 0xff]! ^ (value >>> 8);
      return (value ^ 0xffffffff) >>> 0;
    };
    const locals: number[] = [];
    const central: number[] = [];
    let offset = 0;
    const push = (target: number[], ...values: number[]) => target.push(...values);
    const u16 = (value: number) => [value & 0xff, (value >> 8) & 0xff];
    const u32 = (value: number) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];
    for (const [name, content] of entries) {
      const nameBytes = encoder.encode(name);
      const body = encoder.encode(content);
      const crc = crc32(body);
      push(locals, ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(body.length), ...u32(body.length), ...u16(nameBytes.length), ...u16(0), ...nameBytes, ...body);
      push(central, ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(body.length), ...u32(body.length), ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nameBytes);
      offset = locals.length;
    }
    const eocd = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length), ...u32(central.length), ...u32(locals.length), ...u16(0)];
    return Uint8Array.from([...locals, ...central, ...eocd]);
  }

  const PAGES = `<Pages xmlns="http://schemas.microsoft.com/office/visio/2012/main"><Page ID="0" NameU="Page-1"><PageSheet><Cell N="PageWidth" V="8.5"/><Cell N="PageHeight" V="11"/></PageSheet></Page></Pages>`;
  const PAGE = `<PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main"><Shapes>
    <Shape ID="1" NameU="Process" Type="Shape"><Cell N="PinX" V="2"/><Cell N="PinY" V="10"/><Cell N="Width" V="2"/><Cell N="Height" V="1"/><Text>Receive order</Text></Shape>
    <Shape ID="2" NameU="Decision" Type="Shape"><Cell N="PinX" V="5"/><Cell N="PinY" V="10"/><Cell N="Width" V="2"/><Cell N="Height" V="1"/><Text>Approved?</Text></Shape>
    <Shape ID="5" NameU="Dynamic connector" Type="Shape"><Cell N="BeginX" V="3"/><Cell N="BeginY" V="10"/><Cell N="EndX" V="4"/><Cell N="EndY" V="10"/><Text>yes</Text></Shape>
  </Shapes><Connects>
    <Connect FromSheet="5" ToSheet="1" FromCell="BeginX" ToCell="PinX"/>
    <Connect FromSheet="5" ToSheet="2" FromCell="EndX" ToCell="PinX"/>
  </Connects></PageContents>`;

  const archive = zip([['visio/pages/pages.xml', PAGES], ['visio/pages/page1.xml', PAGE]]);

  it('converts inches from the bottom-left into pixels from the top-left', async () => {
    const graph = (await readVsdx(archive))!;
    const receive = graph.vertices.find((vertex) => vertex.label === 'Receive order')!;
    // PinX/PinY are the shape's CENTRE, and Y counts up from the page bottom:
    // x = (2 - 1) * 96, y = (11 - 10 - 0.5) * 96.
    expect(receive).toMatchObject({ x: 96, y: 48, width: 192, height: 96 });
  });

  it('reads a master name as the shape it draws', async () => {
    expect(shapes(await readVsdx(archive))).toMatchObject({ 'Receive order': 'rounded', 'Approved?': 'rhombus' });
  });

  it('takes connector endpoints from <Connects>, which is the only place they are stated', async () => {
    const graph = (await readVsdx(archive))!;
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ label: 'yes', source: '1', target: '2' });
  });
});

describe('the registry', () => {
  it('routes a file name to its notation', () => {
    expect(notationForFileName('system.drawio')?.id).toBe('drawio');
    expect(notationForFileName('FLOW.MMD')?.id).toBe('mermaid');
    expect(notationForFileName('arch.puml')?.id).toBe('plantuml');
    expect(notationForFileName('deps.gv')?.id).toBe('dot');
    expect(notationForFileName('order.bpmn')?.id).toBe('bpmn');
    expect(notationForFileName('sketch.excalidraw')?.id).toBe('excalidraw');
    expect(notationForFileName('estate.archimate')?.id).toBe('archimate');
    expect(notationForFileName('plan.vsdx')?.id).toBe('vsdx');
    expect(notationForFileName('notes.txt')).toBeNull();
  });

  it('offers only notations it can actually write as conversion targets', () => {
    const targets = DIAGRAM_TARGETS.map((notation) => notation.id);
    expect(targets).toEqual(['drawio', 'mermaid', 'plantuml', 'dot', 'bpmn', 'excalidraw']);
    // Read-only formats convert OUT and are never a destination that fails
    // after the click.
    for (const id of ['svg', 'vsdx', 'archimate']) expect(diagramNotation(id)?.write).toBeUndefined();
  });

  it('gives every notation an extension and a MIME type of its own', () => {
    const mimes = new Set<string>();
    for (const notation of DIAGRAM_NOTATION_LIST) {
      expect(notation.extensions.length).toBeGreaterThan(0);
      expect(notation.mimeType).toMatch(/\//);
      expect(notation.read ?? notation.readBytes).toBeTruthy();
      mimes.add(notation.mimeType);
    }
    expect(mimes.size).toBe(DIAGRAM_NOTATION_LIST.length);
  });

  it('unwraps a diagram from the code fence a model returns it in', () => {
    expect(detectDiagramSource('Here you go:\n```mermaid\nflowchart TD\n a-->b\n```')).toMatchObject({ format: 'mermaid' });
    expect(detectDiagramSource('```xml\n<mxfile><diagram/></mxfile>\n```')?.format).toBe('drawio');
    expect(detectDiagramSource('@startuml\na --> b\n@enduml')?.format).toBe('plantuml');
    expect(detectDiagramSource('digraph g { a -> b }')?.format).toBe('dot');
    expect(detectDiagramSource('just some prose')).toBeNull();
  });

  it('does not sniff an SVG out of a text field: a picture is a picture', () => {
    expect(detectDiagramSource('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>')).toBeNull();
  });
});

describe('conversion', () => {
  const DRAWIO = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
    <mxCell id="a" value="Draft" style="rounded=1" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell>
    <mxCell id="b" value="Review" style="rhombus" vertex="1" parent="1"><mxGeometry x="260" y="40" width="120" height="60" as="geometry"/></mxCell>
    <mxCell id="e" value="submit" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>
  </root></mxGraphModel>`;

  it('carries shapes, labels and connections from draw.io to every writable notation', async () => {
    for (const target of DIAGRAM_TARGETS) {
      const converted = await convertDiagramSource(DRAWIO, 'drawio', target.id);
      expect(converted, target.id).toBeTruthy();
      expect(converted!.shapes, target.id).toBe(2);
      expect(converted!.connections, target.id).toBe(1);
      expect(converted!.droppedConnections, target.id).toBe(0);
      const reread = await readDiagramSource(target.id, converted!.source);
      expect(label(reread), target.id).toEqual(['Draft', 'Review']);
    }
  });

  it('recovers an endpoint from geometry so a loose connector survives the trip to a text notation', async () => {
    // Visio and bare draw.io edges frequently carry waypoints and no endpoint
    // references. Without this, every such arrow disappears silently.
    const loose = DRAWIO.replace('source="a" target="b"', '')
      .replace('<mxGeometry relative="1" as="geometry"/>', '<mxGeometry relative="1" as="geometry"><mxPoint x="150" y="70" as="sourcePoint"/><mxPoint x="270" y="70" as="targetPoint"/></mxGeometry>');
    const graph = (await readDiagramSource('drawio', loose))!;
    expect(graph.edges[0]!.source).toBeUndefined();
    expect(resolveEdgeEndpoints(graph)[0]).toMatchObject({ source: 'a', target: 'b' });
    const converted = await convertDiagramSource(loose, 'drawio', 'mermaid');
    expect(converted!.droppedConnections).toBe(0);
    expect(converted!.source).toMatch(/-->/);
  });

  it('refuses a conversion it cannot honour instead of writing an empty file', async () => {
    expect(await convertDiagramSource('sequenceDiagram\n  A->>B: hi', 'mermaid', 'drawio')).toBeNull();
    expect(await convertDiagramSource(DRAWIO, 'drawio', 'vsdx')).toBeNull();
  });
});

// Imported last so the registry assertions above read as the contract, not as
// a re-export of the module under test.
import { DIAGRAM_NOTATIONS as DIAGRAM_NOTATION_LIST } from './diagramNotations';
