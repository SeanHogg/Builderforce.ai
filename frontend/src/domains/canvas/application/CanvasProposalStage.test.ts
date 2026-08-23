/**
 * The invariant 58 hand-written copies were supposed to hold and sometimes did
 * not: a tool's view of the board INCLUDES what earlier tools staged this turn.
 */

import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import { CanvasProposalStage } from './CanvasProposalStage';
import type { CanvasObject, CreationObjectKind } from '../domain/canvasObject';

function object(id: string, kind = 'note'): CanvasObject {
  return { id, type: 'creation', position: { x: 0, y: 0 }, data: { kind: kind as CreationObjectKind, title: id } };
}

function edge(id: string, source: string, target: string): Edge {
  return { id, source, target };
}

function stageOver(nodes: CanvasObject[] = [], edges: Edge[] = []) {
  let counter = 0;
  return new CanvasProposalStage({ nodes: () => nodes, edges: () => edges }, () => `change-${++counter}`);
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
    const stage = new CanvasProposalStage({ nodes: () => nodes, edges: () => [] });
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
      'change-1', 'change-2', 'change-3', 'change-4', 'change-5', 'change-6', 'change-7', 'change-8',
    ]);
    expect(stage.list().map((change) => change.type)).toEqual([
      'object.add', 'object.update', 'object.delete', 'object.layout',
      'object.action', 'connection.add', 'connection.update', 'connection.delete',
    ]);
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
