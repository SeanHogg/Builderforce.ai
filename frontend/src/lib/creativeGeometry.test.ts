import { describe, expect, it } from 'vitest';
import {
  dxfPreviewSvg,
  meshFormatFromHint,
  meshPreviewSvg,
  parseAsciiStl,
  parseBinaryStl,
  parseDxfPaths,
  parseGltf,
  parseMeshTriangles,
  parseObj,
  parseStepTriangles,
  stlPreviewSvg,
  svgDataUrl,
} from './creativeGeometry';

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

/* ---------- reading a mesh authored somewhere other than here ---------- */

/** One triangle, written the way a slicer writes it: 80-byte header, count, facets. */
function binaryStl(triangles: Array<[number, number, number][]>): ArrayBuffer {
  const buffer = new ArrayBuffer(84 + triangles.length * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triangles.length, true);
  triangles.forEach((vertices, index) => {
    const base = 84 + index * 50 + 12;
    vertices.forEach((vertex, corner) => {
      vertex.forEach((component, axis) => view.setFloat32(base + corner * 12 + axis * 4, component, true));
    });
  });
  return buffer;
}

function encode(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

describe('mesh readers', () => {
  const face: [number, number, number][] = [[0, 0, 0], [10, 0, 0], [0, 10, 0]];

  it('reads a binary STL, which is what everything except Canvas writes', () => {
    const triangles = parseBinaryStl(binaryStl([face, [[0, 0, 5], [10, 0, 5], [0, 10, 5]]]));
    expect(triangles).toHaveLength(2);
    expect(triangles[0]!.vertices[1]).toEqual([10, 0, 0]);
  });

  it('tells binary and ASCII STL apart from the bytes, not the extension', () => {
    expect(parseMeshTriangles(binaryStl([face]), 'stl')).toHaveLength(1);
    expect(parseMeshTriangles(encode(TRIANGLE_STL), 'stl')).toHaveLength(1);
  });

  it('reads an OBJ, fanning faces of any size into triangles', () => {
    const obj = 'v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n';
    const triangles = parseObj(obj);
    expect(triangles).toHaveLength(2);
    // Negative indices count back from the vertices seen so far.
    expect(parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1\n')).toHaveLength(1);
    // `v/vt/vn` faces lead with the vertex index, which is the one that matters.
    expect(parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1/1/1 2/2/2 3/3/3\n')).toHaveLength(1);
  });

  it('reads a glTF, with each node placed where the file puts it', () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const base64 = Buffer.from(new Uint8Array(positions.buffer)).toString('base64');
    const document = {
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, translation: [5, 0, 0] }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }],
      buffers: [{ uri: `data:application/octet-stream;base64,${base64}`, byteLength: positions.byteLength }],
    };
    const triangles = parseGltf(JSON.stringify(document));
    expect(triangles).toHaveLength(1);
    // Read without the node transform this would sit at the origin — a different
    // object from the one the file describes.
    expect(triangles[0]!.vertices[0]).toEqual([5, 0, 0]);
  });

  it('reads the tessellation a STEP file carries, and nothing when it carries none', () => {
    const step = "ISO-10303-21;\nDATA;\n#10=COORDINATES_LIST('',3,((0.,0.,0.),(10.,0.,0.),(0.,10.,0.)));\n"
      + "#11=TRIANGULATED_FACE_SET('',#10,$,$,((1,2,3)));\nENDSEC;\nEND-ISO-10303-21;";
    const triangles = parseStepTriangles(step);
    expect(triangles).toHaveLength(1);
    expect(triangles[0]!.vertices[1]).toEqual([10, 0, 0]);
    // A pure B-rep part has no triangles to read, and guessing at a shape the
    // file does not describe would be worse than showing nothing.
    expect(parseStepTriangles("ISO-10303-21;\n#1=ADVANCED_BREP_SHAPE_REPRESENTATION('',(#2),#3);")).toEqual([]);
  });

  it('names the reader from a file name, a media type or a format label', () => {
    expect(meshFormatFromHint('part.STL')).toBe('stl');
    expect(meshFormatFromHint('data:model/stl;charset=utf-8,solid')).toBe('stl');
    expect(meshFormatFromHint('model/gltf+json')).toBe('gltf');
    expect(meshFormatFromHint('scene.glb')).toBe('glb');
    expect(meshFormatFromHint('assembly.stp')).toBe('step');
    // A word that merely contains a format name is not a format.
    expect(meshFormatFromHint('objective-summary.pdf')).toBeNull();
  });

  it('sniffs the container when nothing named it', () => {
    expect(parseMeshTriangles(encode(TRIANGLE_STL))).toHaveLength(1);
    expect(parseMeshTriangles(encode('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'))).toHaveLength(1);
    expect(parseMeshTriangles(encode('not a mesh'))).toEqual([]);
  });
});

describe('meshPreviewSvg', () => {
  const triangles = parseAsciiStl(TRIANGLE_STL);

  it('draws the same mesh differently from a different camera', () => {
    // This is the whole point of re-projecting: a model that projects identically
    // at every angle is a photograph on a card, not an object in a space.
    const front = meshPreviewSvg(triangles, { yaw: 0, pitch: 0 });
    const turned = meshPreviewSvg(triangles, { yaw: 40, pitch: 20 });
    expect(front).toContain('<polygon');
    expect(turned).not.toEqual(front);
  });

  it('has nothing to draw for an empty mesh', () => {
    expect(meshPreviewSvg([])).toBeNull();
  });
});
