/**
 * THE `CanvasBoard` AGGREGATE ROOT.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 * `lib/canvas/boundedContexts.ts` has named `CanvasBoard` the aggregate root of
 * the canvas context since the context map shipped, and listed five invariants
 * that make an operation illegal. Until now those invariants were PROSE: nothing
 * imported them, nothing checked them, and every one of them was implicitly
 * re-decided inside an 11,000-line React component where a violation is
 * discovered by a user rather than by a test.
 *
 * PRD 22 §3.4 proposed `graph.ts` / `history.ts` / `selection.ts`. The context
 * map already rejected that as a split by TOPIC — three files, one implicit
 * aggregate, and the invariants still nowhere. So this module is organised the
 * other way round: it is the board, it owns the operations that produce or
 * consume a WHOLE board, and it is where an invariant is checked.
 *
 * ── THE ANTI-CORRUPTION BOUNDARY, AND WHY IT IS HERE ─────────────────────────
 * `boardFromSession` and `boardFromSnapshotGraph` are the two doors persistence
 * comes through, so they are where the canvas refuses to adopt the persistence
 * model. Concretely, invariant 1: both used to cast `object.kind as
 * CreationObjectKind` unchecked, which is the exact shape the invariant forbids
 * — a kind the contract does not declare became an object the board rendered as
 * a blank card, with no error anywhere. `isCreationObjectKind` is the contract's
 * own guard, so the rejection uses the same list the contract compiles from
 * rather than a second copy of it.
 */

import type { Edge } from '@xyflow/react';
import { isCreationObjectKind } from '@builderforce/creation-canvas-contract';
import { edgeVisuals, readConnectionStyle } from '@/lib/canvasConnectionStyle';
import { CANVAS_BOARD_INVARIANTS_BY_KEY, type CanvasBoardInvariantKey } from '@/lib/canvas/boundedContexts';
import type { CanvasObject, CanvasObjectData, CreationObjectKind } from './canvasObject';

/**
 * The board. Objects and the connections between them, and nothing else — a
 * viewport, a selection and a history are things somebody holds ABOUT a board,
 * not parts of it, which is why they are separate terms in the context map.
 */
export interface CanvasBoard {
  nodes: CanvasObject[];
  edges: Edge[];
}

/** What persistence hands back for one object. Deliberately loose: this is the
 *  shape at the boundary, before the board has decided it is admissible. */
export interface PersistedCanvasObject {
  id: string;
  kind: string;
  resourceType?: string | null;
  resourceId?: string | null;
  canvasData?: Record<string, unknown> | null;
  content?: Record<string, unknown> | null;
}

/** What persistence hands back for one connection. */
export interface PersistedCanvasConnection {
  id: string;
  sourceObjectId: string;
  targetObjectId: string;
  kind?: string;
  label?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface PersistedCanvasGraph {
  objects: readonly PersistedCanvasObject[];
  connections: readonly PersistedCanvasConnection[];
}

/**
 * An object persistence offered that the board refused, and why.
 *
 * Returned rather than thrown: one unknown kind in a session of two hundred
 * objects must not cost the user the other 199. The board drops the object and
 * SAYS SO, which is the difference between enforcing invariant 1 and silently
 * doing what the unchecked cast did.
 */
export interface RejectedCanvasObject {
  id: string;
  kind: string;
  reason: string;
}

export interface BoardFromPersistence {
  board: CanvasBoard;
  rejected: RejectedCanvasObject[];
}

/** `declaredKind`, at the only boundary that can violate it. */
function admissibleObject(object: PersistedCanvasObject): RejectedCanvasObject | null {
  if (isCreationObjectKind(object.kind)) return null;
  return { id: object.id, kind: String(object.kind), reason: CANVAS_BOARD_INVARIANTS_BY_KEY.declaredKind };
}

function objectFromPersisted(object: PersistedCanvasObject): CanvasObject {
  const canvasData = object.canvasData ?? {};
  const content = object.content ?? {};
  const width = Number(canvasData.w);
  const height = Number(canvasData.h);
  return {
    id: object.id,
    type: 'creation',
    position: { x: Number(canvasData.x ?? 0), y: Number(canvasData.y ?? 0) },
    draggable: content.placementLocked !== true,
    hidden: content.placementHidden === true,
    ...((width > 0 || height > 0) ? { style: { width: width || undefined, height: height || undefined } } : {}),
    data: {
      kind: object.kind as CreationObjectKind,
      title: object.kind,
      ...(object.resourceType && object.resourceId ? { resourceId: `${object.resourceType}:${object.resourceId}` } : {}),
      ...content,
    } as CanvasObjectData,
  };
}

function edgeFromPersisted(connection: PersistedCanvasConnection): Edge {
  const metadata = connection.metadata ?? {};
  // The two axes an edge carries, restored together. `kind` is what it MEANS (the board
  // computes the critical path and coverage from it); `connectionStyle` is how it is
  // DRAWN. Reading the style through `edgeVisuals` rather than restoring the stored
  // marker/dash directly is what keeps one translation from a style to its pixels — the
  // reload is the third caller of it, and the one whose disagreement would only ever be
  // noticed by the person reopening their own diagram.
  const style = readConnectionStyle(metadata.connectionStyle);
  return {
    id: connection.id,
    source: connection.sourceObjectId,
    target: connection.targetObjectId,
    ...edgeVisuals(style),
    // A board saved before styles existed carries only `rendererType`, and honouring it
    // keeps every edge on it looking exactly as it did.
    ...(typeof metadata.rendererType === 'string' && metadata.connectionStyle == null
      ? { type: metadata.rendererType }
      : {}),
    label: connection.label ?? undefined,
    animated: !!metadata.animated,
    data: { connectionKind: connection.kind || 'reference', connectionStyle: style },
  };
}

/**
 * A board from what persistence stored, with `declaredKind` and
 * `noDanglingConnection` enforced at the door.
 *
 * The second follows from the first and is the reason rejection had to be a
 * FILTER rather than a throw: dropping an object whose kind the contract does
 * not declare leaves every connection that named it pointing at nothing, so the
 * two have to be enforced in the same pass or the repair for one manufactures a
 * violation of the other.
 */
export function boardFromPersistedGraph(graph: PersistedCanvasGraph): BoardFromPersistence {
  const rejected: RejectedCanvasObject[] = [];
  const nodes: CanvasObject[] = [];
  for (const object of graph.objects) {
    const refusal = admissibleObject(object);
    if (refusal) { rejected.push(refusal); continue; }
    nodes.push(objectFromPersisted(object));
  }
  const edges = edgesWithinBoard(nodes, graph.connections.map(edgeFromPersisted));
  return { board: { nodes, edges }, rejected };
}

/**
 * Two boards, one of which is this browser's and wins.
 *
 * LOCAL LAST is the whole rule: a collaborator's snapshot is a base to fill gaps
 * from, never an overwrite of what the person in front of the screen is holding.
 * The other order silently discards an edit made in the second between a
 * snapshot being requested and arriving.
 */
export function mergeCollaboratorBoards(local: CanvasBoard, remote: CanvasBoard): CanvasBoard {
  const nodes = new Map(remote.nodes.map((node) => [node.id, node]));
  local.nodes.forEach((node) => nodes.set(node.id, node));
  const edges = new Map(remote.edges.map((edge) => [edge.id, edge]));
  local.edges.forEach((edge) => edges.set(edge.id, edge));
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/**
 * The object a point lands on, topmost first.
 *
 * What makes a stroke an annotation rather than a stray sketch: the mark belongs
 * to whatever is under the pen when it goes down. Later objects render above
 * earlier ones, so the list is walked backwards — the card a person can see is
 * the card they think they are drawing on.
 *
 * Takes a measurer rather than importing one: an object's drawn size is a
 * PRESENTATION fact (it depends on the renderer and, for auto-sized cards, on
 * the DOM), and the domain reaching for it is how a headless test of this
 * function ends up needing a browser.
 */
export function objectAtPoint(
  nodes: readonly CanvasObject[],
  point: { x: number; y: number },
  measure: (node: CanvasObject) => { width: number; height: number },
): CanvasObject | null {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]!;
    if (node.hidden) continue;
    const { width, height } = measure(node);
    if (point.x >= node.position.x && point.x <= node.position.x + width
      && point.y >= node.position.y && point.y <= node.position.y + height) return node;
  }
  return null;
}

/**
 * Connect a Brain object to the artifacts it was given as context.
 *
 * Idempotent on purpose — the same turn can resolve the same artifact twice, and
 * a second identical edge is a duplicate connection the user has to delete by
 * hand rather than a second fact about the board.
 */
export function associateBrainWithArtifacts(
  current: Edge[],
  brainId: string,
  artifactIds: Iterable<string>,
  label = 'Brain context',
): Edge[] {
  if (!brainId) return current;
  const next = [...current];
  for (const artifactId of artifactIds) {
    if (!artifactId || artifactId === brainId || next.some((edge) => edge.source === brainId && edge.target === artifactId)) continue;
    next.push({ id: crypto.randomUUID(), source: brainId, target: artifactId, type: 'smoothstep', label, data: { connectionKind: 'reference' } });
  }
  return next;
}

// ── Invariants, as something that runs ───────────────────────────────────────

export interface BoardInvariantViolation {
  /** The invariant, by key rather than by list position, so the message and the
   *  check cannot drift into two differently-worded statements of one rule. */
  invariant: CanvasBoardInvariantKey;
  statement: string;
  detail: string;
}

function violation(invariant: CanvasBoardInvariantKey, detail: string): BoardInvariantViolation {
  return { invariant, statement: CANVAS_BOARD_INVARIANTS_BY_KEY[invariant], detail };
}

/**
 * Every way this board currently breaks its own rules.
 *
 * Returns violations rather than throwing so a caller can decide: a test asserts
 * the list is empty, a boundary repairs what it can, and a dev build can log.
 *
 * Only the invariants a board can be checked against ON ITS OWN are here.
 * `selectionWithinBoard` needs a selection, which is a thing somebody holds
 * about a board rather than part of it — `selection.ts` owns that check.
 * `checkpointNamesRealState` and `singleLineOfHistory` are about a SEQUENCE of
 * boards and belong with the history module that owns `Checkpoint` and `Branch`.
 * `derivationNamesItsSource` needs the registry's view of which kinds derive,
 * which the domain does not import.
 */
export function boardInvariantViolations(board: CanvasBoard): BoardInvariantViolation[] {
  const violations: BoardInvariantViolation[] = [];

  for (const node of board.nodes) {
    if (!isCreationObjectKind(node.data?.kind)) {
      violations.push(violation('declaredKind', `object ${node.id} has kind ${JSON.stringify(node.data?.kind)}`));
    }
  }

  const seen = new Set<string>();
  for (const node of board.nodes) {
    if (seen.has(node.id)) violations.push(violation('uniqueObjectIds', `object id ${node.id} appears more than once`));
    seen.add(node.id);
  }

  for (const edge of board.edges) {
    const missing = seen.has(edge.source) ? (seen.has(edge.target) ? null : edge.target) : edge.source;
    if (missing) violations.push(violation('noDanglingConnection', `connection ${edge.id} references ${missing}, which the board does not hold`));
  }

  return violations;
}

/** The same check, for a caller that wants the board or nothing. */
export function assertBoardInvariants(board: CanvasBoard): CanvasBoard {
  const violations = boardInvariantViolations(board);
  if (violations.length) {
    throw new Error(`CanvasBoard invariant violated: ${violations.map((violation) => `${violation.statement} (${violation.detail})`).join('; ')}`);
  }
  return board;
}

/**
 * Drop what `noDanglingConnection` forbids instead of refusing the whole board.
 *
 * The selection and the connections are the two things that can name an object
 * the board no longer holds, and both arise the same way — something was deleted
 * and a list kept pointing at it. Repairing in the SAME change is the invariant:
 * "not on the next render" is the part that makes it a rule rather than a hope.
 */
export function edgesWithinBoard(nodes: readonly CanvasObject[], edges: readonly Edge[]): Edge[] {
  const present = new Set(nodes.map((node) => node.id));
  return edges.filter((edge) => present.has(edge.source) && present.has(edge.target));
}
