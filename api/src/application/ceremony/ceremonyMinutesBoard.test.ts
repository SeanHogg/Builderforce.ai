import { describe, expect, it } from 'vitest';
import { parseMeetingMinutes } from '../../domain/meetings/meetingMinutes';
import type { BoardGraph } from '../canvas/rewriteBoardGraph';
import {
  applyCeremonyMinutesToBoard,
  CEREMONY_ACTION_RESOURCE_TYPE,
  CEREMONY_HELD_STATUS,
  ceremonyActionResourceId,
  DELETED_ACTION_ITEMS_KEY,
} from './ceremonyMinutesBoard';

const CEREMONY = '9f2c0000-0000-4000-8000-000000000001';

const MINUTES = parseMeetingMinutes([
  'Shipped the importer; the billing fix slips to Thursday.',
  '',
  '**Action items**',
  '- [ ] Ana — Update the release notes',
  '- [x] Ben — Book the demo room',
  '- [ ] Write up the retro',
].join('\n'));

function board(): BoardGraph {
  return {
    objects: [
      { id: 'person', kind: 'staff', canvasData: { x: 0, y: 0 }, content: { kind: 'staff', title: 'Ana' } },
      {
        id: 'card', kind: 'standup', resourceType: 'ceremony', resourceId: CEREMONY,
        canvasData: { x: 100, y: 200 },
        content: { kind: 'standup', title: 'Daily', status: 'Live', summary: 'Brain will ask each person for progress.', resourceId: `ceremony:${CEREMONY}` },
      },
    ],
    connections: [{ id: 'joins', sourceObjectId: 'person', targetObjectId: 'card', kind: 'reference', label: 'joins' }],
  };
}

function ids() {
  let n = 0;
  return () => `new-${++n}`;
}

const apply = (graph: BoardGraph, minutes = MINUTES, generatedAt: string | null = '2026-10-10T09:30:00.000Z') =>
  applyCeremonyMinutesToBoard(graph, { ceremonyId: CEREMONY, minutes, generatedAt, newId: ids() });

describe('applyCeremonyMinutesToBoard', () => {
  it('replaces the convening summary and places each OPEN action item beside the card', () => {
    const result = apply(board())!;
    expect(result).not.toBeNull();
    const card = result.graph.objects.find((o) => o.id === 'card')!;
    expect(card.content).toMatchObject({
      summary: 'Shipped the importer; the billing fix slips to Thursday.',
      status: CEREMONY_HELD_STATUS,
      minutesGeneratedAt: '2026-10-10T09:30:00.000Z',
    });

    const tasks = result.graph.objects.filter((o) => o.kind === 'task');
    // The ticked item was dealt with in the room — it is not a follow-up.
    expect(tasks.map((o) => (o.content as { title: string }).title)).toEqual([
      'Ana — Update the release notes',
      'Write up the retro',
    ]);
    expect(tasks[0]).toMatchObject({
      resourceType: CEREMONY_ACTION_RESOURCE_TYPE,
      resourceId: ceremonyActionResourceId(CEREMONY, 0),
      canvasData: { x: 520, y: 200 },
      content: { subtitle: 'Ana', sourceCeremonyId: CEREMONY, status: 'Ready' },
    });
    expect(tasks[1]?.content).not.toHaveProperty('subtitle');
    expect(result.graph.connections.filter((e) => e.label === 'action item').map((e) => [e.sourceObjectId, e.targetObjectId]))
      .toEqual(tasks.map((task) => ['card', task.id]));
    expect(result).toMatchObject({ cards: 1, placed: 2, updated: 0, removed: 0, actionItems: 2, changed: true });
  });

  it('is a no-op on a second run over the same minutes', () => {
    const first = apply(board())!;
    const second = apply(first.graph)!;
    expect(second.changed).toBe(false);
    expect(second.graph.objects).toHaveLength(first.graph.objects.length);
    expect(second.graph.connections).toHaveLength(first.graph.connections.length);
  });

  it('updates follow-ups IN PLACE when the minutes are regenerated, and removes dropped ones', () => {
    const first = apply(board())!;
    // Somebody dragged the first follow-up and moved it on.
    const moved = {
      ...first.graph,
      objects: first.graph.objects.map((o) => o.resourceId === ceremonyActionResourceId(CEREMONY, 0)
        ? { ...o, canvasData: { x: 900, y: 40 }, content: { ...(o.content as object), status: 'In progress' } }
        : o),
    };
    const reworded = parseMeetingMinutes('Recap.\n\n**Action items**\n- [ ] Ana — Update the release notes and changelog');
    const second = apply(moved, reworded, '2026-10-10T10:00:00.000Z')!;

    const tasks = second.graph.objects.filter((o) => o.kind === 'task');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      canvasData: { x: 900, y: 40 },
      content: { title: 'Ana — Update the release notes and changelog', status: 'In progress' },
    });
    // The dropped follow-up's connection goes with it; the seat's `joins` edge stays.
    expect(second.graph.connections.filter((e) => e.label === 'action item')).toHaveLength(1);
    expect(second.graph.connections.some((e) => e.id === 'joins')).toBe(true);
    expect(second).toMatchObject({ placed: 0, updated: 1, removed: 1 });
  });

  it('adopts a follow-up the old browser act placed instead of duplicating it', () => {
    const graph = board();
    graph.objects.push({
      id: 'legacy', kind: 'task', canvasData: { x: 10, y: 10 },
      content: { kind: 'task', title: 'ana — update the release notes', sourceCeremonyId: CEREMONY },
    });
    const result = apply(graph)!;
    const tasks = result.graph.objects.filter((o) => o.kind === 'task');
    expect(tasks).toHaveLength(2);
    expect(tasks.find((o) => o.id === 'legacy')).toMatchObject({
      resourceType: CEREMONY_ACTION_RESOURCE_TYPE,
      resourceId: ceremonyActionResourceId(CEREMONY, 0),
      canvasData: { x: 10, y: 10 },
    });
    expect(result).toMatchObject({ placed: 1, updated: 1 });
  });

  it('clears the convening sentence when the minutes carry no recap', () => {
    const result = apply(board(), parseMeetingMinutes('**Action items**\n- [ ] Do it'))!;
    expect(result.graph.objects.find((o) => o.id === 'card')!.content).not.toHaveProperty('summary');
  });

  it('answers null for a board with no card for this ceremony', () => {
    const graph = board();
    graph.objects = graph.objects.filter((o) => o.id !== 'card');
    expect(apply(graph)).toBeNull();
  });

  it('never touches another ceremony\'s follow-ups', () => {
    const graph = board();
    graph.objects.push({
      id: 'other', kind: 'task', resourceType: CEREMONY_ACTION_RESOURCE_TYPE, resourceId: 'another-ceremony:1',
      canvasData: { x: 0, y: 0 }, content: { kind: 'task', title: 'Theirs' },
    });
    const result = apply(graph)!;
    expect(result.graph.objects.find((o) => o.id === 'other')).toEqual(graph.objects.find((o) => o.id === 'other'));
    expect(result.removed).toBe(0);
  });

  it('skips action items whose resourceIds are in the card\'s deletedActionItemResourceIds tombstone list', () => {
    const graph = board();
    // Add a tombstone to the card content for the first action item
    const card = graph.objects.find((o) => o.id === 'card')!;
    card.content = { ...card.content, [DELETED_ACTION_ITEMS_KEY]: [ceremonyActionResourceId(CEREMONY, 0)] };
    // Add the corresponding action item object to the board
    graph.objects.push({
      id: 'tombstoned-task', kind: 'task', resourceType: CEREMONY_ACTION_RESOURCE_TYPE, resourceId: ceremonyActionResourceId(CEREMONY, 0),
      canvasData: { x: 520, y: 200 }, content: { kind: 'task', title: 'Ana — Update the release notes', status: 'Ready', sourceCeremonyId: CEREMONY },
    });
    graph.connections.push({ id: 'tombstoned-edge', sourceObjectId: 'card', targetObjectId: 'tombstoned-task', kind: 'reference', label: 'action item' });

    const result = apply(graph)!;
    // The tombstoned item should be removed (not placed as new), but the non-tombstoned item should still be placed
    const tasks = result.graph.objects.filter((o) => o.kind === 'task');
    // Only the non-tombstoned item remains
    expect(tasks.map((o) => (o.content as { title: string }).title)).toEqual(['Write up the retro']);
    expect(result.removed).toBe(1); // The tombstoned task was removed
    expect(result.placed).toBe(1);   // The non-tombstoned item was placed
  });

  it('preserves existing tombstones in the card content after applying minutes', () => {
    const graph = board();
    // Pre-existing tombstone for an item that was previously deleted
    const card = graph.objects.find((o) => o.id === 'card')!;
    card.content = { ...card.content, [DELETED_ACTION_ITEMS_KEY]: ['some-old-deleted:1', 'some-old-deleted:2'] };

    const result = apply(graph)!;
    const updatedCard = result.graph.objects.find((o) => o.id === 'card')!;
    // The existing tombstones should be preserved
    expect(updatedCard.content).toHaveProperty(DELETED_ACTION_ITEMS_KEY);
    const tombstones = (updatedCard.content as Record<string, unknown>)[DELETED_ACTION_ITEMS_KEY];
    expect(tombstones).toContain('some-old-deleted:1');
    expect(tombstones).toContain('some-old-deleted:2');
  });
});
