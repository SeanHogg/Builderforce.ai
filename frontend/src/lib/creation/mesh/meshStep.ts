import type { TriMesh } from './triMesh';

/**
 * A STEP (ISO 10303-21, AP214 `AUTOMOTIVE_DESIGN`) file holding the mesh as ONE faceted
 * B-rep solid.
 *
 * What this is and is not: every triangle becomes a planar FACE (one outer POLY_LOOP
 * bound) of a CLOSED_SHELL inside a FACETED_BREP, so the file opens in STEP readers as a
 * solid but carries no analytic surfaces — a cylinder arrives as facets, not as a
 * cylinder. True analytic STEP needs a B-rep kernel, and writing one by guess would
 * describe a shape the model does not have.
 *
 * Units: {@link TriMesh} coordinates are ALWAYS millimetres (`CadState` stores the sheet
 * in `widthMm`/`heightMm`; its `unit` only changes how lengths are displayed), so the
 * file declares `SI_UNIT(.MILLI.,.METRE.)` and no per-unit conversion is needed.
 *
 * The product chain (APPLICATION_CONTEXT → PRODUCT → PRODUCT_DEFINITION →
 * PRODUCT_DEFINITION_SHAPE → SHAPE_DEFINITION_REPRESENTATION) is what lets a CAD system
 * import the geometry as a part rather than reject a bare representation.
 */
function fixed(value: number): string {
  return Number.isFinite(value) ? value.toFixed(6) : '0.000000';
}

/** Part 21 string: quotes doubled, anything outside printable ASCII replaced. */
function stepString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/[^\x20-\x7e]/g, '?');
}

/** ISO 8601 `YYYY-MM-DDThh:mm:ss` — no milliseconds, no zone designator. */
function timestamp(value: string): string {
  const parsed = new Date(value);
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return date.toISOString().replace(/\.\d{3}Z$/, '');
}

export function meshToStep(mesh: TriMesh, name = 'model', createdAt = new Date().toISOString()): string {
  const label = stepString(name);
  const header = [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('${label}'),'2;1');`,
    `FILE_NAME('${label}','${timestamp(createdAt)}',('Builderforce'),('Builderforce'),'Builderforce','Builderforce','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));",
    'ENDSEC;',
    'DATA;',
  ];
  let id = 0;
  const next = (): number => { id += 1; return id; };
  const data: string[] = [];
  const add = (entity: string): number => { const n = next(); data.push(`#${n}=${entity};`); return n; };

  // Product chain.
  const application = add("APPLICATION_CONTEXT('automotive design')");
  add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${application})`);
  const productContext = add(`PRODUCT_CONTEXT('',#${application},'mechanical')`);
  const product = add(`PRODUCT('${label}','${label}','',(#${productContext}))`);
  const formation = add(`PRODUCT_DEFINITION_FORMATION('','',#${product})`);
  const definitionContext = add(`PRODUCT_DEFINITION_CONTEXT('part definition',#${application},'design')`);
  const definition = add(`PRODUCT_DEFINITION('design','',#${formation},#${definitionContext})`);
  const definitionShape = add(`PRODUCT_DEFINITION_SHAPE('','',#${definition})`);
  const shapeDefinition = next(); // SHAPE_DEFINITION_REPRESENTATION is written once the representation id is known.
  data.push('');

  // Units and the representation context (complex instances).
  const length = add('(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))');
  const angle = add('(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.))');
  const solid = add('(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT())');
  const uncertainty = add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.001),#${length},'distance_accuracy_value','confusion accuracy')`);
  const context = add(
    `(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${uncertainty})) GLOBAL_UNIT_ASSIGNED_CONTEXT((#${length},#${angle},#${solid})) REPRESENTATION_CONTEXT('',''))`,
  );

  // World placement.
  const origin = add("CARTESIAN_POINT('',(0.,0.,0.))");
  const axisZ = add("DIRECTION('',(0.,0.,1.))");
  const axisX = add("DIRECTION('',(1.,0.,0.))");
  const placement = add(`AXIS2_PLACEMENT_3D('',#${origin},#${axisZ},#${axisX})`);
  const items = [placement];

  // Geometry: points are shared by coordinates, so a vertex used by many triangles — or
  // duplicated in the mesh — is ONE CARTESIAN_POINT.
  const pointIds = new Map<string, number>();
  const pointFor = (index: number): number => {
    const vertex = mesh.vertices[index] ?? [0, 0, 0];
    const key = `${fixed(vertex[0])},${fixed(vertex[1])},${fixed(vertex[2])}`;
    let point = pointIds.get(key);
    if (point === undefined) {
      point = add(`CARTESIAN_POINT('',(${key}))`);
      pointIds.set(key, point);
    }
    return point;
  };
  const faces: number[] = [];
  for (const [a, b, c] of mesh.triangles) {
    const [pa, pb, pc] = [pointFor(a), pointFor(b), pointFor(c)];
    if (pa === pb || pb === pc || pa === pc) continue; // a collapsed triangle has no area and no valid loop
    const loop = add(`POLY_LOOP('',(#${pa},#${pb},#${pc}))`);
    const bound = add(`FACE_OUTER_BOUND('',#${loop},.T.)`);
    faces.push(add(`FACE('',(#${bound}))`));
  }
  if (faces.length) {
    const shell = add(`CLOSED_SHELL('',(${faces.map((face) => `#${face}`).join(',')}))`);
    items.push(add(`FACETED_BREP('',#${shell})`));
  }

  const representation = add(`FACETED_BREP_SHAPE_REPRESENTATION('',(${items.map((item) => `#${item}`).join(',')}),#${context})`);
  data[data.indexOf('')] = `#${shapeDefinition}=SHAPE_DEFINITION_REPRESENTATION(#${definitionShape},#${representation});`;

  return [...header, ...data, 'ENDSEC;', 'END-ISO-10303-21;'].join('\n');
}
