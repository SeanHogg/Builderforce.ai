import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../env';
import type { Db } from '../../../infrastructure/database/connection';
import { __clearL1CacheForTests } from '../../../infrastructure/cache/readThroughCache';
import { captureSpecialistSample, MAX_CAPTURED_REQUEST_CHARS } from './evalCaseStore';

const ON = { COST_LEVER_E2_SPECIALISTS: '10' } as unknown as Env;
const OFF = { COST_LEVER_E2_SPECIALISTS: 'off' } as unknown as Env;

const request = { messages: [{ role: 'system' as const, content: 'compress' }, { role: 'user' as const, content: 'transcript' }], max_tokens: 700 };

/** A Db stand-in recording the insert; `held` is what the case count reads. */
function fakeDb(held: number) {
  const values = vi.fn(() => ({ onConflictDoNothing: vi.fn(async () => undefined) }));
  const db = {
    select: () => ({ from: () => ({ where: async () => [{ n: held }] }) }),
    insert: vi.fn(() => ({ values })),
  };
  return { db: db as unknown as Db, insert: db.insert, values };
}

beforeEach(() => __clearL1CacheForTests());

describe('captureSpecialistSample', () => {
  it('captures nothing with the lever fully off, without a tenant, or outside the sample draw', async () => {
    const { db, insert } = fakeDb(0);
    await captureSpecialistSample(OFF, { jobId: 'compaction_summary', tenantId: 7, request }, { db, random: () => 0 });
    await captureSpecialistSample(ON, { jobId: 'compaction_summary', tenantId: null, request }, { db, random: () => 0 });
    await captureSpecialistSample(ON, { jobId: 'compaction_summary', tenantId: 7, request }, { db, random: () => 0.99 });
    expect(insert).not.toHaveBeenCalled();
  });

  it('stops once the job holds its cap', async () => {
    const { db, insert } = fakeDb(25);
    await captureSpecialistSample(ON, { jobId: 'compaction_summary', tenantId: 7, request }, { db, random: () => 0 });
    expect(insert).not.toHaveBeenCalled();
  });

  it('skips a request too large to replay', async () => {
    const { db, insert } = fakeDb(0);
    const big = { messages: [{ role: 'user' as const, content: 'x'.repeat(MAX_CAPTURED_REQUEST_CHARS) }] };
    await captureSpecialistSample(ON, { jobId: 'compaction_summary', tenantId: 7, request: big }, { db, random: () => 0 });
    expect(insert).not.toHaveBeenCalled();
  });

  it('stores only the replayable fields, redacted, keyed by job + input hash', async () => {
    const { db, values } = fakeDb(0);
    const withSecret = { ...request, messages: [...request.messages, { role: 'user' as const, content: 'key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789' }], stream: true } as typeof request;
    await captureSpecialistSample(ON, { jobId: 'compaction_summary', tenantId: 7, request: withSecret }, { db, random: () => 0 });
    expect(values).toHaveBeenCalledTimes(1);
    const row = (values.mock.calls[0] as unknown as [{ tenantId: number; jobId: string; inputHash: string; request: string }])[0];
    expect(row).toMatchObject({ tenantId: 7, jobId: 'compaction_summary' });
    expect(row.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.request).not.toContain('"stream"');
    expect(row.request).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789');
  });

  it('never throws when the write fails', async () => {
    const db = { select: () => ({ from: () => ({ where: async () => { throw new Error('neon down'); } }) }) } as unknown as Db;
    await expect(captureSpecialistSample(ON, { jobId: 'compaction_summary', tenantId: 7, request }, { db, random: () => 0 })).resolves.toBeUndefined();
  });
});
