// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { drawioLabelLines, drawioLabelText, drawioShapePolygon, parseDrawioStyle, parseDrawioXml, resolveDrawioXml } from './drawioDiagram';

const DIAGRAM = `<mxfile host="app.diagrams.net"><diagram id="a" name="Page-1"><mxGraphModel dx="800" dy="600" grid="1">
  <root>
    <mxCell id="0" /><mxCell id="1" parent="0" />
    <mxCell id="start" value="Research" style="rounded=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1">
      <mxGeometry x="40" y="40" width="160" height="60" as="geometry" />
    </mxCell>
    <mxCell id="decide" value="Enough &amp;lt;data&amp;gt;?" style="rhombus;fillColor=#ffe6cc;" vertex="1" parent="1">
      <mxGeometry x="280" y="30" width="140" height="80" as="geometry" />
    </mxCell>
    <mxCell id="e1" value="yes" style="edgeStyle=orthogonalEdgeStyle;dashed=1;" edge="1" parent="1" source="start" target="decide">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="240" y="70" /></Array></mxGeometry>
    </mxCell>
  </root>
</mxGraphModel></diagram></mxfile>`;

describe('parseDrawioXml', () => {
  it('reads vertices with their shape, label, colours, and geometry', () => {
    const graph = parseDrawioXml(DIAGRAM);
    expect(graph?.vertices).toHaveLength(2);
    const [start, decide] = graph!.vertices;
    expect(start).toMatchObject({ label: 'Research', shape: 'rounded', x: 40, y: 40, width: 160, height: 60, fill: '#dae8fc', stroke: '#6c8ebf' });
    expect(decide).toMatchObject({ label: 'Enough <data>?', shape: 'rhombus', fill: '#ffe6cc' });
  });

  it('routes an edge from box edge to box edge through its waypoints', () => {
    const graph = parseDrawioXml(DIAGRAM);
    const edge = graph!.edges[0]!;
    expect(edge).toMatchObject({ label: 'yes', dashed: true, arrow: true });
    expect(edge.points).toHaveLength(3);
    // Clipped to the source box, not left at its centre.
    expect(edge.points[0]!.x).toBe(200);
    expect(edge.points[2]!.x).toBe(280);
  });

  it('produces bounds that cover every shape', () => {
    const graph = parseDrawioXml(DIAGRAM)!;
    expect(graph.x).toBeLessThan(40);
    expect(graph.x + graph.width).toBeGreaterThan(420);
  });

  it('returns null for payloads that are not mxGraph scenes', () => {
    expect(parseDrawioXml('<html><body>nope</body></html>')).toBeNull();
    expect(parseDrawioXml('not xml at all <<<')).toBeNull();
  });

  it('reads a label from an object wrapper', () => {
    const graph = parseDrawioXml(`<mxGraphModel><root><mxCell id="0"/><object id="w" label="Wrapped"><mxCell vertex="1" parent="0" style="ellipse"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell></object></root></mxGraphModel>`);
    expect(graph?.vertices[0]).toMatchObject({ id: 'w', label: 'Wrapped', shape: 'ellipse' });
  });

  it('keeps an embedded image data URL on an image cell', () => {
    const graph = parseDrawioXml('<mxGraphModel><root><mxCell id="0"/><mxCell id="pic" vertex="1" parent="0" style="shape=image;image=data:image/png;base64,AAAA;"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell></root></mxGraphModel>');
    expect(graph?.vertices[0]?.imageUrl).toBe('data:image/png;base64,AAAA');
  });
});

describe('resolveDrawioXml', () => {
  it('unwraps the mxGraphModel from an mxfile', async () => {
    await expect(resolveDrawioXml(DIAGRAM)).resolves.toContain('<mxGraphModel');
  });

  it('returns null when there is no diagram payload', async () => {
    await expect(resolveDrawioXml('   ')).resolves.toBeNull();
  });
});

describe('style and label helpers', () => {
  it('parses keyed and keyless style tokens', () => {
    expect(parseDrawioStyle('rounded=1;ellipse;fillColor=#fff;')).toEqual({ rounded: '1', ellipse: '1', fillcolor: '#fff' });
  });

  it('reads inline HTML labels back as text', () => {
    expect(drawioLabelText('<b>Ship</b><br/>the&nbsp;deck')).toBe('Ship\nthe deck');
  });

  it('wraps a long label to fit its shape', () => {
    const lines = drawioLabelLines('Competitive landscape review across four segments', 120, 12);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => line.length <= 18)).toBe(true);
  });

  it('gives polygons for angular shapes and none for rectangles', () => {
    const vertex = { id: 'v', label: '', x: 0, y: 0, width: 100, height: 50, fontSize: 12, dashed: false } as const;
    expect(drawioShapePolygon({ ...vertex, shape: 'rhombus' })).toBe('50,0 100,25 50,50 0,25');
    expect(drawioShapePolygon({ ...vertex, shape: 'rounded' })).toBeNull();
  });
});
