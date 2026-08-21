/**
 * @vitest-environment jsdom
 *
 * `src/lib` runs in `node` by default — see `vitest.config.ts` for why 155 of 257 test
 * files had no reason to build a document. This one does: the whole subject is a
 * `localStorage` store and its behaviour when the quota refuses a write, and there is
 * no honest way to test shedding-and-retry against a stub that cannot run out.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { CreationFlowNode } from '@/components/creation-canvas/CreationNode';
import {
  LOCAL_CHECKPOINT_LIMIT, localCheckpointSummaries,
  readLocalCheckpoint, readLocalCheckpoints, saveLocalCheckpoint, withCheckpoint,
  type LocalCheckpoint,
} from './creationCheckpoints';
import { removeLocalCreationSession, writeLocalCreationSession } from '@/domains/canvas/infrastructure/localCanvasStore';

const SESSION = 'local-abc';

const node = (id: string): CreationFlowNode => ({
  id, type: 'creation', position: { x: 0, y: 0 }, data: { kind: 'note', title: id },
} as unknown as CreationFlowNode);

const board = (count: number) => ({
  nodes: Array.from({ length: count }, (_, index) => node(`n${index}`)),
  edges: [] as Edge[],
});

const checkpoint = (id: string, at: string): LocalCheckpoint => ({ id, label: id, at, nodes: [], edges: [] });

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('withCheckpoint', () => {
  it('keeps the newest and drops the oldest at the limit', () => {
    // An unbounded list on one board is a board that stops every OTHER board on this
    // device from saving at all.
    const existing = Array.from({ length: LOCAL_CHECKPOINT_LIMIT }, (_, index) => checkpoint(`old${index}`, `2026-08-0${(index % 9) + 1}T00:00:00.000Z`));
    const next = withCheckpoint(existing, checkpoint('new', '2026-08-19T00:00:00.000Z'));
    expect(next).toHaveLength(LOCAL_CHECKPOINT_LIMIT);
    expect(next.at(-1)?.id).toBe('new');
    expect(next.some((entry) => entry.id === 'old0')).toBe(false);
  });

  it('appends freely below the limit', () => {
    expect(withCheckpoint([checkpoint('a', '2026-08-01T00:00:00.000Z')], checkpoint('b', '2026-08-02T00:00:00.000Z'))).toHaveLength(2);
  });
});

describe('saveLocalCheckpoint', () => {
  it('gives a guest board the two verbs a saved one has', () => {
    // The whole point: "put this board back" was answerable only for signed-in users,
    // on the surface where an agent is most likely to have rewritten half of it.
    const saved = saveLocalCheckpoint(SESSION, 'Before the rewrite', board(3));
    expect(saved).toHaveLength(1);
    expect(saved?.[0]).toMatchObject({ label: 'Before the rewrite', objectCount: 3 });
    expect(readLocalCheckpoint(SESSION, saved![0]!.id)?.nodes).toHaveLength(3);
  });

  it('lists newest first', () => {
    saveLocalCheckpoint(SESSION, 'first', board(1), () => '2026-08-01T00:00:00.000Z');
    saveLocalCheckpoint(SESSION, 'second', board(2), () => '2026-08-02T00:00:00.000Z');
    expect(localCheckpointSummaries(SESSION).map((entry) => entry.label)).toEqual(['second', 'first']);
  });

  it('trims a label rather than storing an essay as a name', () => {
    const saved = saveLocalCheckpoint(SESSION, `  ${'x'.repeat(400)}  `, board(1));
    expect(saved?.[0]!.label).toHaveLength(120);
  });

  it('sheds the OLDEST and retries when the quota is full', () => {
    // The failure this closes: the naive version works until somebody has done enough
    // work to care, then silently stops saving at exactly that moment.
    saveLocalCheckpoint(SESSION, 'ancient', board(1), () => '2026-08-01T00:00:00.000Z');
    saveLocalCheckpoint(SESSION, 'older', board(1), () => '2026-08-02T00:00:00.000Z');

    let refusals = 2;
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key.endsWith(':checkpoints') && refusals > 0) { refusals -= 1; throw new DOMException('full', 'QuotaExceededError'); }
      return real.call(this, key, value);
    });

    const saved = saveLocalCheckpoint(SESSION, 'newest', board(1), () => '2026-08-03T00:00:00.000Z');
    // Two refusals dropped the two oldest; the one the person just asked for survived.
    expect(saved?.map((entry) => entry.label)).toEqual(['newest']);
  });

  it('reports failure honestly when not even one checkpoint fits', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    expect(saveLocalCheckpoint(SESSION, 'nope', board(1))).toBeNull();
  });
});

describe('readLocalCheckpoints', () => {
  it('is empty for a board that has none', () => {
    expect(readLocalCheckpoints(SESSION)).toEqual([]);
    expect(readLocalCheckpoint(SESSION, 'missing')).toBeNull();
  });

  it('survives a stack somebody else wrote', () => {
    // localStorage is writable by any earlier version of this app and by devtools; a
    // malformed entry must not take the history panel down.
    localStorage.setItem(`builderforce:create:${SESSION}:checkpoints`, '{ not json');
    expect(readLocalCheckpoints(SESSION)).toEqual([]);
    localStorage.setItem(`builderforce:create:${SESSION}:checkpoints`, JSON.stringify({ version: 1, checkpoints: [{ id: 'x' }, null, checkpoint('ok', '2026-08-01T00:00:00.000Z')] }));
    expect(readLocalCheckpoints(SESSION).map((entry) => entry.id)).toEqual(['ok']);
  });
});

describe('a board that goes away takes its checkpoints with it', () => {
  const snapshot = (sessionId: string) => {
    writeLocalCreationSession(sessionId, { version: 1, title: sessionId, nodes: [], edges: [], updatedAt: '2026-08-19T00:00:00.000Z' });
    saveLocalCheckpoint(sessionId, `${sessionId} work`, board(2));
  };

  it('sweeps the stack when the board is claimed or deleted', () => {
    // A sidecar that outlives its board is a permanent leak against the same tiny quota
    // the checkpoint store already has to shed against — and it would resurface attached
    // to a board it is not about if an id were ever reused.
    snapshot(SESSION);
    removeLocalCreationSession(SESSION);
    expect(localCheckpointSummaries(SESSION)).toEqual([]);
  });

  it('sweeps ONLY that board', () => {
    snapshot(SESSION);
    snapshot('local-other');
    removeLocalCreationSession(SESSION);
    expect(localCheckpointSummaries('local-other')).toHaveLength(1);
  });
});
