/**
 * Meeting minutes go through THE condense primitive, now at `llm/condense.ts`: the
 * transcript is joined speaker-by-line, the minutes shape is passed, and the answer
 * is stored on the meeting. An empty transcript never reaches the model.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  condenseTranscript: vi.fn(),
  syncMinutesForMeeting: vi.fn(async () => {}),
}));

vi.mock('../llm/condense', () => ({ condenseTranscript: mocks.condenseTranscript }));
vi.mock('../ceremony/ceremonyMinutesToCanvas', () => ({ syncMinutesForMeeting: mocks.syncMinutesForMeeting }));
vi.mock('../agent/agentPrompt', () => ({ resolveWorkforceModel: vi.fn(), WORKFORCE_MODEL_REF_PREFIX: 'workforce:' }));
vi.mock('../../infrastructure/relay/broadcastRoom', () => ({ broadcastRoom: vi.fn() }));

import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { loadTranscriptSince, summarizeMeeting } from './meetingIntelligence';

function fakeDb(segments: Array<{ speakerName: string; text: string }>) {
  const updates: unknown[] = [];
  const chain = { from: () => chain, where: () => chain, orderBy: () => chain, limit: async () => segments };
  const db = {
    select: () => chain,
    update: () => ({ set: (values: unknown) => ({ where: async () => { updates.push(values); } }) }),
  };
  return { db: db as never, updates };
}

const meeting = { id: 'm1', tenantId: 7, title: 'Standup', kind: 'standup', chatId: null } as never;

beforeEach(() => {
  mocks.condenseTranscript.mockReset();
  mocks.syncMinutesForMeeting.mockClear();
});

describe('summarizeMeeting', () => {
  it('condenses the transcript through llm/condense and stores the minutes', async () => {
    mocks.condenseTranscript.mockResolvedValueOnce({ text: '**Summary** done' });
    const { db, updates } = fakeDb([{ speakerName: 'Ana', text: 'Shipped it' }, { speakerName: 'Bo', text: 'Reviewing' }]);
    const out = await summarizeMeeting(db, {} as never, meeting);
    expect(out).toEqual({ summary: '**Summary** done' });
    expect(mocks.condenseTranscript).toHaveBeenCalledWith({}, 7, expect.objectContaining({
      transcript: 'Ana: Shipped it\nBo: Reviewing',
      header: 'Meeting: "Standup" (standup).',
    }));
    expect(updates[0]).toMatchObject({ summary: '**Summary** done' });
  });

  it('never calls the model for an empty transcript', async () => {
    const { db } = fakeDb([]);
    expect(await summarizeMeeting(db, {} as never, meeting)).toEqual({ error: 'No transcript to summarize yet.' });
    expect(mocks.condenseTranscript).not.toHaveBeenCalled();
  });
});

describe('loadTranscriptSince', () => {
  it("reads the tenant's meeting from a few seconds before the cursor (racing appends), oldest first", async () => {
    const wheres: SQL[] = [];
    const chain = { from: () => chain, where: (cond: SQL) => { wheres.push(cond); return chain; }, orderBy: () => chain, limit: async () => [] };
    await loadTranscriptSince({ select: () => chain } as never, 7, 'm1', 60_000);
    const { sql, params } = new PgDialect().sqlToQuery(wheres[0]!);
    expect(sql).toContain('"tenant_id"');
    expect(sql).toContain('"at_ms" >=');
    expect(params).toEqual(expect.arrayContaining([7, 'm1', 55_000]));
  });
});
