/**
 * The invariant 58 hand-written copies were supposed to hold and sometimes did
 * not: a tool's view of the board INCLUDES what earlier tools staged this turn.
 */

import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import { BRAIN_ACTOR, CanvasProposalStage, type CanvasObjectFactory } from './CanvasProposalStage';
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
  position: (against, requested, viewport, _kind) => (
    viewport.narrow ? { x: 0, y: against.length * 100 } : { x: requested.x ?? 0, y: requested.y ?? 0 }
  ),
  viewport: () => ({ width: 360, narrow: true }),
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

describe('CanvasProposalStage provenance', () => {
  const at = '2026-09-07T12:00:00.000Z';
  const budget = (): CanvasObject => ({ ...object('b1', 'budget'), data: { kind: 'budget' as CreationObjectKind, title: 'Q3', plannedTotal: 120000 } });
  function stageWithClock(nodes: CanvasObject[]) {
    let counter = 0;
    return new CanvasProposalStage({ nodes: () => nodes, edges: () => [] }, factory, () => `id-${++counter}`, BRAIN_ACTOR, () => at);
  }

  it('stamps an attributed field move on the staged patch, attributed to the Brain and sourced from the label', () => {
    const stage = stageWithClock([budget()]);
    stage.updateObject('Rebalance the Q3 budget', 'b1', { plannedTotal: 150000 });

    const [change] = stage.list();
    if (change?.type !== 'object.update') throw new Error('expected an object.update');
    expect(change.patch.plannedTotal).toBe(150000);
    expect(change.patch.provenance).toEqual([{
      id: `plannedTotal:${at}`,
      field: 'plannedTotal',
      from: '120,000',
      to: '150,000',
      at,
      by: BRAIN_ACTOR,
      source: 'Rebalance the Q3 budget',
    }]);
  });

  it('leaves a patch untouched when it moves nothing attributed', () => {
    const stage = stageWithClock([budget()]);
    stage.updateObject('Rename', 'b1', { title: 'Q3 (final)' });
    stage.updateObject('Restate', 'b1', { plannedTotal: 120000 });

    for (const change of stage.list()) {
      if (change.type !== 'object.update') throw new Error('expected an object.update');
      expect('provenance' in change.patch).toBe(false);
    }
  });

  it('extends, never overwrites, the trail across two patches to one field in one turn', () => {
    const stage = stageWithClock([budget()]);
    stage.updateObject('First pass', 'b1', { plannedTotal: 130000 });
    stage.updateObject('Second pass', 'b1', { plannedTotal: 150000 });

    const second = stage.list()[1];
    if (second?.type !== 'object.update') throw new Error('expected an object.update');
    expect(second.patch.provenance).toHaveLength(2);
    expect((second.patch.provenance as Array<{ from: string; to: string }>).map((e) => `${e.from}→${e.to}`)).toEqual(['120,000→130,000', '130,000→150,000']);
  });

  it('attributes to the injected actor when a caller names one', () => {
    let counter = 0;
    const human = { kind: 'human' as const, ref: 'user:7', name: 'Ada' };
    const stage = new CanvasProposalStage({ nodes: () => [budget()], edges: () => [] }, factory, () => `id-${++counter}`, human, () => at);
    stage.updateObject('Approve', 'b1', { plannedTotal: 1 });

    const [change] = stage.list();
    if (change?.type !== 'object.update') throw new Error('expected an object.update');
    expect((change.patch.provenance as Array<{ by: unknown }>)[0]?.by).toEqual(human);
  });
});
