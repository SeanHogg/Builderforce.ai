// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  convertGraphSource, diagramConvertSource, diagramConvertTargets, diagramImageAsset, svgFromDataUrl,
} from './canvasDiagramConvert';
import type { CreationNodeData } from '@/components/creation-canvas/types';

const data = (fields: Record<string, unknown>) => ({ title: 'Object', status: '', ...fields }) as unknown as CreationNodeData;

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">'
  + '<rect x="20" y="20" width="140" height="60" /><text x="90" y="55">Collect</text>'
  + '<rect x="240" y="20" width="140" height="60" /><text x="310" y="55">Publish</text>'
  + '<line x1="160" y1="50" x2="240" y2="50" /></svg>';

const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SVG)}`;

describe('svgFromDataUrl', () => {
  it('reads both forms a browser writes', () => {
    expect(svgFromDataUrl(svgUrl)).toBe(SVG);
    expect(svgFromDataUrl(`data:image/svg+xml;base64,${btoa('<svg/>')}`)).toBe('<svg/>');
  });

  it('returns null for anything that is not an SVG data URL', () => {
    expect(svgFromDataUrl('data:image/png;base64,AAAA')).toBeNull();
    expect(svgFromDataUrl('https://example.com/a.svg')).toBeNull();
  });
});

describe('diagramConvertSource', () => {
  it('reads a vector image as real shapes, not as a picture to embed', async () => {
    // This is the whole point of the SVG path: an export from a tool whose
    // licence has lapsed comes back as editable shapes, where it used to come
    // back as a draw.io file containing a screenshot.
    const source = await diagramConvertSource(data({ kind: 'image', outputUrl: svgUrl }));
    expect(source?.kind).toBe('graph');
    expect(source?.kind === 'graph' ? source.graph.vertices.map((vertex) => vertex.label) : null).toEqual(['Collect', 'Publish']);
  });

  it('reads a CAD preview as shapes too, because a CAD drawing was authored as shapes', async () => {
    const source = await diagramConvertSource(data({ kind: 'cad', thumbnailUrl: svgUrl }));
    expect(source?.kind).toBe('graph');
  });

  it('keeps a bitmap an asset — there are no shapes in a photograph to find', async () => {
    const source = await diagramConvertSource(data({ kind: 'image', outputUrl: 'data:image/png;base64,AAAA', fileName: 'whiteboard.png' }));
    expect(source).toMatchObject({ kind: 'asset', asset: { name: 'whiteboard.png' } });
  });

  it('keeps a freehand drawing an asset even though its strokes could be read', async () => {
    // A pen stroke is a pen stroke. Reading one as "a connection between two
    // shapes" invents structure the person never drew.
    const source = await diagramConvertSource(data({
      kind: 'drawing',
      strokes: [{ tool: 'pen', points: [{ x: 0, y: 0 }, { x: 40, y: 40 }], stroke: '#000', strokeWidth: 2 }],
      drawingWidth: 120, drawingHeight: 90,
    }));
    expect(source?.kind).toBe('asset');
  });

  it('reads a diagram object in whatever notation it is stored in', async () => {
    const source = await diagramConvertSource(data({ kind: 'diagram', diagramFormat: 'mermaid', diagram: 'flowchart TD\n  a[One] --> b[Two]' }));
    expect(source).toMatchObject({ kind: 'graph', from: 'mermaid' });
  });

  it('returns nothing for an object with neither shapes nor a preview', async () => {
    expect(await diagramConvertSource(data({ kind: 'note', content: 'just text' }))).toBeNull();
  });
});

describe('diagramConvertTargets', () => {
  it('offers a picture only the notation that can hold one', async () => {
    const source = (await diagramConvertSource(data({ kind: 'image', outputUrl: 'data:image/png;base64,AAAA' })))!;
    expect(diagramConvertTargets(source).map((notation) => notation.id)).toEqual(['drawio']);
  });

  it('offers a graph every writable notation except the one it is already in', async () => {
    const source = (await diagramConvertSource(data({ kind: 'diagram', diagramFormat: 'mermaid', diagram: 'flowchart TD\n  a[One] --> b[Two]' })))!;
    const ids = diagramConvertTargets(source).map((notation) => notation.id);
    expect(ids).toContain('drawio');
    expect(ids).toContain('bpmn');
    expect(ids).not.toContain('mermaid');
  });
});

describe('convertGraphSource', () => {
  it('writes the shapes an SVG gave up into the destination notation', async () => {
    const source = (await diagramConvertSource(data({ kind: 'image', outputUrl: svgUrl })))!;
    const converted = convertGraphSource(source, 'mermaid')!;
    expect(converted.shapes).toBe(2);
    expect(converted.source).toContain('Collect');
    expect(converted.source).toContain('Publish');
    // The line between the two boxes is recovered as a real connection, which
    // is what makes the result a diagram rather than two loose rectangles.
    expect(converted.connections).toBe(1);
    expect(converted.droppedConnections).toBe(0);
  });

  it('refuses to write an asset source as a graph', async () => {
    const source = (await diagramConvertSource(data({ kind: 'image', outputUrl: 'data:image/png;base64,AAAA' })))!;
    expect(convertGraphSource(source, 'drawio')).toBeNull();
  });
});

describe('diagramImageAsset', () => {
  it('draws every stroke of a sketch, not just the first path', () => {
    const asset = diagramImageAsset(data({
      kind: 'drawing',
      strokes: [
        { tool: 'pen', points: [{ x: 0, y: 0 }, { x: 20, y: 20 }], stroke: '#111', strokeWidth: 2 },
        { tool: 'rect', points: [{ x: 30, y: 30 }, { x: 90, y: 70 }], stroke: '#111', strokeWidth: 2 },
      ],
      drawingWidth: 120, drawingHeight: 90,
    }))!;
    const svg = svgFromDataUrl(asset.dataUrl)!;
    expect(svg).toContain('<path');
    expect(svg).toContain('<rect');
  });
});
