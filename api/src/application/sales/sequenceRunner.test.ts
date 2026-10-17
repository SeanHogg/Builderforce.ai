import { describe, expect, it, vi } from 'vitest';
import { sequenceDueSteps, sequenceNextDueAt } from '@builderforce/creation-canvas-contract';

vi.mock('../mailbox/mailboxService', () => ({ sendFromMailbox: vi.fn() }));
vi.mock('../social/socialService', () => ({ publishSocialPost: vi.fn(), resolvePublishableAccounts: vi.fn() }));
vi.mock('../activity/activityLog', () => ({ recordActivity: vi.fn(), SYSTEM_ACTOR: { type: 'system' } }));

import { runSequenceSweep } from './sequenceRunner';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const NOW = new Date('2026-10-17T12:00:00.000Z');
const DAY = 86_400_000;

function fakeDb(rows: Array<Record<string, unknown>>) {
  const selects: string[] = [];
  const batches: Array<Array<{ set: Record<string, unknown> }>> = [];
  const chain = (result: unknown) => {
    const p = Promise.resolve(result);
    return Object.assign(p, { innerJoin: () => chain(result), where: () => chain(result), orderBy: () => chain(result), limit: () => p });
  };
  const db = {
    select: (fields: Record<string, unknown>) => {
      const isSweep = 'content' in fields;
      selects.push(isSweep ? 'sweep' : 'other');
      return { from: () => chain(isSweep ? rows : []) };
    },
    update: () => ({ set: (set: Record<string, unknown>) => ({ where: () => ({ set }) }) }),
    batch: async (items: Array<{ set: Record<string, unknown> }>) => { batches.push(items); return []; },
  } as unknown as Db;
  return { db, selects, batches };
}

const sequenceRow = (content: Record<string, unknown>) => ({
  id: 'seq-1', content, geometry: {}, sessionId: 'sess', tenantId: 1, sessionTitle: 'Board',
});

describe('runSequenceSweep — due-time gate', () => {
  it('an idle tick is ONE statement (the indexed due read) and writes nothing', async () => {
    const { db, selects, batches } = fakeDb([]);
    const r = await runSequenceSweep({} as Env, NOW, db);
    expect(selects).toEqual(['sweep']);
    expect(batches).toEqual([]);
    expect(r).toEqual({ sequences: 0, sent: 0, stopped: 0, failed: 0 });
  });

  it('stamps a running cadence with nothing due yet with its next step time, in one batch', async () => {
    const enrolledAt = new Date(NOW.getTime() - DAY);
    const { db, batches } = fakeDb([sequenceRow({
      sequenceState: 'running',
      steps: [{ dayOffset: 2, channel: 'email', subject: 's', body: 'b' }],
      enrolments: [{ contactRef: 'a@x.test', enrolledAtISO: enrolledAt.toISOString(), stepsSent: 0 }],
    })]);
    await runSequenceSweep({} as Env, NOW, db);
    expect(batches).toHaveLength(1);
    expect(batches[0]![0]!.set).toEqual({ nextDueAt: new Date(enrolledAt.getTime() + 2 * DAY) });
  });

  it('parks a cadence nobody will ever be due on far in the future (not NULL, which means "evaluate")', async () => {
    const { db, batches } = fakeDb([sequenceRow({ sequenceState: 'paused', steps: [], enrolments: [] })]);
    await runSequenceSweep({} as Env, NOW, db);
    expect((batches[0]![0]!.set.nextDueAt as Date).getUTCFullYear()).toBe(9999);
  });
});

describe('sequenceNextDueAt', () => {
  const seq = (enrolments: unknown[]) => ({
    state: 'running',
    steps: [{ dayOffset: 0, channel: 'email' }, { dayOffset: 3, channel: 'task' }],
    enrolments,
  });

  it('is the earliest pending step across people, and agrees with sequenceDueSteps', () => {
    const a = new Date(NOW.getTime() - 5 * DAY).toISOString();
    const b = new Date(NOW.getTime() - 1 * DAY).toISOString();
    const s = seq([
      { contactRef: 'a', enrolledAtISO: a, stepsSent: 2 },               // finished
      { contactRef: 'b', enrolledAtISO: b, stepsSent: 1 },               // step 2 at b + 3d
      { contactRef: 'c', enrolledAtISO: a, stepsSent: 0, repliedAtISO: a }, // replied
    ]);
    const next = sequenceNextDueAt(s)!;
    expect(next.getTime()).toBe(Date.parse(b) + 3 * DAY);
    expect(sequenceDueSteps(s, new Date(next.getTime() - 1))).toHaveLength(0);
    expect(sequenceDueSteps(s, next)).toHaveLength(1);
  });

  it('is null when the cadence is not running', () => {
    expect(sequenceNextDueAt({ ...seq([{ contactRef: 'a', enrolledAtISO: NOW.toISOString(), stepsSent: 0 }]), state: 'paused' })).toBeNull();
  });
});
