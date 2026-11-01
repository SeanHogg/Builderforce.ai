import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { fakeDb } from '../../../../test/fakeDb';
import type { Db } from '../../../infrastructure/database/connection';
import type { Env } from '../../../env';

/**
 * `runCampaignBatch`'s handling of a failed send, where WHOSE failure it is decides what happens
 * next. The sender is replaced (its classification is pinned in `campaignTransports.scope.test.ts`),
 * so each test says exactly which kind of `TransportError` the transport throws.
 */
vi.mock('../campaignTransports', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../campaignTransports')>()),
  resolveCampaignSender: vi.fn(),
}));
vi.mock('../../observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));

import { resolveCampaignSender, TransportError } from '../campaignTransports';
import { runCampaignBatch, STALE_CLAIM_ERROR } from './send';

const ORIGIN = 'https://builderforce.ai/gateway';
const sendingCampaign = {
  id: 1, status: 'sending', subject: 'Hello', bodyHtml: '<p>Hi</p>', bodyText: '', audienceId: 11,
  channel: 'email', transport: 'platform', mailboxConnectionId: null, connectorConnectionId: null,
  fromName: '', fromNumber: null, senderIdentityId: 5,
  senderFromEmail: 'hi@acme.com', senderFromName: 'Acme', senderStatus: 'verified',
};
const recipient = (id: number, attempts = 0) => ({
  id, email: `r${id}@x.com`, phone: null, trackToken: `t${id}`, attempts, name: '', attributes: {},
});

const send = vi.fn();
const useSender = () =>
  vi.mocked(resolveCampaignSender).mockResolvedValue({
    ok: true,
    sender: { transport: 'platform', channel: 'email', fromLabel: 'Acme <hi@acme.com>', send },
  });

const kvEnv = () => {
  const puts: string[] = [];
  const kv = { get: async () => null, put: async (k: string) => { puts.push(k); }, delete: async () => undefined } as unknown as KVNamespace;
  return { env: { AUTH_CACHE_KV: kv } as Env, puts };
};

const run = (env: Env, db: ReturnType<typeof fakeDb>) =>
  runCampaignBatch(env, db as unknown as Db, 7, 1, { trackingOrigin: ORIGIN });

/** The statements that wrote to the send ledger or the campaign, in order. */
const updates = (db: ReturnType<typeof fakeDb>) => db.calls.filter((c) => c.kind === 'update');
const payload = (call: { payload?: unknown }) => call.payload as Record<string, unknown>;

const recipientRefused = () => new TransportError('Twilio returned 400: 21211 invalid To', false, 'recipient');
const senderDead = () => new TransportError('Twilio returned 401: authenticate', false, 'sender');
const transient = () => new TransportError('Twilio returned 503', true, 'recipient');

beforeEach(() => {
  send.mockReset();
  useSender();
});

describe('a RECIPIENT-level terminal failure', () => {
  it('fails that row and CONTINUES the batch (it says nothing about the next recipient)', async () => {
    send.mockRejectedValueOnce(recipientRefused()).mockResolvedValueOnce({});
    const { env, puts } = kvEnv();
    const db = fakeDb([
      [sendingCampaign], [], [recipient(1), recipient(2)],
      [{ id: 1 }], [{ id: 1 }],   // row 1: claim, write-back (failed)
      [{ id: 2 }], [{ id: 2 }],   // row 2: claim, write-back (sent)
      [{ remaining: 8, queuedLeft: 8 }], [],
    ]);
    const result = await run(env, db);
    expect(send).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ sent: 1, failed: 1, remaining: 8, status: 'sending' });
    const [, firstWriteBack] = updates(db);
    expect(payload(firstWriteBack!)).toMatchObject({ status: 'failed' });
    expect(String(payload(firstWriteBack!).error)).toContain('21211');
    expect(puts).toEqual(['cron:work-pending']);
  });

  it('SIGNALS when the very first row failed and nothing was sent: that row is settled for good', async () => {
    // The old rule needed `sent > 0`, so a bad number in the first row meant no signal, and the
    // rest of the campaign waited out the floor cadence.
    send.mockRejectedValueOnce(recipientRefused());
    const { env, puts } = kvEnv();
    const db = fakeDb([[sendingCampaign], [], [recipient(1)], [{ id: 1 }], [{ id: 1 }], [{ remaining: 5, queuedLeft: 5 }], []]);
    const result = await run(env, db);
    expect(result).toMatchObject({ sent: 0, failed: 1, status: 'sending' });
    expect(puts).toEqual(['cron:work-pending']);
  });

  it('does not count a failure whose row was reaped meanwhile (the reaper already counted it)', async () => {
    send.mockRejectedValueOnce(recipientRefused());
    const { env, puts } = kvEnv();
    const db = fakeDb([[sendingCampaign], [], [recipient(1)], [{ id: 1 }], [], [{ remaining: 5, queuedLeft: 5 }], []]);
    const result = await run(env, db);
    expect(result).toMatchObject({ sent: 0, failed: 0 });
    expect(puts).toEqual([]);
  });
});

describe('a SENDER-level terminal failure', () => {
  it('fails the campaign, stops retrying the dead sender, and does not signal', async () => {
    send.mockRejectedValue(senderDead());
    const { env, puts } = kvEnv();
    const db = fakeDb([
      [sendingCampaign], [], [recipient(1), recipient(2), recipient(3)],
      [{ id: 1 }], [{ id: 1 }],   // row 1: claim, write-back (failed, with the real error)
      [],                         // queued rows settled
      [{ id: 99 }],               // `sending` rows settled (another runner's claim)
      [],                         // the campaign flipped to failed
    ]);
    const result = await run(env, db);

    expect(send).toHaveBeenCalledTimes(1);          // rows 2 and 3 are never attempted
    expect(result).toMatchObject({ sent: 0, failed: 1, remaining: 0, status: 'failed' });
    expect(puts).toEqual([]);
    // The tail is not the count query: a failed campaign has nothing left to measure.
    expect(db.calls.filter((c) => c.kind === 'select')).toHaveLength(3);

    const [claim, writeBack, queuedSettle, sendingSettle, campaign] = updates(db);
    expect(payload(claim!)).toMatchObject({ status: 'sending' });
    expect(payload(writeBack!)).toMatchObject({ status: 'failed' });
    expect(String(payload(writeBack!).error)).toContain('401');
    // The rows nobody attempted say WHY they were never contacted.
    expect(payload(queuedSettle!)).toMatchObject({ status: 'failed' });
    expect(String(payload(queuedSettle!).error)).toContain('401');
    expect(payload(campaign!)).toMatchObject({ status: 'failed' });
    expect(payload(campaign!)).toHaveProperty('completedAt');
    expect(payload(campaign!)).toHaveProperty('failed');
    expect(payload(campaign!)).toHaveProperty('sent');
    expect(queuedSettle).toBeDefined();
    expect(sendingSettle).toBeDefined();
  });

  it('settles rows still `sending` in the same path: a failed campaign is never swept again', async () => {
    send.mockRejectedValue(senderDead());
    const db = fakeDb([[sendingCampaign], [], [recipient(1)], [{ id: 1 }], [{ id: 1 }], [], [{ id: 98 }, { id: 99 }], []]);
    await run(kvEnv().env, db);
    const settles = updates(db).filter((c) => payload(c).error === STALE_CLAIM_ERROR);
    expect(settles).toHaveLength(1);
    expect(payload(settles[0]!)).toMatchObject({ status: 'failed' });
    // …scoped to `sending` rows of THIS campaign and tenant.
    const { sql: text, params } = new PgDialect().sqlToQuery(settles[0]!.where as Parameters<PgDialect['sqlToQuery']>[0]);
    expect(text).toContain('"campaign_id" = $');
    expect(text).toContain('"tenant_id" = $');
    expect(params).toEqual(expect.arrayContaining(['sending', 1, 7]));
    // The two rows the settle returned are counted on the campaign (1 from this batch + 2).
    expect(payload(updates(db).at(-1)!)).toHaveProperty('failed');
  });

  it('keeps what the batch had already sent, and settles the order: queued, then sending, then the campaign', async () => {
    send.mockResolvedValueOnce({}).mockRejectedValueOnce(senderDead());
    const db = fakeDb([
      [sendingCampaign], [], [recipient(1), recipient(2), recipient(3)],
      [{ id: 1 }], [{ id: 1 }],   // row 1 sent
      [{ id: 2 }], [{ id: 2 }],   // row 2: sender dead
      [], [], [],
    ]);
    const result = await run(kvEnv().env, db);
    expect(result).toMatchObject({ sent: 1, failed: 1, status: 'failed' });
    const writes = updates(db).slice(4);
    expect(writes.map((c) => payload(c).status)).toEqual(['failed', 'failed', 'failed']);
    expect(writes.map((c) => Object.keys(payload(c)).includes('completedAt'))).toEqual([false, false, true]);
  });

  it('also fails the campaign (and settles `sending` rows) when the sender cannot be resolved at all', async () => {
    vi.mocked(resolveCampaignSender).mockResolvedValue({ ok: false, error: 'That mailbox needs to be reconnected.' });
    const db = fakeDb([[sendingCampaign], [], [{ id: 5 }, { id: 6 }], []]);
    const result = await run(kvEnv().env, db);
    expect(result).toMatchObject({ status: 'failed', remaining: 0 });
    expect(send).not.toHaveBeenCalled();
    const [queuedSettle, sendingSettle, campaign] = updates(db);
    expect(String(payload(queuedSettle!).error)).toContain('reconnected');
    expect(payload(sendingSettle!).error).toBe(STALE_CLAIM_ERROR);
    expect(payload(campaign!)).toMatchObject({ status: 'failed' });
  });
});

describe('a batch that only REQUEUED', () => {
  it('does not signal: nothing was settled for good, so the next batch has no reason to do better', async () => {
    send.mockRejectedValue(transient());
    const { env, puts } = kvEnv();
    const db = fakeDb([
      [sendingCampaign], [], [recipient(1), recipient(2)],
      [{ id: 1 }], [{ id: 1 }], [{ id: 2 }], [{ id: 2 }],
      [{ remaining: 9, queuedLeft: 9 }], [],
    ]);
    const result = await run(env, db);
    expect(result).toMatchObject({ sent: 0, failed: 0, status: 'sending' });
    expect(puts).toEqual([]);
    expect(updates(db).filter((c) => payload(c).status === 'queued')).toHaveLength(2);
  });

  it('is capped: a retryable failure on the last allowed attempt is written off, not requeued forever', async () => {
    send.mockRejectedValue(transient());
    const { env, puts } = kvEnv();
    // attempts is counted at claim, so a row read with 2 is on its third (the ceiling).
    const db = fakeDb([[sendingCampaign], [], [recipient(1, 2)], [{ id: 1 }], [{ id: 1 }], [{ remaining: 4, queuedLeft: 4 }], []]);
    const result = await run(env, db);
    expect(result).toMatchObject({ sent: 0, failed: 1 });
    expect(payload(updates(db)[1]!)).toMatchObject({ status: 'failed' });
    // The write-off is a row settled for good, so it signals: bounded, because it cannot happen twice.
    expect(puts).toEqual(['cron:work-pending']);
  });
});

describe('the write-backs are conditional on the row still being `sending`', () => {
  const whereOf = (call: { where?: unknown }) =>
    new PgDialect().sqlToQuery(call.where as Parameters<PgDialect['sqlToQuery']>[0]);

  it('guards the `sent` write-back, and does not count a row that was reaped meanwhile', async () => {
    send.mockResolvedValue({});
    const { env, puts } = kvEnv();
    const db = fakeDb([[sendingCampaign], [], [recipient(1)], [{ id: 1 }], [], [{ remaining: 3, queuedLeft: 3 }], []]);
    const result = await run(env, db);
    expect(result.sent).toBe(0);
    expect(puts).toEqual([]);
    const { sql: text, params } = whereOf(updates(db)[1]!);
    expect(text).toContain('"status" = $');
    expect(params).toEqual(expect.arrayContaining(['sending']));
  });

  it('guards the failure write-back too', async () => {
    send.mockRejectedValue(transient());
    const db = fakeDb([[sendingCampaign], [], [recipient(1)], [{ id: 1 }], [{ id: 1 }], [{ remaining: 1, queuedLeft: 1 }], []]);
    await run(kvEnv().env, db);
    expect(whereOf(updates(db)[1]!).params).toEqual(expect.arrayContaining(['sending']));
  });
});
