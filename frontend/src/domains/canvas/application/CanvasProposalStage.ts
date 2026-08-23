/**
 * THE PROPOSAL STAGE — one turn's worth of intended board changes.
 *
 * ── THE DUPLICATION THIS ENDS ───────────────────────────────────────────────
 * A Brain turn does not write the board. It STAGES `ProposedCanvasChange`s and
 * the review step (or auto-apply) commits them. Every canvas tool therefore has
 * to answer the same two questions before it can do anything:
 *
 *   1. "Where do I put this?" — which needs the board PLUS everything earlier
 *      tools in this same turn already staged, or two tools called in one turn
 *      lay their objects on top of each other.
 *   2. "Does this id resolve?" — which needs the same union, or a tool cannot
 *      connect to an object the previous tool call just created.
 *
 * Both were re-derived by hand at every call site. In `CreationCanvas.tsx` that
 * was 58 copies of
 *
 *     const staged = proposalBuffer.current.flatMap(
 *       (change) => change.type === 'object.add' ? [change.node] : []);
 *     const all = [...nodes, ...staged];
 *
 * — three of which spelled it `stagedNodes`, one of which forgot the staged
 * EDGES half, and 93 separate `crypto.randomUUID()` calls to mint change ids.
 * A tool that forgot the union silently placed objects on top of each other,
 * which is a bug you can only see by looking at the board.
 *
 * So the union is not a convention any more. `nodes()` and `edges()` on this
 * class ALWAYS mean board-plus-staged; there is no accessor that returns the
 * un-staged board, because no tool has ever wanted one.
 *
 * ── WHY A CLASS AND NOT A HOOK ──────────────────────────────────────────────
 * The buffer outlives no render — it is filled during one turn and drained by
 * the review step — and the tools that write to it are pure functions over an
 * injected context (see `lib/canvasBuildTools.ts` and its siblings). Making this
 * a class keeps every tool module unit-testable without React, and keeps the
 * component's job down to owning the ref.
 */

import type { Edge } from '@xyflow/react';
import type { CreationConnectionKind } from '@builderforce/creation-canvas-contract';
import type { CanvasObject, CanvasObjectData, CreationObjectKind } from '../domain/canvasObject';
import type { ProposedCanvasChange } from '../domain/canvasChange';

/**
 * The committed board, read live. A function rather than a value because a
 * stage is constructed once per turn while `nodes`/`edges` change under it —
 * capturing the array would freeze the tools' view of the board at turn start.
 */
export interface CanvasStageBoard {
  nodes: () => readonly CanvasObject[];
  edges: () => readonly Edge[];
}

/** Mints change ids and object ids. Injectable so tests get stable ids without stubbing globals. */
export type ChangeIdFactory = () => string;

/**
 * How a new object is BUILT — the two decisions the stage must not make itself.
 *
 * `defaults` is the object registry's opinion of what a kind starts as, and
 * `position` is the layout module's opinion of where a thing of that kind fits
 * without landing on something else. Both are injected rather than imported so
 * this stays an application-layer class with no reach into the component tree
 * or the registry, and so a test can place objects on a predictable grid.
 */
export interface CanvasObjectFactory {
  defaults: (kind: CreationObjectKind) => CanvasObjectData;
  position: (
    against: readonly CanvasObject[],
    requested: { x?: number; y?: number },
    narrow: boolean,
    kind: CreationObjectKind,
  ) => { x: number; y: number };
  /** True on the viewport widths that stack authored objects instead of placing them. */
  narrow: () => boolean;
}

/** What a connection between two objects carries. */
export interface CanvasConnectionSpec {
  kind: CreationConnectionKind;
  label?: string;
  animated?: boolean;
}

export class CanvasProposalStage {
  private buffer: ProposedCanvasChange[] = [];

  constructor(
    private readonly board: CanvasStageBoard,
    private readonly factory: CanvasObjectFactory,
    private readonly nextId: ChangeIdFactory = () => crypto.randomUUID(),
  ) {}

  /** Board objects PLUS everything staged this turn. The only object view tools get. */
  nodes(): CanvasObject[] {
    return [...this.board.nodes(), ...this.stagedNodes()];
  }

  /** Board connections PLUS everything staged this turn. */
  edges(): Edge[] {
    return [...this.board.edges(), ...this.stagedEdges()];
  }

  /** Just the objects this turn proposed, in the order they were proposed. */
  stagedNodes(): CanvasObject[] {
    return this.buffer.flatMap((change) => (change.type === 'object.add' ? [change.node] : []));
  }

  /** Just the connections this turn proposed. */
  stagedEdges(): Edge[] {
    return this.buffer.flatMap((change) => (change.type === 'connection.add' ? [change.edge] : []));
  }

  /** Resolve an object id against the board and this turn's staged additions. */
  object(objectId: string | undefined | null): CanvasObject | null {
    if (!objectId) return null;
    return this.nodes().find((node) => node.id === objectId) ?? null;
  }

  /** Resolve a connection id against the board and this turn's staged additions. */
  connection(connectionId: string | undefined | null): Edge | null {
    if (!connectionId) return null;
    return this.edges().find((edge) => edge.id === connectionId) ?? null;
  }

  hasObject(objectId: string | undefined | null): boolean {
    return this.object(objectId) !== null;
  }

  hasConnection(connectionId: string | undefined | null): boolean {
    return this.connection(connectionId) !== null;
  }

  /**
   * Build a new object of `kind`, placed against the board AND everything staged
   * so far, without staging it — the caller still fills in `data` and calls
   * {@link addObject}, because most tools need the node's id to connect it up.
   *
   * This is the third half of the duplication the stage exists to end. The idiom
   *
   *     newNode(kind, nextCanvasObjectPosition(
   *       [...nodes, ...staged], at, typeof window !== 'undefined' && window.innerWidth <= 760, kind))
   *
   * appeared 43 times, and the viewport test inside it appeared 43 times, spelled
   * as a local named `isNarrow` in some tools and `narrowViewport` in others. A
   * tool that passed the wrong node array — several passed a stale `all` computed
   * before the previous staged object existed — placed its object on top of one.
   */
  createObject(kind: CreationObjectKind, at: { x?: number; y?: number } = {}): CanvasObject {
    return {
      id: this.nextId(),
      type: 'creation',
      position: this.factory.position(this.nodes(), at, this.factory.narrow(), kind),
      data: this.factory.defaults(kind),
    };
  }

  /**
   * Propose a connection between two objects. The edge literal it replaces was
   * written out 43 times, and `type: 'smoothstep'` — which is not a choice any
   * tool was making, just the board's edge style — was part of every copy.
   */
  connect(label: string, source: string, target: string, spec: CanvasConnectionSpec): Edge {
    const edge: Edge = {
      id: this.nextId(),
      source,
      target,
      type: 'smoothstep',
      ...(spec.label ? { label: spec.label } : {}),
      ...(spec.animated ? { animated: true } : {}),
      data: { connectionKind: spec.kind },
    };
    this.addConnection(label, edge);
    return edge;
  }

  addObject(label: string, node: CanvasObject): void {
    this.buffer.push({ id: this.nextId(), type: 'object.add', label, node });
  }

  updateObject(label: string, objectId: string, patch: Partial<CanvasObjectData>): void {
    this.buffer.push({ id: this.nextId(), type: 'object.update', label, objectId, patch });
  }

  deleteObject(label: string, objectId: string): void {
    this.buffer.push({ id: this.nextId(), type: 'object.delete', label, objectId });
  }

  layoutObject(
    label: string,
    objectId: string,
    layout: { position?: { x: number; y: number }; width?: number; height?: number; hidden?: boolean; locked?: boolean },
  ): void {
    this.buffer.push({ id: this.nextId(), type: 'object.layout', label, objectId, ...layout });
  }

  invokeAction(label: string, objectId: string, action: string): void {
    this.buffer.push({ id: this.nextId(), type: 'object.action', label, objectId, action });
  }

  addConnection(label: string, edge: Edge): void {
    this.buffer.push({ id: this.nextId(), type: 'connection.add', label, edge });
  }

  updateConnection(label: string, connectionId: string, patch: { label?: string; kind?: CreationConnectionKind }): void {
    this.buffer.push({ id: this.nextId(), type: 'connection.update', label, connectionId, patch });
  }

  deleteConnection(label: string, connectionId: string): void {
    this.buffer.push({ id: this.nextId(), type: 'connection.delete', label, connectionId });
  }

  /** How many changes this turn has proposed. */
  get size(): number {
    return this.buffer.length;
  }

  /** Everything proposed this turn, for the review list. */
  list(): readonly ProposedCanvasChange[] {
    return this.buffer;
  }

  /** Hand the turn's changes to the review step and start the next turn empty. */
  drain(): ProposedCanvasChange[] {
    const changes = this.buffer;
    this.buffer = [];
    return changes;
  }

  /** Abandon everything staged. Used when a turn is aborted rather than reviewed. */
  reset(): void {
    this.buffer = [];
  }
}
