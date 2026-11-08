import { dimensionGeometry, rectOutline, visibleShapes, type Point } from './cadGeometry';
import type { CadShape, CadState } from './cadState';

/**
 * The drawing as an ASCII DXF (AutoCAD R2000, `AC1015`).
 *
 * R2000 rather than R12 because the polylines are `LWPOLYLINE`, an R14+ entity; claiming
 * R12 in the header while writing it is the kind of file strict readers refuse. Every
 * CAD package that reads DXF at all reads this subset: LINE, LWPOLYLINE, CIRCLE, TEXT.
 *
 * What is deliberately not here: a true DIMENSION entity (a dimension exports as its
 * lines and a text label, so it displays right but will not re-measure when the
 * geometry is edited in another package), blocks, splines.
 *
 * DXF is Y-up and the sheet is Y-down, so Y is flipped about the sheet height — the
 * drawing arrives the right way round rather than mirrored.
 */

const INSUNITS: Record<CadState['unit'], number> = { in: 1, ft: 2, mm: 4, cm: 5, m: 6 };
/** AutoCAD's colour index for "by layer". */
const BY_LAYER = 256;

/** A group-code writer over one output buffer. */
type Pair = (code: number, value: string | number) => void;

function pairWriter(out: string[]): Pair {
  return (code, value) => {
    // Integers stay integers: group codes like 70 (flags) and 90 (counts) are integer groups.
    out.push(String(code), typeof value === 'number' ? (!Number.isFinite(value) ? '0' : Number.isInteger(value) ? String(value) : value.toFixed(6)) : value);
  };
}

/** Free text for a DXF string group: one line, no control characters. */
function dxfText(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]+/g, ' ').trim();
}

/** Layer name → DXF layer name. Sanitised names are unique (DXF compares them case-insensitively). */
function layerNames(layers: readonly { name: string }[]): Map<string, string> {
  const taken = new Set<string>();
  const names = new Map<string, string>();
  for (const { name } of layers) {
    if (names.has(name)) continue;
    const base = dxfName(name);
    let candidate = base;
    for (let n = 2; taken.has(candidate.toUpperCase()); n++) candidate = `${base}_${n}`;
    taken.add(candidate.toUpperCase());
    names.set(name, candidate);
  }
  return names;
}

export function renderCadDxf(state: CadState): string {
  let handleSeed = 1;
  const handle = (): string => (handleSeed++).toString(16).toUpperCase();
  const flipY = (y: number): number => state.heightMm - y;

  const names = layerNames(state.layers);
  const layerOf = (shape: CadShape): string => names.get(shape.layer) ?? '0';

  // Fixed owners every record points at (code 330).
  const modelRecord = handle();
  const paperRecord = handle();
  const rootDictionary = handle();
  const groupDictionary = handle();

  const header: string[] = [];
  const tables: string[] = [];
  const blocks: string[] = [];
  const entities: string[] = [];
  const objects: string[] = [];
  const h = pairWriter(header);
  const t = pairWriter(tables);
  const b = pairWriter(blocks);
  const p = pairWriter(entities);
  const o = pairWriter(objects);

  // TABLES: each table has a handle; each record's 330 points at its table.
  const table = (name: string, count: number, records: (owner: string) => void): void => {
    const owner = handle();
    t(0, 'TABLE'); t(2, name); t(5, owner); t(330, 0); t(100, 'AcDbSymbolTable'); t(70, count);
    records(owner);
    t(0, 'ENDTAB');
  };
  const record = (kind: string, owner: string, specific: string, assignedHandle = handle()): void => {
    t(0, kind); t(5, assignedHandle); t(330, owner); t(100, 'AcDbSymbolTableRecord'); t(100, specific);
  };

  table('VPORT', 1, (owner) => {
    record('VPORT', owner, 'AcDbViewportTableRecord');
    t(2, '*ACTIVE'); t(70, 0); t(10, 0); t(20, 0); t(11, 1); t(21, 1); t(12, state.widthMm / 2); t(22, state.heightMm / 2);
    t(13, 0); t(23, 0); t(14, 10); t(24, 10); t(15, 10); t(25, 10); t(16, 0); t(26, 0); t(36, 1); t(17, 0); t(27, 0); t(37, 0);
    t(40, Math.max(state.heightMm, 1)); t(41, 1.5); t(42, 50); t(43, 0); t(44, 0); t(50, 0); t(51, 0);
    t(71, 0); t(72, 100); t(73, 1); t(74, 3); t(75, 0); t(76, 0); t(77, 0); t(78, 0);
  });
  table('LTYPE', 3, (owner) => {
    for (const [name, description] of [['ByBlock', ''], ['ByLayer', ''], ['CONTINUOUS', 'Solid line']] as const) {
      record('LTYPE', owner, 'AcDbLinetypeTableRecord');
      t(2, name); t(70, 0); t(3, description); t(72, 65); t(73, 0); t(40, 0);
    }
  });
  const layerList = [...names.entries()];
  const hasZero = layerList.some(([, dxf]) => dxf === '0');
  table('LAYER', layerList.length + (hasZero ? 0 : 1), (owner) => {
    if (!hasZero) {
      record('LAYER', owner, 'AcDbLayerTableRecord');
      t(2, '0'); t(70, 0); t(62, 7); t(6, 'CONTINUOUS');
    }
    for (const [original, dxf] of layerList) {
      const layer = state.layers.find((candidate) => candidate.name === original)!;
      record('LAYER', owner, 'AcDbLayerTableRecord');
      t(2, dxf); t(70, 0); t(62, colorIndex(layer.color) ?? 7); t(6, 'CONTINUOUS');
    }
  });
  table('STYLE', 1, (owner) => {
    record('STYLE', owner, 'AcDbTextStyleTableRecord');
    t(2, 'STANDARD'); t(70, 0); t(40, 0); t(41, 1); t(50, 0); t(71, 0); t(42, 2.5); t(3, 'txt'); t(4, '');
  });
  table('APPID', 1, (owner) => {
    record('APPID', owner, 'AcDbRegAppTableRecord');
    t(2, 'ACAD'); t(70, 0);
  });
  table('BLOCK_RECORD', 2, (owner) => {
    record('BLOCK_RECORD', owner, 'AcDbBlockTableRecord', modelRecord); t(2, '*Model_Space');
    record('BLOCK_RECORD', owner, 'AcDbBlockTableRecord', paperRecord); t(2, '*Paper_Space');
  });

  // BLOCKS: the two block definitions the BLOCK_RECORDs name.
  for (const [name, owner] of [['*Model_Space', modelRecord], ['*Paper_Space', paperRecord]] as const) {
    b(0, 'BLOCK'); b(5, handle()); b(330, owner); b(100, 'AcDbEntity'); b(8, '0'); b(100, 'AcDbBlockBegin');
    b(2, name); b(70, 0); b(10, 0); b(20, 0); b(30, 0); b(3, name); b(1, '');
    b(0, 'ENDBLK'); b(5, handle()); b(330, owner); b(100, 'AcDbEntity'); b(8, '0'); b(100, 'AcDbBlockEnd');
  }

  // ENTITIES: every one carries its handle, its owner and the AcDbEntity + subclass markers.
  const head = (entity: string, subclass: string, shape: CadShape): void => {
    p(0, entity); p(5, handle()); p(330, modelRecord); p(100, 'AcDbEntity');
    p(8, layerOf(shape)); p(62, shape.color ? colorIndex(shape.color) ?? BY_LAYER : BY_LAYER); p(100, subclass);
  };
  const line = (shape: CadShape, a: Point, c: Point): void => {
    head('LINE', 'AcDbLine', shape);
    p(10, a.x); p(20, flipY(a.y)); p(30, 0);
    p(11, c.x); p(21, flipY(c.y)); p(31, 0);
  };
  const polyline = (shape: CadShape, points: readonly Point[], closed: boolean): void => {
    head('LWPOLYLINE', 'AcDbPolyline', shape); p(90, points.length); p(70, closed ? 1 : 0);
    for (const point of points) { p(10, point.x); p(20, flipY(point.y)); }
  };
  const label = (shape: CadShape, at: Point, heightMm: number, content: string, rotation = 0): void => {
    head('TEXT', 'AcDbText', shape); p(10, at.x); p(20, flipY(at.y)); p(30, 0); p(40, heightMm); p(1, dxfText(content));
    if (rotation) p(50, rotation);
    p(100, 'AcDbText');
  };

  for (const shape of visibleShapes(state)) {
    switch (shape.kind) {
      case 'line': line(shape, { x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 }); break;
      case 'rect': polyline(shape, rectOutline(shape), true); break;
      case 'circle':
        head('CIRCLE', 'AcDbCircle', shape); p(10, shape.cx); p(20, flipY(shape.cy)); p(30, 0); p(40, shape.radius);
        break;
      case 'polyline': polyline(shape, shape.points, shape.closed === true); break;
      case 'dimension': {
        const geometry = dimensionGeometry(shape, state.unit);
        if (!geometry) break;
        for (const [from, to] of [geometry.line, ...geometry.extensions]) line(shape, from, to);
        label(shape, geometry.labelAt, 3, geometry.label);
        break;
      }
      case 'text': label(shape, { x: shape.x, y: shape.y }, shape.heightMm, shape.text, shape.rotation); break;
    }
  }

  // OBJECTS: the root dictionary (owner 0) and the ACAD_GROUP dictionary it names.
  o(0, 'DICTIONARY'); o(5, rootDictionary); o(330, 0); o(100, 'AcDbDictionary'); o(281, 1); o(3, 'ACAD_GROUP'); o(350, groupDictionary);
  o(0, 'DICTIONARY'); o(5, groupDictionary); o(330, rootDictionary); o(100, 'AcDbDictionary'); o(281, 1);

  // $HANDSEED is the next free handle, so it is written once every handle has been issued.
  h(9, '$ACADVER'); h(1, 'AC1015');
  h(9, '$HANDSEED'); h(5, handleSeed.toString(16).toUpperCase());
  h(9, '$INSUNITS'); h(70, INSUNITS[state.unit]);

  const out: string[] = [];
  const w = pairWriter(out);
  const section = (name: string, body: readonly string[]): void => {
    w(0, 'SECTION'); w(2, name);
    out.push(...body);
    w(0, 'ENDSEC');
  };
  section('HEADER', header);
  section('TABLES', tables);
  section('BLOCKS', blocks);
  section('ENTITIES', entities);
  section('OBJECTS', objects);
  w(0, 'EOF');
  // Group-code pairs are CRLF-terminated in the spec; every reader also takes LF.
  return `${out.join('\r\n')}\r\n`;
}

/** DXF layer names cannot hold these characters (or control characters), nor be empty. */
function dxfName(name: string): string {
  return name.replace(/[<>/\\":;?*|=`\u0000-\u001F\u007F]/g, '_') || '0';
}

const INDEX_COLORS: ReadonlyArray<readonly [number, readonly [number, number, number]]> = [
  [1, [255, 0, 0]], [2, [255, 255, 0]], [3, [0, 255, 0]], [4, [0, 255, 255]], [5, [0, 0, 255]], [6, [255, 0, 255]], [7, [0, 0, 0]],
];

/** The nearest AutoCAD colour index, or null for a colour that is not `#rrggbb`. DXF 2000 has no RGB in this subset. */
export function colorIndex(hexColor: string): number | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hexColor);
  if (!match) return null;
  const value = parseInt(match[1]!, 16);
  const rgb = [(value >> 16) & 255, (value >> 8) & 255, value & 255] as const;
  // Index 7 is "white or black, whichever contrasts": near-white is mapped to it as well.
  if (rgb.every((channel) => channel > 200)) return 7;
  let best = 7;
  let bestDistance = Infinity;
  for (const [index, target] of INDEX_COLORS) {
    const distance = (rgb[0] - target[0]) ** 2 + (rgb[1] - target[1]) ** 2 + (rgb[2] - target[2]) ** 2;
    if (distance < bestDistance) { bestDistance = distance; best = index; }
  }
  return best;
}
