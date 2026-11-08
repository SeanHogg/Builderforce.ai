import { resolveExportColor } from '../exportColors';
/**
 * The state of a `model3d` object: a scene of solid primitives, edited and exported as
 * one part.
 *
 * Axes are the ones STL and STEP assume — millimetres, Z up. A box's `widthMm` runs
 * along X, `depthMm` along Y and `heightMm` along Z; a cylinder's axis is Z; an extrusion
 * is a profile in the XY plane pushed up `depthMm`. The 3D view rotates the whole scene
 * into the renderer's Y-up space once, so no entity carries two coordinate systems.
 *
 * Selection is the editor's, not the model's, and is not stored.
 */

export const MODEL3D_SCHEMA_VERSION = 1;

export interface V3 { x: number; y: number; z: number }
/** Quaternion as [x, y, z, w]. */
export type Quaternion = [number, number, number, number];
export type Model3dUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';
const UNITS: readonly Model3dUnit[] = ['mm', 'cm', 'm', 'in', 'ft'];

export interface Model3dMaterial {
  id: string;
  label: string;
  /** `#rrggbb`. */
  color: string;
  densityGCm3?: number;
}

interface EntityBase {
  id: string;
  /** Where the entity's origin sits. A box, cylinder and sphere are centred on it; an extrusion starts on it. */
  translate?: V3;
  rotate?: Quaternion;
  scale?: V3;
  materialId?: string;
}

export interface Model3dBox extends EntityBase { kind: 'box'; widthMm: number; depthMm: number; heightMm: number }
export interface Model3dCylinder extends EntityBase { kind: 'cylinder'; radiusMm: number; heightMm: number; segments?: number }
export interface Model3dSphere extends EntityBase { kind: 'sphere'; radiusMm: number; segments?: number }
export interface Model3dExtrusion extends EntityBase { kind: 'extrude'; profile: Array<{ x: number; y: number }>; depthMm: number }
export type BooleanOperation = 'union' | 'difference' | 'intersection';
/** A group of other entities combined by an operation. Its children are listed by id and are drawn through it, not on their own. */
export interface Model3dBoolean extends EntityBase { kind: 'boolean'; op: BooleanOperation; children: string[] }

export type Model3dEntity = Model3dBox | Model3dCylinder | Model3dSphere | Model3dExtrusion | Model3dBoolean;
export type Model3dEntityKind = Model3dEntity['kind'];

export interface Model3dState {
  schemaVersion: number;
  unit: Model3dUnit;
  /** The print bed / working envelope. It sizes the grid and the camera; it does not clip. */
  buildVolumeMm: V3;
  entities: Model3dEntity[];
  materials: Model3dMaterial[];
  defaultMaterialId: string;
}

export const DEFAULT_MATERIAL_ID = 'mat-default';

/** `materialColor` is the export palette's `material`, resolved by the caller. */
export function createBlankModel3dState(materialColor: string = resolveExportColor('material')): Model3dState {
  return {
    schemaVersion: MODEL3D_SCHEMA_VERSION,
    unit: 'mm',
    buildVolumeMm: { x: 220, y: 220, z: 250 },
    entities: [],
    materials: [{ id: DEFAULT_MATERIAL_ID, label: 'PLA', color: materialColor, densityGCm3: 1.24 }],
    defaultMaterialId: DEFAULT_MATERIAL_ID,
  };
}

/* ---------- reading what was stored ---------- */

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function vec(value: unknown): V3 | undefined {
  const raw = record(value);
  const [x, y, z] = [num(raw?.x), num(raw?.y), num(raw?.z)];
  return x === null || y === null || z === null ? undefined : { x, y, z };
}
function positive(value: unknown, fallback: number): number {
  const n = num(value);
  return n !== null && n > 0 ? n : fallback;
}
function segments(value: unknown): { segments?: number } {
  const n = num(value);
  return n !== null && n >= 3 && n <= 128 ? { segments: Math.round(n) } : {};
}

const MAX_ENTITIES = 500;
const MAX_PROFILE_POINTS = 500;

function entityFrom(value: unknown): Model3dEntity | null {
  const raw = record(value);
  const id = str(raw?.id);
  if (!raw || !id) return null;
  const rotate = Array.isArray(raw.rotate) && raw.rotate.length === 4 && raw.rotate.every((c) => num(c) !== null) ? raw.rotate as Quaternion : undefined;
  const base: EntityBase = {
    id,
    ...(vec(raw.translate) ? { translate: vec(raw.translate)! } : {}),
    ...(rotate ? { rotate } : {}),
    ...(vec(raw.scale) ? { scale: vec(raw.scale)! } : {}),
    ...(str(raw.materialId) ? { materialId: str(raw.materialId) } : {}),
  };
  switch (raw.kind) {
    case 'box':
      return { ...base, kind: 'box', widthMm: positive(raw.widthMm, 20), depthMm: positive(raw.depthMm, 20), heightMm: positive(raw.heightMm, 20) };
    case 'cylinder':
      return { ...base, kind: 'cylinder', radiusMm: positive(raw.radiusMm, 10), heightMm: positive(raw.heightMm, 30), ...segments(raw.segments) };
    case 'sphere':
      return { ...base, kind: 'sphere', radiusMm: positive(raw.radiusMm, 12), ...segments(raw.segments) };
    case 'extrude': {
      const profile = (Array.isArray(raw.profile) ? raw.profile : []).slice(0, MAX_PROFILE_POINTS).flatMap((point) => {
        const p = record(point);
        const [x, y] = [num(p?.x), num(p?.y)];
        return x === null || y === null ? [] : [{ x, y }];
      });
      return profile.length < 3 ? null : { ...base, kind: 'extrude', profile, depthMm: positive(raw.depthMm, 10) };
    }
    case 'boolean': {
      const op = raw.op === 'difference' || raw.op === 'intersection' ? raw.op : 'union';
      const children = (Array.isArray(raw.children) ? raw.children : []).filter((child): child is string => typeof child === 'string');
      return children.length < 2 ? null : { ...base, kind: 'boolean', op, children };
    }
    default:
      return null;
  }
}

/**
 * A stored `modelState` read back into a scene that is safe to draw and export.
 * Rebuilt rather than trusted — Brain, a collaborator or an older save wrote it. A
 * malformed entity is dropped, a boolean whose children no longer exist is dropped with
 * them, and anything unreadable yields an empty scene, never a throw.
 */
export function model3dStateFrom(value: unknown, materialColor: string = resolveExportColor('material')): Model3dState {
  const raw = record(value);
  const blank = createBlankModel3dState(materialColor);
  if (!raw) return blank;
  const materials = (Array.isArray(raw.materials) ? raw.materials : []).flatMap((entry): Model3dMaterial[] => {
    const material = record(entry);
    const id = str(material?.id);
    const color = str(material?.color);
    if (!material || !id || !/^#[0-9a-f]{6}$/i.test(color)) return [];
    const density = num(material.densityGCm3);
    return [{ id, label: str(material.label) || id, color, ...(density !== null && density > 0 ? { densityGCm3: density } : {}) }];
  });
  const usable = materials.length ? materials : blank.materials;
  const entities = (Array.isArray(raw.entities) ? raw.entities : []).slice(0, MAX_ENTITIES).flatMap((entry) => { const entity = entityFrom(entry); return entity ? [entity] : []; });
  const ids = new Set(entities.map((entity) => entity.id));
  const consistent = entities.filter((entity) => entity.kind !== 'boolean' || entity.children.every((child) => ids.has(child)));
  const build = vec(raw.buildVolumeMm);
  return {
    schemaVersion: MODEL3D_SCHEMA_VERSION,
    unit: UNITS.includes(raw.unit as Model3dUnit) ? raw.unit as Model3dUnit : 'mm',
    buildVolumeMm: build && build.x > 0 && build.y > 0 && build.z > 0 ? build : blank.buildVolumeMm,
    entities: consistent,
    materials: usable,
    defaultMaterialId: usable.some((material) => material.id === raw.defaultMaterialId) ? raw.defaultMaterialId as string : usable[0]!.id,
  };
}

/* ---------- edits: each returns the next state and leaves the input alone ---------- */

let entityCounter = 0;
/** A session-unique id. No crypto here: this module also runs in tests and workers. */
export function nextEntityId(prefix: string): string {
  entityCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${entityCounter.toString(36)}`;
}

/** Where a new primitive of height `heightMm` goes: the middle of the bed, resting on it. */
function restingAtBedCentre(state: Model3dState, heightMm: number): V3 {
  return { x: state.buildVolumeMm.x / 2, y: state.buildVolumeMm.y / 2, z: heightMm / 2 };
}

export function addBox(state: Model3dState, dims: Partial<{ widthMm: number; depthMm: number; heightMm: number }> = {}): { state: Model3dState; id: string } {
  const entity: Model3dBox = { id: nextEntityId('box'), kind: 'box', widthMm: dims.widthMm ?? 20, depthMm: dims.depthMm ?? 20, heightMm: dims.heightMm ?? 20 };
  entity.translate = restingAtBedCentre(state, entity.heightMm);
  return append(state, entity);
}

export function addCylinder(state: Model3dState, dims: Partial<{ radiusMm: number; heightMm: number }> = {}): { state: Model3dState; id: string } {
  const entity: Model3dCylinder = { id: nextEntityId('cyl'), kind: 'cylinder', radiusMm: dims.radiusMm ?? 10, heightMm: dims.heightMm ?? 30 };
  entity.translate = restingAtBedCentre(state, entity.heightMm);
  return append(state, entity);
}

export function addSphere(state: Model3dState, dims: Partial<{ radiusMm: number }> = {}): { state: Model3dState; id: string } {
  const entity: Model3dSphere = { id: nextEntityId('sph'), kind: 'sphere', radiusMm: dims.radiusMm ?? 12 };
  entity.translate = restingAtBedCentre(state, entity.radiusMm * 2);
  return append(state, entity);
}

/** Group entities under a boolean operation. The children are kept (feature removal keeps bodies, as modelling packages do). Needs at least two. */
export function addBooleanOp(state: Model3dState, op: BooleanOperation, childIds: readonly string[]): { state: Model3dState; id: string } {
  const children = childIds.filter((id, index) => childIds.indexOf(id) === index && state.entities.some((entity) => entity.id === id));
  if (children.length < 2) throw new Error(`addBooleanOp: need at least 2 existing children, got ${children.length}`);
  return append(state, { id: nextEntityId('bool'), kind: 'boolean', op, children });
}

/**
 * Delete entities. A boolean that loses a child goes with it (it would reference
 * nothing); a boolean deleted on its own leaves its children standing.
 */
export function deleteEntities(state: Model3dState, ids: readonly string[]): Model3dState {
  const doomed = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const entity of state.entities) {
      if (entity.kind === 'boolean' && !doomed.has(entity.id) && entity.children.some((child) => doomed.has(child))) { doomed.add(entity.id); grew = true; }
    }
  }
  return { ...state, entities: state.entities.filter((entity) => !doomed.has(entity.id)) };
}

export function updateEntity(state: Model3dState, id: string, patch: Partial<Model3dEntity>): Model3dState {
  return { ...state, entities: state.entities.map((entity) => (entity.id === id ? { ...entity, ...patch } as Model3dEntity : entity)) };
}

/** Ids of entities that are a child of some boolean — drawn through it, not on their own. */
export function ownedEntityIds(state: Model3dState): Set<string> {
  return new Set(state.entities.flatMap((entity) => (entity.kind === 'boolean' ? entity.children : [])));
}

export function materialColor(state: Model3dState, entity: Model3dEntity): string {
  const id = entity.materialId ?? state.defaultMaterialId;
  return (state.materials.find((material) => material.id === id) ?? state.materials[0]!).color;
}

function append(state: Model3dState, entity: Model3dEntity): { state: Model3dState; id: string } {
  return { state: { ...state, entities: [...state.entities, entity] }, id: entity.id };
}
