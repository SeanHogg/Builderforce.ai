/**
 * VISITOR_DATA_ERASERS — one registry, every store, a count per eraser.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  forgetVisitorActivity: vi.fn(async () => 4),
  eraseReplayVisitor: vi.fn(async () => 2),
  activityDb: { tag: 'operational' },
  deletedPrompts: 3,
}));

vi.mock('../marketing/visitorActivity', () => ({ forgetVisitorActivity: mocks.forgetVisitorActivity }));
vi.mock('../replay/replayVisitorEraser', () => ({ eraseReplayVisitor: mocks.eraseReplayVisitor }));
vi.mock('../activity/activityLog', () => ({ activityDatabase: vi.fn(() => mocks.activityDb) }));

import { eraseVisitorData, VISITOR_DATA_ERASERS, type VisitorDataEraser } from './visitorDataErasers';

const db = {
  delete: () => ({
    where: () => ({ returning: async () => Array.from({ length: mocks.deletedPrompts }, (_, i) => ({ id: i })) }),
  }),
} as never;
const env = {} as never;

beforeEach(() => {
  mocks.forgetVisitorActivity.mockClear();
  mocks.eraseReplayVisitor.mockClear();
});

describe('VISITOR_DATA_ERASERS', () => {
  it('covers prompts, the journey and replay', () => {
    expect(VISITOR_DATA_ERASERS.map((e) => e.id)).toEqual(['prompts', 'journey', 'replay']);
  });
});

describe('eraseVisitorData', () => {
  it('runs every eraser and reports each count and the total', async () => {
    const result = await eraseVisitorData(env, db, 'visitor_0001');
    expect(result).toEqual({ erased: 9, byEraser: { prompts: 3, journey: 4, replay: 2 } });
    expect(mocks.eraseReplayVisitor).toHaveBeenCalledWith(env, db, 'visitor_0001');
  });

  it('erases the journey on the endpoint the journey is written to', async () => {
    await eraseVisitorData(env, db, 'visitor_0001');
    expect(mocks.forgetVisitorActivity).toHaveBeenCalledWith(mocks.activityDb, 'visitor_0001');
  });

  it('takes a registry, so a new store is one entry', async () => {
    const extra: VisitorDataEraser = { id: 'extra', erase: vi.fn(async () => 1) };
    const result = await eraseVisitorData(env, db, 'v', [extra]);
    expect(result).toEqual({ erased: 1, byEraser: { extra: 1 } });
  });
});
