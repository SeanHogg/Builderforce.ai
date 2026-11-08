import { describe, expect, it } from 'vitest';
import { meshToStep } from './meshStep';
import type { TriMesh } from './triMesh';

/** A tetrahedron with one DUPLICATED vertex (index 4 repeats index 0) to prove points are shared. */
const tetra: TriMesh = {
  vertices: [[0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 10], [0, 0, 0]],
  triangles: [[0, 2, 1], [0, 1, 3], [1, 2, 3], [4, 3, 2]],
};

// ---- a minimal ISO 10303-21 tokenizer + parser (enough to check structure) ----

type Token = { kind: 'str' | 'ref' | 'enum' | 'num' | 'word' | 'punct'; text: string };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === "'") {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "'" && source[j + 1] === "'") { j += 2; continue; }
        if (source[j] === "'") break;
        j++;
      }
      if (j >= source.length) throw new Error('unterminated string');
      tokens.push({ kind: 'str', text: source.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    if (ch === '#') { const m = /^#\d+/.exec(source.slice(i))!; tokens.push({ kind: 'ref', text: m[0] }); i += m[0].length; continue; }
    if (ch === '.') {
      const m = /^\.[A-Z_]+\./.exec(source.slice(i));
      if (m) { tokens.push({ kind: 'enum', text: m[0] }); i += m[0].length; continue; }
    }
    const num = /^[-+]?\d+\.?\d*(?:[eE][-+]?\d+)?/.exec(source.slice(i));
    if (num) { tokens.push({ kind: 'num', text: num[0] }); i += num[0].length; continue; }
    const word = /^[A-Z][A-Z0-9_-]*/.exec(source.slice(i));
    if (word) { tokens.push({ kind: 'word', text: word[0] }); i += word[0].length; continue; }
    if ('(),=;$*'.includes(ch)) { tokens.push({ kind: 'punct', text: ch }); i++; continue; }
    throw new Error(`unexpected character ${JSON.stringify(ch)} at ${i}`);
  }
  return tokens;
}

interface Entity { name: string; refs: string[] }
interface Instance { id: string; entities: Entity[] }

function parseData(source: string): Instance[] {
  const data = /\nDATA;\n([\s\S]*?)\nENDSEC;\nEND-ISO-10303-21;\s*$/.exec(source);
  if (!data) throw new Error('no DATA section');
  const tokens = tokenize(data[1]!);
  let at = 0;
  const peek = (): Token | undefined => tokens[at];
  const take = (text?: string): Token => {
    const token = tokens[at++];
    if (!token || (text !== undefined && token.text !== text)) throw new Error(`expected ${text ?? 'token'} but found ${token?.text}`);
    return token;
  };
  // parameter := scalar | TYPED(parameter,…) | (parameter,…)   — refs are collected into `refs`.
  const parameter = (refs: string[]): void => {
    const token = take();
    if (token.kind === 'ref') refs.push(token.text);
    else if (token.kind === 'word') { if (peek()?.text === '(') parameters(refs); }
    else if (token.text === '(') { at--; parameters(refs); }
  };
  const parameters = (refs: string[]): void => {
    take('(');
    if (peek()?.text !== ')') {
      parameter(refs);
      while (peek()?.text === ',') { take(','); parameter(refs); }
    }
    take(')');
  };
  const entity = (): Entity => {
    const name = take();
    if (name.kind !== 'word') throw new Error(`expected entity name, found ${name.text}`);
    const refs: string[] = [];
    parameters(refs);
    return { name: name.text, refs };
  };
  const instances: Instance[] = [];
  while (at < tokens.length) {
    const id = take();
    if (id.kind !== 'ref') throw new Error(`expected #id, found ${id.text}`);
    take('=');
    const entities: Entity[] = [];
    if (peek()?.text === '(') {
      take('(');
      while (peek()?.text !== ')') entities.push(entity());
      take(')');
    } else entities.push(entity());
    take(';');
    instances.push({ id: id.text, entities });
  }
  return instances;
}

const ALLOWED = new Set([
  'APPLICATION_CONTEXT', 'APPLICATION_PROTOCOL_DEFINITION', 'PRODUCT_CONTEXT', 'PRODUCT', 'PRODUCT_DEFINITION_FORMATION',
  'PRODUCT_DEFINITION_CONTEXT', 'PRODUCT_DEFINITION', 'PRODUCT_DEFINITION_SHAPE', 'SHAPE_DEFINITION_REPRESENTATION',
  'FACETED_BREP_SHAPE_REPRESENTATION', 'GEOMETRIC_REPRESENTATION_CONTEXT', 'GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT',
  'GLOBAL_UNIT_ASSIGNED_CONTEXT', 'REPRESENTATION_CONTEXT', 'LENGTH_UNIT', 'PLANE_ANGLE_UNIT', 'SOLID_ANGLE_UNIT', 'NAMED_UNIT',
  'SI_UNIT', 'UNCERTAINTY_MEASURE_WITH_UNIT', 'CARTESIAN_POINT', 'DIRECTION', 'AXIS2_PLACEMENT_3D', 'POLY_LOOP',
  'FACE_OUTER_BOUND', 'FACE', 'CLOSED_SHELL', 'FACETED_BREP',
]);

const names = (instances: Instance[], name: string): Instance[] => instances.filter((instance) => instance.entities.some((entity) => entity.name === name));

describe('meshToStep', () => {
  const step = meshToStep(tetra, "Wedge's part", '2026-11-08T10:11:12.345Z');
  const instances = parseData(step);

  it('writes an AP214 header with an ISO 8601 timestamp and no milliseconds', () => {
    expect(step.startsWith('ISO-10303-21;\nHEADER;\n')).toBe(true);
    expect(step).toContain("FILE_DESCRIPTION(('Wedge''s part'),'2;1');");
    expect(step).toContain("FILE_NAME('Wedge''s part','2026-11-08T10:11:12',");
    expect(step).toContain("FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));");
    expect(step.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true);
  });

  it('parses as balanced Part 21 and every #ref resolves to a defined, unique instance', () => {
    const ids = instances.map((instance) => instance.id);
    expect(new Set(ids).size).toBe(ids.length);
    const known = new Set(ids);
    for (const instance of instances) for (const entity of instance.entities) for (const ref of entity.refs) expect(known.has(ref), `${instance.id} -> ${ref}`).toBe(true);
  });

  it('uses only entity names from the AP214 faceted B-rep subset', () => {
    for (const instance of instances) for (const entity of instance.entities) expect(ALLOWED.has(entity.name), entity.name).toBe(true);
  });

  it('has the full product chain ending in a faceted B-rep shape representation', () => {
    for (const name of ['APPLICATION_CONTEXT', 'PRODUCT_CONTEXT', 'PRODUCT', 'PRODUCT_DEFINITION_FORMATION', 'PRODUCT_DEFINITION_CONTEXT', 'PRODUCT_DEFINITION', 'PRODUCT_DEFINITION_SHAPE', 'SHAPE_DEFINITION_REPRESENTATION', 'FACETED_BREP_SHAPE_REPRESENTATION']) {
      expect(names(instances, name), name).toHaveLength(1);
    }
    const sdr = names(instances, 'SHAPE_DEFINITION_REPRESENTATION')[0]!;
    const shape = names(instances, 'PRODUCT_DEFINITION_SHAPE')[0]!;
    const rep = names(instances, 'FACETED_BREP_SHAPE_REPRESENTATION')[0]!;
    expect(sdr.entities[0]!.refs).toEqual([shape.id, rep.id]);
  });

  it('writes the context and the units as complex instances', () => {
    expect(step).toMatch(/=\(GEOMETRIC_REPRESENTATION_CONTEXT\(3\) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT\(\(#\d+\)\) GLOBAL_UNIT_ASSIGNED_CONTEXT\(\(#\d+,#\d+,#\d+\)\) REPRESENTATION_CONTEXT\('',''\)\);/);
    expect(step).toContain('=(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.));');
    expect(step).toContain('=(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.));');
    expect(step).toContain('=(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT());');
  });

  it('builds FACETED_BREP -> CLOSED_SHELL -> FACE -> FACE_OUTER_BOUND -> POLY_LOOP -> shared points', () => {
    const byId = new Map(instances.map((instance) => [instance.id, instance]));
    const nameOf = (id: string) => byId.get(id)!.entities[0]!.name;
    const brep = names(instances, 'FACETED_BREP')[0]!;
    const shell = byId.get(brep.entities[0]!.refs[0]!)!;
    expect(shell.entities[0]!.name).toBe('CLOSED_SHELL');
    expect(shell.entities[0]!.refs).toHaveLength(4);
    const used = new Set<string>();
    for (const faceId of shell.entities[0]!.refs) {
      expect(nameOf(faceId)).toBe('FACE');
      const bound = byId.get(byId.get(faceId)!.entities[0]!.refs[0]!)!;
      expect(bound.entities[0]!.name).toBe('FACE_OUTER_BOUND');
      expect(step).toContain(`${bound.id}=FACE_OUTER_BOUND('',`);
      const loop = byId.get(bound.entities[0]!.refs[0]!)!;
      expect(loop.entities[0]!.name).toBe('POLY_LOOP');
      expect(new Set(loop.entities[0]!.refs).size).toBe(3);
      for (const point of loop.entities[0]!.refs) { expect(nameOf(point)).toBe('CARTESIAN_POINT'); used.add(point); }
    }
    // 5 mesh vertices but vertex 4 repeats vertex 0: 4 shared points, plus the placement origin.
    expect(used.size).toBe(4);
    expect(names(instances, 'CARTESIAN_POINT')).toHaveLength(5);
  });

  it('skips a collapsed triangle rather than writing an invalid loop', () => {
    const flat: TriMesh = { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], triangles: [[0, 1, 2], [0, 0, 1]] };
    expect(names(parseData(meshToStep(flat)), 'POLY_LOOP')).toHaveLength(1);
  });

  it('still writes a valid, brep-free file for an empty mesh', () => {
    const empty = parseData(meshToStep({ vertices: [], triangles: [] }));
    expect(names(empty, 'FACETED_BREP')).toHaveLength(0);
    expect(names(empty, 'CLOSED_SHELL')).toHaveLength(0);
    expect(names(empty, 'FACETED_BREP_SHAPE_REPRESENTATION')).toHaveLength(1);
  });

  it('declares millimetres and escapes backslashes and non-ASCII in names', () => {
    expect(meshToStep(tetra, 'a\\b 板')).toContain("FILE_NAME('a\\\\b ?'");
  });
});
