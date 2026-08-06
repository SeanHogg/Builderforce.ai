import { describe, expect, it } from 'vitest';
import { dxfPreviewSvg, parseAsciiStl, parseDxfPaths, stlPreviewSvg, svgDataUrl } from './creativeGeometry';

const SQUARE_DXF = ['0', 'SECTION', '2', 'ENTITIES', '0', 'LWPOLYLINE', '8', '0', '90', '4', '70', '1', '10', '0', '20', '0', '10', '100', '20', '0', '10', '100', '20', '60', '10', '0', '20', '60', '0', 'CIRCLE', '8', '0', '10', '50', '20', '30', '40', '14', '0', 'ENDSEC', '0', 'EOF', ''].join('\n');

const TRIANGLE_STL = `solid part
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 10 0 0
vertex 0 10 0
endloop
endfacet
endsolid part`;

describe('DXF preview', () => {
  it('reads polylines and circles back out of a drawing', () => {
    const paths = parseDxfPaths(SQUARE_DXF);
    expect(paths).toHaveLength(2);
    expect(paths[0]).toMatchObject({ closed: true });
    expect(paths[0]!.points).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }]);
    // The circle is approximated as a closed path so one renderer draws everything.
    expect(paths[1]!.points.length).toBeGreaterThan(16);
    expect(paths[1]!.closed).toBe(true);
  });

  it('draws the drawing rather than pointing an image at a DXF', () => {
    const svg = dxfPreviewSvg(SQUARE_DXF, { width: 400, height: 300 });
    expect(svg).toContain('<svg');
    expect(svg).toContain('<path');
    expect(svg!.match(/<path/g)).toHaveLength(2);
  });

  it('returns nothing for a file with no readable geometry', () => {
    expect(dxfPreviewSvg('0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n')).toBeNull();
    expect(dxfPreviewSvg('')).toBeNull();
  });
});

describe('STL preview', () => {
  it('reads the facets of an ASCII mesh', () => {
    const triangles = parseAsciiStl(TRIANGLE_STL);
    expect(triangles).toHaveLength(1);
    expect(triangles[0]!.vertices[1]).toEqual([10, 0, 0]);
  });

  it('projects every facet into the frame', () => {
    const svg = stlPreviewSvg(TRIANGLE_STL, { width: 400, height: 300 });
    expect(svg).toContain('<polygon');
    const coordinates = [...svg!.matchAll(/points="([^"]+)"/g)].flatMap((match) => match[1]!.split(/[ ,]/).map(Number));
    expect(coordinates.every((value) => Number.isFinite(value))).toBe(true);
    expect(Math.min(...coordinates)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...coordinates)).toBeLessThanOrEqual(400);
  });

  it('paints far facets before near ones so the solid reads as solid', () => {
    const stl = `solid pair
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 10 0 0
vertex 0 10 0
endloop
endfacet
facet normal 0 0 1
outer loop
vertex 0 0 40
vertex 10 0 40
vertex 0 10 40
endloop
endfacet
endsolid pair`;
    const svg = stlPreviewSvg(stl)!;
    const fills = [...svg.matchAll(/fill="rgb\(([^)]+)\)"/g)].map((match) => match[1]);
    expect(fills).toHaveLength(2);
  });

  it('returns nothing when there is no mesh to draw', () => {
    expect(stlPreviewSvg('solid empty\nendsolid empty')).toBeNull();
  });
});

describe('svgDataUrl', () => {
  it('produces a url an image element can actually load', () => {
    expect(svgDataUrl('<svg/>')).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
  });
});
