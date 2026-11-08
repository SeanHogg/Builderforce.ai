import { describe, expect, it } from 'vitest';
import { dxfPreviewSvg, parseAsciiStl, parseDxfPaths } from '@/lib/creativeGeometry';
import { meshToStlAscii } from '../mesh/meshStl';
import { meshVolume } from '../mesh/triMesh';
import { renderCadDxf } from './cadDxf';
import { buildCadExport, cadExportFileName, CAD_EXPORT_FORMATS, CAD_EXPORT_ORDER } from './cadExport';
import { cadToMesh } from './cadExtrude';
import { dimensionGeometry, formatLength, hitsShape, rectOutline, topmostShapeAt, visibleShapes } from './cadGeometry';
import { renderCadPdf } from './cadPdf';
import { renderCadSvg } from './cadSvg';
import {
  addLayer, addShape, cadStateFrom, createBlankCadState, removeLayer, removeShapes, setActiveLayer, updateLayer,
  type CadShape, type CadState,
} from './cadState';
import { cadTemplatePreset, seedCadFromTemplate } from './cadTemplates';
import { shapeFromDrag, snapPoint } from './cadTools';

const INK = '#000000';
const PAPER = '#ffffff';
const rect: CadShape = { id: 'r1', layer: '0', kind: 'rect', x: 10, y: 20, width: 100, height: 60 };
const circle: CadShape = { id: 'c1', layer: '0', kind: 'circle', cx: 60, cy: 50, radius: 14 };
const line: CadShape = { id: 'l1', layer: '0', kind: 'line', x1: 0, y1: 0, x2: 30, y2: 40 };
const dimension: CadShape = { id: 'd1', layer: '0', kind: 'dimension', x1: 10, y1: 90, x2: 110, y2: 90, offsetMm: 8 };
const note: CadShape = { id: 't1', layer: '0', kind: 'text', x: 12, y: 15, text: 'Plate (A)', heightMm: 5 };

function drawing(shapes: CadShape[], patch: Partial<CadState> = {}): CadState {
  return { ...createBlankCadState({ layerInk: INK, widthMm: 200, heightMm: 100 }), shapes, ...patch };
}

describe('cadStateFrom', () => {
  it('reads anything unreadable as a blank sheet', () => {
    for (const bad of [null, undefined, 'x', 7, [], {}]) {
      const state = cadStateFrom(bad, INK);
      expect(state.shapes).toEqual([]);
      expect(state.layers.map((layer) => layer.name)).toEqual(['0']);
    }
  });

  it('drops malformed shapes and moves a shape on a missing layer to the default layer', () => {
    const state = cadStateFrom({
      shapes: [rect, { id: 'x', kind: 'circle', cx: 1, cy: 1, radius: -3 }, { kind: 'line' }, { ...line, id: 'l2', layer: 'ghost' }, { id: 'p', kind: 'polyline', points: [{ x: 0, y: 0 }] }],
    }, INK);
    expect(state.shapes.map((shape) => shape.id)).toEqual(['r1', 'l2']);
    expect(state.shapes[1]!.layer).toBe('0');
  });

  it('keeps layers unique, restores the default layer and repairs a dangling active layer', () => {
    const state = cadStateFrom({ layers: [{ name: 'walls', color: '#ff0000' }, { name: 'walls' }], activeLayerName: 'gone' }, INK);
    expect(state.layers.map((layer) => layer.name)).toEqual(['0', 'walls']);
    expect(state.layers[1]!.color).toBe('#ff0000');
    expect(state.activeLayerName).toBe('0');
  });

  it('rejects absurd sheet sizes', () => {
    expect(cadStateFrom({ widthMm: 1e9, heightMm: 3 }, INK)).toMatchObject({ widthMm: 420, heightMm: 297 });
  });
});

describe('cad edits', () => {
  it('adds a shape without touching the input', () => {
    const before = drawing([]);
    const after = addShape(before, rect);
    expect(before.shapes).toHaveLength(0);
    expect(after.shapes).toEqual([rect]);
  });

  it('refuses to delete from a locked layer', () => {
    const locked = updateLayer(drawing([rect, circle]), '0', { locked: true });
    expect(removeShapes(locked, ['r1']).shapes).toHaveLength(2);
    expect(removeShapes(updateLayer(locked, '0', { locked: false }), ['r1']).shapes.map((shape) => shape.id)).toEqual(['c1']);
  });

  it('removing a layer removes its shapes, but never the last layer', () => {
    const withWalls = addLayer(drawing([rect, { ...line, layer: 'walls' }]), { name: 'walls', visible: true, locked: false, color: '#112233' });
    expect(addLayer(withWalls, { name: 'walls', visible: false, locked: false, color: '#000000' })).toBe(withWalls);
    const active = setActiveLayer(withWalls, 'walls');
    const removed = removeLayer(active, 'walls');
    expect(removed.shapes.map((shape) => shape.id)).toEqual(['r1']);
    expect(removed.activeLayerName).toBe('0');
    expect(removeLayer(removed, '0')).toBe(removed);
  });
});

describe('cad geometry', () => {
  it('hides shapes on a hidden layer from drawing and from export', () => {
    const state = updateLayer(drawing([rect, circle]), '0', { visible: false });
    expect(visibleShapes(state)).toEqual([]);
    expect(renderCadSvg(state, PAPER)).not.toContain('<rect x="10"');
  });

  it('hit-tests by shape and skips locked layers', () => {
    expect(hitsShape(circle as Extract<CadShape, { kind: 'circle' }>, { x: 60, y: 60 }, 1)).toBe(true);
    expect(hitsShape(line, { x: 15, y: 20 }, 1)).toBe(true);
    expect(hitsShape(line, { x: 30, y: 0 }, 1)).toBe(false);
    const state = drawing([rect, circle]);
    expect(topmostShapeAt(state, { x: 60, y: 50 }, 1)?.id).toBe('c1');
    expect(topmostShapeAt(updateLayer(state, '0', { locked: true }), { x: 60, y: 50 }, 1)).toBeNull();
  });

  it('measures a dimension and offsets it perpendicular to the measured segment', () => {
    const geometry = dimensionGeometry(dimension as Extract<CadShape, { kind: 'dimension' }>, 'mm')!;
    expect(geometry.lengthMm).toBe(100);
    expect(geometry.label).toBe('100mm');
    // dx = 100, dy = 0 → the normal is (0, 1) → pushed 8 mm down the sheet.
    expect(geometry.line[0]).toEqual({ x: 10, y: 98 });
    expect(dimensionGeometry({ ...dimension, x2: 10, y2: 90 } as Extract<CadShape, { kind: 'dimension' }>, 'mm')).toBeNull();
    expect(formatLength(254, 'in')).toBe('10in');
  });

  it('rounds a rectangle corner into more points', () => {
    expect(rectOutline(rect as Extract<CadShape, { kind: 'rect' }>)).toHaveLength(4);
    expect(rectOutline({ ...rect, cornerRadius: 5 } as Extract<CadShape, { kind: 'rect' }>).length).toBeGreaterThan(4);
  });
});

describe('DXF', () => {
  const state = drawing([rect, circle, line, dimension, note]);
  const dxf = renderCadDxf(state);

  it('writes a complete, sectioned file with the unit and every layer', () => {
    expect(dxf.startsWith('0\r\nSECTION')).toBe(true);
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
    expect(dxf).toContain('$INSUNITS\r\n70\r\n4');
    expect(dxf).toContain('LWPOLYLINE');
    expect(dxf).toContain('CIRCLE');
  });

  it('flips Y so the drawing is not mirrored', () => {
    // The sheet is 100 high; the line runs from (0,0) at the top to (30,40).
    const paths = parseDxfPaths(renderCadDxf(drawing([line])));
    expect(paths).toHaveLength(1);
    expect(paths[0]!.points).toEqual([{ x: 0, y: 100 }, { x: 30, y: 60 }]);
  });

  it('is readable back by the canvas DXF previewer', () => {
    expect(dxfPreviewSvg(dxf)).toContain('<svg');
  });

  it('escapes layer names that DXF forbids', () => {
    const odd = addLayer(drawing([]), { name: 'a/b:c', visible: true, locked: false, color: '#000000' });
    expect(renderCadDxf(odd)).toContain('a_b_c');
  });

  it('keeps sanitised layer names unique', () => {
    let two = addLayer(drawing([]), { name: 'a/b', visible: true, locked: false, color: '#000000' });
    two = addLayer(two, { name: 'a:b', visible: true, locked: false, color: '#000000' });
    const layerNames = layerTableNames(renderCadDxf(two));
    expect(layerNames).toContain('a_b');
    expect(layerNames).toContain('a_b_2');
    expect(new Set(layerNames.map((name) => name.toUpperCase())).size).toBe(layerNames.length);
  });

  it('strips line breaks and control characters from TEXT', () => {
    const multi = renderCadDxf(drawing([{ ...note, text: 'one\r\ntwo\u0007three' }]));
    expect(multi).toContain('1\r\none two three\r\n');
  });

  it('declares R2000 with a handle seed above every issued handle', () => {
    const all = groups(dxf);
    expect(dxf).toContain('$ACADVER\r\n1\r\nAC1015');
    const seed = parseInt(all[all.findIndex((g) => g.value === '$HANDSEED') + 1]!.value, 16);
    // Group 5 after the header is a handle; $HANDSEED's own value is the header's only 5.
    const issued = all.slice(all.findIndex((g) => g.value === 'TABLES')).filter((g) => g.code === 5).map((g) => parseInt(g.value, 16));
    expect(issued.length).toBeGreaterThan(0);
    expect(Math.max(...issued)).toBeLessThan(seed);
    expect(new Set(issued).size).toBe(issued.length);
  });

  it('has the TABLES a strict reader needs', () => {
    for (const name of ['VPORT', 'LTYPE', 'LAYER', 'STYLE', 'BLOCK_RECORD']) expect(dxf).toContain(`0\r\nTABLE\r\n2\r\n${name}\r\n`);
    expect(dxf).toContain('2\r\nCONTINUOUS\r\n');
    expect(dxf).toContain('2\r\nSTANDARD\r\n');
    expect(dxf).toContain('100\r\nAcDbLayerTableRecord');
    expect(dxf).toContain('0\r\nSECTION\r\n2\r\nOBJECTS');
    expect(dxf).toContain('0\r\nDICTIONARY\r\n');
  });

  it('gives every entity a handle, an owner and the AcDbEntity + subclass markers', () => {
    const all = groups(dxf);
    const start = all.findIndex((g) => g.code === 2 && g.value === 'ENTITIES');
    const end = all.findIndex((g, i) => i > start && g.code === 0 && g.value === 'ENDSEC');
    const subclass: Record<string, string> = { LINE: 'AcDbLine', LWPOLYLINE: 'AcDbPolyline', CIRCLE: 'AcDbCircle', TEXT: 'AcDbText' };
    let seen = 0;
    for (let i = start; i < end; i++) {
      if (all[i]!.code !== 0) continue;
      const kind = all[i]!.value;
      let next = i + 1;
      while (next < end && all[next]!.code !== 0) next++;
      const body = all.slice(i + 1, next);
      const markers = body.filter((g) => g.code === 100).map((g) => g.value);
      expect(body[0]!.code, `${kind} starts with a handle`).toBe(5);
      expect(body.some((g) => g.code === 330), `${kind} has an owner`).toBe(true);
      expect(markers[0], `${kind} marker`).toBe('AcDbEntity');
      expect(markers, `${kind} subclass`).toContain(subclass[kind]);
      seen++;
    }
    // rect, circle, line, a dimension (3 lines + text) and the note.
    expect(seen).toBeGreaterThanOrEqual(8);
  });

  it('still round-trips through the previewer for every entity kind', () => {
    const paths = parseDxfPaths(dxf);
    // rect (closed polyline), circle, line, dimension lines (3) — text is not a path.
    expect(paths.length).toBeGreaterThanOrEqual(6);
    expect(paths.some((path) => path.closed && path.points.length === 4)).toBe(true);
    expect(dxfPreviewSvg(dxf)).toContain('<svg');
  });
});

/** The file as (group code, value) pairs. */
function groups(dxf: string): Array<{ code: number; value: string }> {
  const lines = dxf.split('\r\n');
  const out: Array<{ code: number; value: string }> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) out.push({ code: Number(lines[i]), value: lines[i + 1]! });
  return out;
}

/** Layer names in the LAYER table. */
function layerTableNames(dxf: string): string[] {
  const all = groups(dxf);
  const names: string[] = [];
  for (let i = 0; i < all.length; i++) {
    if (all[i]!.code === 0 && all[i]!.value === 'LAYER') {
      const name = all.slice(i).find((g) => g.code === 2)!;
      names.push(name.value);
    }
  }
  return names;
}

describe('PDF', () => {
  const pdf = renderCadPdf(drawing([rect, circle, line, dimension, note], { widthMm: 254, heightMm: 127 }));

  it('is a one-page PDF at the sheet size (254 × 127 mm = 720 × 360 pt)', () => {
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('/MediaBox [0 0 720 360]');
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('has a cross-reference table whose offsets land on each object', () => {
    const table = pdf.slice(pdf.indexOf('xref\n'));
    const offsets = [...table.matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
    expect(offsets).toHaveLength(5);
    offsets.forEach((offset, index) => expect(pdf.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(`${index + 1} 0 obj`));
    expect(Number(/startxref\n(\d+)/.exec(pdf)![1])).toBe(pdf.indexOf('xref\n'));
  });

  it('declares the stream length it actually has', () => {
    const declared = Number(/\/Length (\d+)/.exec(pdf)![1]);
    const body = pdf.slice(pdf.indexOf('stream\n') + 7, pdf.indexOf('\nendstream'));
    expect(body.length).toBe(declared);
  });

  it('escapes parentheses in text and keeps the file ASCII', () => {
    expect(pdf).toContain('(Plate \\(A\\))');
    const unicode = renderCadPdf(drawing([{ ...note, text: 'Platte é 板' }]));
    expect(/^[\x00-\x7f]*$/.test(unicode)).toBe(true);
  });
});

describe('SVG', () => {
  it('is in millimetres with a matching viewBox and escapes text', () => {
    const svg = renderCadSvg(drawing([{ ...note, text: 'a<b' }]), PAPER);
    expect(svg).toContain('width="200mm" height="100mm" viewBox="0 0 200 100"');
    expect(svg).toContain('a&lt;b');
  });
});

describe('plates (STL / STEP)', () => {
  const state = drawing([rect, circle, line, note]);

  it('extrudes closed shapes only, into closed solids with outward normals', () => {
    const mesh = cadToMesh(state, 2);
    const plate = meshVolume(cadToMesh(drawing([rect]), 2));
    expect(plate).toBeCloseTo(100 * 60 * 2, 3);
    // 32-gon area = ½·n·r²·sin(2π/n), times the thickness.
    expect(meshVolume(cadToMesh(drawing([circle]), 2))).toBeCloseTo(0.5 * 32 * 14 * 14 * Math.sin((2 * Math.PI) / 32) * 2, 3);
    expect(mesh.triangles.length).toBe(cadToMesh(drawing([rect]), 2).triangles.length + cadToMesh(drawing([circle]), 2).triangles.length);
  });

  it('does not mirror the part: a shape near the top of the sheet is near the top of the solid', () => {
    const top = cadToMesh(drawing([{ id: 'a', layer: '0', kind: 'rect', x: 0, y: 0, width: 10, height: 10 }]));
    expect(Math.min(...top.vertices.map((vertex) => vertex[1]))).toBe(90);
  });

  it('winds a clockwise polyline the same as a counter-clockwise one', () => {
    const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const ccw = cadToMesh(drawing([{ id: 'p', layer: '0', kind: 'polyline', points, closed: true }]));
    const cw = cadToMesh(drawing([{ id: 'q', layer: '0', kind: 'polyline', points: [...points].reverse(), closed: true }]));
    expect(meshVolume(ccw)).toBeGreaterThan(0);
    expect(meshVolume(cw)).toBeCloseTo(meshVolume(ccw), 6);
  });

  it('writes an STL the canvas reader parses back to the same triangles', () => {
    const mesh = cadToMesh(drawing([rect]));
    expect(parseAsciiStl(meshToStlAscii(mesh, 'my plate!'))).toHaveLength(mesh.triangles.length);
    expect(meshToStlAscii(mesh, 'my plate!').startsWith('solid my_plate')).toBe(true);
  });

  it('writes a STEP file with one faceted solid', () => {
    const step = CAD_EXPORT_FORMATS.step.render(state, "it's a plate", PAPER);
    expect(step).toContain('ISO-10303-21;');
    expect(step).toContain("FILE_NAME('it''s a plate'");
    expect(step.match(/=FACETED_BREP\(/g)).toHaveLength(1);
    expect(step.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true);
  });
});

describe('export facade', () => {
  it('names files from the title and falls back when it is empty', () => {
    expect(cadExportFileName('Floor Plan 1', 'dxf')).toBe('floor-plan-1.dxf');
    expect(cadExportFileName('', 'pdf')).toBe('drawing.pdf');
  });

  it('builds every format with its own MIME type', () => {
    const mimes = CAD_EXPORT_ORDER.map((format) => buildCadExport(drawing([rect]), format, 'part', PAPER).mimeType);
    expect(mimes).toEqual(['image/svg+xml', 'application/dxf', 'application/pdf', 'model/stl', 'model/step']);
  });
});

describe('drawing tools', () => {
  const pen = { layer: '0' };

  it('turns a drag into the shape the tool draws, normalising a backwards rectangle', () => {
    expect(shapeFromDrag('rect', { x: 50, y: 40 }, { x: 10, y: 10 }, pen, 'a')).toEqual({ id: 'a', layer: '0', kind: 'rect', x: 10, y: 10, width: 40, height: 30 });
    expect(shapeFromDrag('circle', { x: 0, y: 0 }, { x: 3, y: 4 }, pen, 'b')).toMatchObject({ kind: 'circle', cx: 0, cy: 0, radius: 5 });
    expect(shapeFromDrag('line', { x: 0, y: 0 }, { x: 3, y: 4 }, { layer: 'walls', color: '#ff0000' }, 'c')).toMatchObject({ kind: 'line', layer: 'walls', color: '#ff0000' });
    expect(shapeFromDrag('dimension', { x: 0, y: 0 }, { x: 30, y: 0 }, pen, 'd')).toMatchObject({ kind: 'dimension', offsetMm: 10 });
  });

  it('treats a stray tap as no shape', () => {
    for (const tool of ['line', 'rect', 'circle', 'dimension'] as const) {
      expect(shapeFromDrag(tool, { x: 5, y: 5 }, { x: 5.1, y: 5.1 }, pen)).toBeNull();
    }
  });

  it('snaps to the grid and keeps points on the sheet', () => {
    const state = drawing([], { grid: { visibleSpacingMm: 10, snapSpacingMm: 5, showGrid: true, snapEnabled: true } });
    expect(snapPoint(state, { x: 12, y: 18 })).toEqual({ x: 10, y: 20 });
    expect(snapPoint(state, { x: -40, y: 900 })).toEqual({ x: 0, y: 100 });
    expect(snapPoint({ ...state, grid: { ...state.grid, snapEnabled: false } }, { x: 12.3, y: 18.7 })).toEqual({ x: 12.3, y: 18.7 });
  });
});

describe('templates', () => {
  it('seeds the sheet and grid of a known template and falls back for an unknown one', () => {
    expect(seedCadFromTemplate('cad-floor-plan', INK)).toMatchObject({ widthMm: 594, heightMm: 420, grid: { visibleSpacingMm: 100, snapSpacingMm: 10, showGrid: true } });
    expect(seedCadFromTemplate('nope', INK)).toMatchObject({ widthMm: 420, heightMm: 297 });
    expect(seedCadFromTemplate(undefined, INK)).toMatchObject({ widthMm: 420 });
    expect(cadTemplatePreset('cad-blueprint')?.heightMm).toBe(594);
  });
});
