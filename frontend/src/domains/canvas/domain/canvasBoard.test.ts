/**
 * The `CanvasBoard` aggregate, tested WITHOUT mounting anything.
 *
 * That is the point of the move, not a side effect of it: these rules used to be
 * private functions inside a 900 KB component, so the only way to assert one was
 * to render the whole canvas in jsdom — ~35 s per mount, which is why the file
 * that holds those assertions takes 778 s for 83 tests and tips a different case
 * over the timeout on every run. Nothing here touches React.
 */

import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import {
  assertBoardInvariants,
  associateBrainWithArtifacts,
  boardFromPersistedGraph,
  boardInvariantViolations,
  edgesWithinBoard,
  mergeCollaboratorBoards,
  objectAtPoint,
  persistedGraphFromBoard,
  type CanvasBoard,
  type PersistedCanvasGraph,
} from './canvasBoard';
import type { CanvasObject, CreationObjectKind } from './canvasObject';

function object(id: string, kind: string, position = { x: 0, y: 0 }, extra: Partial<CanvasObject> = {}): CanvasObject {
  return { id, type: 'creation', position, data: { kind: kind as CreationObjectKind, title: id }, ...extra };
}

function edge(id: string, source: string, target: string): Edge {
  return { id, source, target };
}

function persisted(objects: PersistedCanvasGraph['objects'], connections: PersistedCanvasGraph['connections'] = []): PersistedCanvasGraph {
  return { objects, connections };
}

describe('boardFromPersistedGraph — the anti-corruption boundary', () => {
  it('reads a stored object into a board object, positions and size included', () => {
    const { board, rejected } = boardFromPersistedGraph(persisted([
      { id: 'a', kind: 'website', canvasData: { x: 12, y: 34, w: 300, h: 200 }, content: { title: 'Landing' } },
    ]));

    expect(rejected).toEqual([]);
    expect(board.nodes).toHaveLength(1);
    expect(board.nodes[0]).toMatchObject({
      id: 'a',
      type: 'creation',
      position: { x: 12, y: 34 },
      style: { width: 300, height: 200 },
    });
    expect(board.nodes[0]!.data.kind).toBe('website');
  });

  it('REJECTS a kind the contract does not declare rather than rendering a blank card', () => {
    const { board, rejected } = boardFromPersistedGraph(persisted([
      { id: 'known', kind: 'website', canvasData: {}, content: {} },
      { id: 'unknown', kind: 'holographic-widget', canvasData: {}, content: {} },
    ]));

    expect(board.nodes.map((node) => node.id)).toEqual(['known']);
    expect(rejected).toEqual([
      { id: 'unknown', kind: 'holographic-widget', reason: expect.stringContaining('kind the contract declares') },
    ]);
  });

  it('keeps the other objects when one is rejected — one bad row must not cost the board', () => {
    const { board, rejected } = boardFromPersistedGraph(persisted(
      Array.from({ length: 5 }, (_, index) => ({ id: `object-${index}`, kind: index === 2 ? 'not-a-kind' : 'website', canvasData: {}, content: {} })),
    ));

    expect(board.nodes).toHaveLength(4);
    expect(rejected).toHaveLength(1);
  });

  it('drops a connection to a rejected object, so repairing one invariant cannot violate the other', () => {
    const { board } = boardFromPersistedGraph(persisted(
      [
        { id: 'a', kind: 'website', canvasData: {}, content: {} },
        { id: 'b', kind: 'not-a-kind', canvasData: {}, content: {} },
      ],
      [{ id: 'edge-1', sourceObjectId: 'a', targetObjectId: 'b' }],
    ));

    expect(board.edges).toEqual([]);
    expect(boardInvariantViolations(board)).toEqual([]);
  });

  it('carries placement flags and the resource reference across the boundary', () => {
    const { board } = boardFromPersistedGraph(persisted([
      { id: 'a', kind: 'prd', resourceType: 'spec', resourceId: '7', canvasData: {}, content: { placementLocked: true, placementHidden: true } },
    ]));

    expect(board.nodes[0]).toMatchObject({ draggable: false, hidden: true });
    expect(board.nodes[0]!.data.resourceId).toBe('spec:7');
  });

  it('defaults a connection to a reference with the smoothstep renderer', () => {
    const { board } = boardFromPersistedGraph(persisted(
      [{ id: 'a', kind: 'website', canvasData: {}, content: {} }, { id: 'b', kind: 'dashboard', canvasData: {}, content: {} }],
      [{ id: 'edge-1', sourceObjectId: 'a', targetObjectId: 'b' }],
    ));

    expect(board.edges[0]).toMatchObject({ type: 'smoothstep', data: { connectionKind: 'reference' } });
  });
});

describe('board invariants', () => {
  it('passes a board that holds to all of them', () => {
    const board: CanvasBoard = { nodes: [object('a', 'website'), object('b', 'dashboard')], edges: [edge('e', 'a', 'b')] };
    expect(boardInvariantViolations(board)).toEqual([]);
    expect(() => assertBoardInvariants(board)).not.toThrow();
  });

  it('names `uniqueObjectIds` when two objects share an id', () => {
    const board: CanvasBoard = { nodes: [object('a', 'website'), object('a', 'dashboard')], edges: [] };
    expect(boardInvariantViolations(board).map((violation) => violation.invariant)).toEqual(['uniqueObjectIds']);
  });

  it('names `noDanglingConnection` and says WHICH end is missing', () => {
    const board: CanvasBoard = { nodes: [object('a', 'website')], edges: [edge('e', 'a', 'ghost')] };
    const [violation] = boardInvariantViolations(board);
    expect(violation?.invariant).toBe('noDanglingConnection');
    expect(violation?.detail).toContain('ghost');
  });

  it('names `declaredKind` for an object whose kind is not in the contract', () => {
    const board: CanvasBoard = { nodes: [object('a', 'invented')], edges: [] };
    expect(boardInvariantViolations(board).map((violation) => violation.invariant)).toEqual(['declaredKind']);
  });

  it('throws with every statement when asserted', () => {
    const board: CanvasBoard = { nodes: [object('a', 'invented')], edges: [edge('e', 'a', 'ghost')] };
    expect(() => assertBoardInvariants(board)).toThrow(/CanvasBoard invariant violated/);
  });
});

describe('edgesWithinBoard', () => {
  it('keeps only connections whose both ends are on the board', () => {
    const nodes = [object('a', 'website'), object('b', 'dashboard')];
    const edges = [edge('keep', 'a', 'b'), edge('drop-source', 'ghost', 'b'), edge('drop-target', 'a', 'ghost')];
    expect(edgesWithinBoard(nodes, edges).map((item) => item.id)).toEqual(['keep']);
  });
});

describe('mergeCollaboratorBoards', () => {
  it('lets LOCAL win, because the remote snapshot is a base and not an overwrite', () => {
    const local: CanvasBoard = { nodes: [object('a', 'website', { x: 99, y: 99 })], edges: [] };
    const remote: CanvasBoard = { nodes: [object('a', 'website', { x: 0, y: 0 }), object('b', 'dashboard')], edges: [] };

    const merged = mergeCollaboratorBoards(local, remote);
    expect(merged.nodes.find((node) => node.id === 'a')!.position).toEqual({ x: 99, y: 99 });
    expect(merged.nodes.map((node) => node.id).sort()).toEqual(['a', 'b']);
  });

  it('adopts a collaborator object this browser has never seen', () => {
    const merged = mergeCollaboratorBoards({ nodes: [], edges: [] }, { nodes: [object('remote', 'website')], edges: [edge('e', 'remote', 'remote')] });
    expect(merged.nodes.map((node) => node.id)).toEqual(['remote']);
    expect(merged.edges.map((item) => item.id)).toEqual(['e']);
  });
});

describe('objectAtPoint', () => {
  const measure = () => ({ width: 100, height: 100 });

  it('returns the TOPMOST object under the point, which is the later one', () => {
    const nodes = [object('under', 'website'), object('over', 'dashboard')];
    expect(objectAtPoint(nodes, { x: 10, y: 10 }, measure)?.id).toBe('over');
  });

  it('ignores a hidden object — you cannot draw on what you cannot see', () => {
    const nodes = [object('visible', 'website'), object('hidden', 'dashboard', { x: 0, y: 0 }, { hidden: true })];
    expect(objectAtPoint(nodes, { x: 10, y: 10 }, measure)?.id).toBe('visible');
  });

  it('returns nothing for empty board space', () => {
    expect(objectAtPoint([object('a', 'website')], { x: 500, y: 500 }, measure)).toBeNull();
  });

  it('uses the measurer it is given rather than assuming a size', () => {
    const nodes = [object('a', 'website')];
    expect(objectAtPoint(nodes, { x: 250, y: 250 }, () => ({ width: 300, height: 300 }))?.id).toBe('a');
    expect(objectAtPoint(nodes, { x: 250, y: 250 }, () => ({ width: 100, height: 100 }))).toBeNull();
  });
});

describe('associateBrainWithArtifacts', () => {
  it('connects the Brain object to each artifact it was given', () => {
    const result = associateBrainWithArtifacts([], 'brain', ['a', 'b']);
    expect(result.map((item) => item.target)).toEqual(['a', 'b']);
    expect(result.every((item) => item.source === 'brain')).toBe(true);
  });

  it('labels the connection and types it as a REFERENCE by default', () => {
    const [edge] = associateBrainWithArtifacts([], 'brain', ['artifact']);
    expect(edge).toMatchObject({ source: 'brain', target: 'artifact', label: 'Brain context', data: { connectionKind: 'reference' } });
  });

  it('takes a caller-supplied label, for a turn that CHANGED rather than read', () => {
    const [edge] = associateBrainWithArtifacts([], 'brain', ['artifact'], 'Changed with Brain');
    expect(edge?.label).toBe('Changed with Brain');
  });

  it('is idempotent — the same artifact twice is not a second connection', () => {
    const once = associateBrainWithArtifacts([], 'brain', ['a']);
    expect(associateBrainWithArtifacts(once, 'brain', ['a'])).toHaveLength(1);
  });

  it('never connects the Brain to itself, and ignores an empty id', () => {
    expect(associateBrainWithArtifacts([], 'brain', ['brain', ''])).toEqual([]);
  });

  it('returns the connections untouched when there is no Brain on the board', () => {
    const existing = [edge('e', 'a', 'b')];
    expect(associateBrainWithArtifacts(existing, '', ['a'])).toBe(existing);
  });
});

describe('persistedGraphFromBoard', () => {
  it('persists semantic connection kinds independently from renderer types', () => {
    const nodes: CanvasObject[] = [
      { id: '00000000-0000-4000-8000-000000000001', type: 'creation', position: { x: 1, y: 2 }, data: { kind: 'dataset', title: 'Evidence' } },
      { id: '00000000-0000-4000-8000-000000000002', type: 'creation', position: { x: 3, y: 4 }, data: { kind: 'chart', title: 'Chart' } },
    ];
    const graph = persistedGraphFromBoard({ nodes, edges: [{
      id: '00000000-0000-4000-8000-000000000003', source: nodes[0]!.id, target: nodes[1]!.id,
      type: 'smoothstep', data: { connectionKind: 'data' }, animated: true,
    }] });
    expect(graph.connections[0]).toMatchObject({ kind: 'data', metadata: { rendererType: 'smoothstep', animated: true } });
  });

  it('persists the rendered footprint used by collision-free AI layout', () => {
    const graph = persistedGraphFromBoard({
      nodes: [{
        id: '00000000-0000-4000-8000-000000000004', type: 'creation', position: { x: 10, y: 20 },
        width: 240, height: 130, measured: { width: 460, height: 315 },
        data: { kind: 'task', title: 'Tall task' },
      }],
      edges: [],
    });

    expect(graph.objects[0]?.canvasData).toMatchObject({ x: 10, y: 20, w: 460, h: 315 });
  });
});
