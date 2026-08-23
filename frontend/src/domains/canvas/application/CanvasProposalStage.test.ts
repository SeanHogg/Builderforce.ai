/**
 * The invariant 58 hand-written copies were supposed to hold and sometimes did
 * not: a tool's view of the board INCLUDES what earlier tools staged this turn.
 */

import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import { CanvasProposalStage, type CanvasObjectFactory } from './CanvasProposalStage';
import type { CanvasObject, CreationObjectKind } from '../domain/canvasObject';

function object(id: string, kind = 'note'): CanvasObject {
  return { id, type: 'creation', position: { x: 0, y: 0 }, data: { kind: kind as CreationObjectKind, title: id } };
}

function edge(id: string, source: string, target: string): Edge {
  return { id, source, target };
}

/** A grid factory: every object lands 100px below the last, so placement is assertable. */
const factory: CanvasObjectFactory = {
  defaults: (kind) => ({ kind, title: kind }),
  position: (against, requested, narrow, _kind) => (
    narrow ? { x: 0, y: against.length * 100 } : { x: requested.x ?? 0, y: requested.y ?? 0 }
  ),
  narrow: () => true,
};

function stageOver(nodes: CanvasObject[] = [], edges: Edge[] = []) {
  let counter = 0;
  return new CanvasProposalStage({ nodes: () => nodes, edges: () => edges }, factory, () => `id-${++counter}`);
}

describe('CanvasProposalStage', () => {
  it('reads the board plus everything staged this turn', () => {
    const stage = stageOver([object('committed')]);
    stage.addObject('Add staged', object('staged'));

    expect(stage.nodes().map((node) => node.id)).toEqual(['committed', 'staged']);
  });

  it('resolves an id a previous tool call created in the same turn', () => {
    const stage = stageOver();
    stage.addObject('Add staged', object('staged'));

    expect(stage.object('staged')?.id).toBe('staged');
    expect(stage.hasObject('staged')).toBe(true);
    expect(stage.hasObject('never-made')).toBe(false);
  });

  it('resolves connections across board and staged alike', () => {
    const stage = stageOver([], [edge('committed', 'a', 'b')]);
    stage.addConnection('Link', edge('staged', 'b', 'c'));

    expect(stage.hasConnection('committed')).toBe(true);
    expect(stage.hasConnection('staged')).toBe(true);
    expect(stage.connection('staged')?.target).toBe('c');
  });

  it('reads the board live rather than freezing it at construction', () => {
    const nodes = [object('first')];
    const stage = new CanvasProposalStage({ nodes: () => nodes, edges: () => [] }, factory);
    nodes.push(object('second'));

    expect(stage.nodes().map((node) => node.id)).toEqual(['first', 'second']);
  });

  it('mints an id for every change so no call site has to', () => {
    const stage = stageOver();
    stage.addObject('Add', object('a'));
    stage.updateObject('Update', 'a', { title: 'renamed' });
    stage.deleteObject('Delete', 'a');
    stage.layoutObject('Move', 'a', { position: { x: 10, y: 20 } });
    stage.invokeAction('Run', 'a', 'publish');
    stage.addConnection('Link', edge('e1', 'a', 'b'));
    stage.updateConnection('Relabel', 'e1', { label: 'covers' });
    stage.deleteConnection('Unlink', 'e1');

    expect(stage.list().map((change) => change.id)).toEqual([
      'id-1', 'id-2', 'id-3', 'id-4', 'id-5', 'id-6', 'id-7', 'id-8',
    ]);
    expect(stage.list().map((change) => change.type)).toEqual([
      'object.add', 'object.update', 'object.delete', 'object.layout',
      'object.action', 'connection.add', 'connection.update', 'connection.delete',
    ]);
  });

  it('places each new object against the board AND what this turn already staged', () => {
    const stage = stageOver([object('committed')]);

    const first = stage.createObject('note');
    expect(first.position).toEqual({ x: 0, y: 100 });
    stage.addObject('Add first', first);

    // The bug this ends: a tool that captured the board before the previous tool
    // staged its object placed the second one on top of the first.
    const second = stage.createObject('note');
    expect(second.position).toEqual({ x: 0, y: 200 });
  });

  it('gives a new object the kind registry defaults and a minted id', () => {
    const stage = stageOver();
    const made = stage.createObject('note');

    expect(made).toMatchObject({ id: 'id-1', type: 'creation', data: { kind: 'note', title: 'note' } });
  });

  it('stages a connection with the board edge style and the given kind', () => {
    const stage = stageOver();
    const made = stage.connect('Link', 'a', 'b', { kind: 'data', label: 'joined', animated: true });

    expect(made).toMatchObject({ id: 'id-1', source: 'a', target: 'b', type: 'smoothstep', label: 'joined', animated: true, data: { connectionKind: 'data' } });
    expect(stage.list()).toHaveLength(1);
    expect(stage.hasConnection('id-1')).toBe(true);
  });

  it('leaves label and animated off a connection that did not ask for them', () => {
    const stage = stageOver();
    const made = stage.connect('Link', 'a', 'b', { kind: 'reference' });

    expect('label' in made).toBe(false);
    expect('animated' in made).toBe(false);
  });

  it('drains the turn and starts the next one empty', () => {
    const stage = stageOver();
    stage.addObject('Add', object('a'));

    expect(stage.drain()).toHaveLength(1);
    expect(stage.size).toBe(0);
    expect(stage.nodes()).toEqual([]);
  });

  it('abandons staged work on reset', () => {
    const stage = stageOver([object('committed')]);
    stage.addObject('Add', object('a'));
    stage.reset();

    expect(stage.size).toBe(0);
    expect(stage.nodes().map((node) => node.id)).toEqual(['committed']);
  });
});
