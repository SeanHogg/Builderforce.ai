import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
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
import { normalizeFailureMessage, runCampaignBatch, SENDER_FAILURE_STREAK, STALE_CLAIM_ERROR } from './send';

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
/** A Drizzle `sql` fragment rendered to text + bind params, so a test can assert the COUNT written. */
const rendered = (value: unknown) => new PgDialect().sqlToQuery(value as SQL);

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
      [{ id: 2 }, { id: 3 }],     // queued rows settled (the two never attempted)
      [{ id: 99 }],               // `sending` rows settled (another runner's claim)
      [],                         // the campaign flipped to failed
    ]);
    const result = await run(env, db);

    expect(send).toHaveBeenCalledTimes(1);          // rows 2 and 3 are never attempted
    // `failed` agrees with the ledger: row 1 + the 2 queued rows + the 1 `sending` row settled.
    expect(result).toMatchObject({ sent: 0, failed: 4, remaining: 0, status: 'failed' });
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
    expect(rendered(payload(campaign!).failed).params).toEqual([4]);
    expect(rendered(payload(campaign!).sent).params).toEqual([0]);
    expect(queuedSettle).toBeDefined();
    expect(sendingSettle).toBeDefined();
    // The queued settle is counted from RETURNING, so it must ask for it.
    expect(queuedSettle!.chain).toContain('returning');
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
    expect(rendered(payload(updates(db).at(-1)!).failed).params).toEqual([3]);
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
    expect(rendered(payload(writes[2]!).sent).params).toEqual([1]);
    expect(rendered(payload(writes[2]!).failed).params).toEqual([1]);
  });

  it('also fails the campaign (and settles `sending` rows) when the sender cannot be resolved at all', async () => {
    vi.mocked(resolveCampaignSender).mockResolvedValue({ ok: false, error: 'That mailbox needs to be reconnected.' });
    const db = fakeDb([[sendingCampaign], [], [{ id: 5 }, { id: 6 }], []]);
    const result = await run(kvEnv().env, db);
    expect(result).toMatchObject({ status: 'failed', remaining: 0, failed: 2 });
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

// ---------------------------------------------------------------------------
// The sender-level circuit breaker, the no-response stop, and the finish rules
// ---------------------------------------------------------------------------

/** The failure a bad From produces: a per-message 400 that quotes the recipient. */
const badFrom = (i: number) =>
  new TransportError(`Twilio returned 400: 21999 The From is not usable for +1415555${String(1000 + i)}`, false, 'recipient');

/** Queue entries for a run of recipients that each claim and write back. */
const claimAndWriteBack = (rowIds: number[]): unknown[][] => rowIds.flatMap((id) => [[{ id }], [{ id }]]);
const ids = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('normalizeFailureMessage', () => {
  it('removes the recipient so the same failure compares equal across recipients', () => {
    const a = normalizeFailureMessage("Twilio returned 400: 21211 The 'To' number +1 (415) 555-0100 is not valid");
    const b = normalizeFailureMessage("Twilio returned 400: 21211 The 'To' number +14155550199 is not valid");
    expect(a).toBe(b);
    expect(normalizeFailureMessage('Rejected jane@x.com: bad From')).toBe(normalizeFailureMessage('Rejected bob@y.org: bad From'));
  });

  it('keeps the discriminating part: an HTTP status and a short error code', () => {
    expect(normalizeFailureMessage('Twilio returned 400: 21211 x')).not.toBe(normalizeFailureMessage('Twilio returned 400: 21614 x'));
    expect(normalizeFailureMessage('Twilio returned 400: 21211 x')).toContain('21211');
  });
});

describe('the sender-failure breaker', () => {
  it('escalates N identical recipient failures in a row, with nothing sent, to a sender failure', async () => {
    send.mockImplementation(async () => { throw badFrom(send.mock.calls.length); });
    const total = SENDER_FAILURE_STREAK + 2;
    const db = fakeDb([
      [sendingCampaign], [], ids(total).map((id) => recipient(id)),
      ...claimAndWriteBack(ids(SENDER_FAILURE_STREAK)),
      [{ id: 11 }, { id: 12 }],   // queued rows settled by failCampaign
      [],                         // `sending` rows
      [],                         // the campaign
    ]);
    const { env, puts } = kvEnv();
    const result = await run(env, db);

    expect(send).toHaveBeenCalledTimes(SENDER_FAILURE_STREAK);   // the two after the trip are never attempted
    // 10 rows written off one by one + the 2 queued rows the campaign failure settled.
    expect(result).toMatchObject({ sent: 0, failed: SENDER_FAILURE_STREAK + 2, remaining: 0, status: 'failed' });
    expect(puts).toEqual([]);
    const campaign = updates(db).at(-1)!;
    expect(payload(campaign)).toMatchObject({ status: 'failed' });
    // The unattempted rows say WHY, and the reason names the pattern.
    const queuedSettle = updates(db).at(-3)!;
    expect(String(payload(queuedSettle).error)).toContain('in a row');
    expect(String(payload(queuedSettle).error)).toContain('21999');
  });

  it('does NOT trip on a run of bad numbers whose messages differ', async () => {
    send.mockImplementation(async () => {
      throw new TransportError(`Twilio returned 400: 2121${send.mock.calls.length % 3} bad`, false, 'recipient');
    });
    const total = SENDER_FAILURE_STREAK + 2;
    const db = fakeDb([
      [sendingCampaign], [], ids(total).map((id) => recipient(id)),
      ...claimAndWriteBack(ids(total)),
      [{ remaining: 40, queuedLeft: 40 }], [],
    ]);
    const result = await run(kvEnv().env, db);
    expect(send).toHaveBeenCalledTimes(total);
    expect(result).toMatchObject({ sent: 0, failed: total, status: 'sending' });
  });

  it('does NOT trip when a send succeeded in the batch, however many identical failures follow', async () => {
    send.mockResolvedValueOnce({});
    send.mockImplementation(async () => { throw badFrom(send.mock.calls.length); });
    const total = SENDER_FAILURE_STREAK + 3;
    const db = fakeDb([
      [sendingCampaign], [], ids(total).map((id) => recipient(id)),
      ...claimAndWriteBack(ids(total)),
      [{ remaining: 40, queuedLeft: 40 }], [],
    ]);
    const result = await run(kvEnv().env, db);
    expect(send).toHaveBeenCalledTimes(total);
    expect(result).toMatchObject({ sent: 1, failed: total - 1, status: 'sending' });
  });

  it('does NOT trip when the identical failures are interleaved with sends', async () => {
    let n = 0;
    send.mockImplementation(async () => { n += 1; if (n % 2 === 0) return {}; throw badFrom(n); });
    const total = SENDER_FAILURE_STREAK * 2;
    const db = fakeDb([
      [sendingCampaign], [], ids(total).map((id) => recipient(id)),
      ...claimAndWriteBack(ids(total)),
      [{ remaining: 40, queuedLeft: 40 }], [],
    ]);
    const result = await run(kvEnv().env, db);
    expect(send).toHaveBeenCalledTimes(total);
    expect(result.status).toBe('sending');
  });

  it('never counts a carrier STOP (identical across recipients by nature)', async () => {
    vi.mocked(resolveCampaignSender).mockResolvedValue({
      ok: true, sender: { transport: 'twilio', channel: 'sms', fromLabel: '+14155551234', send },
    });
    send.mockImplementation(async () => {
      throw new TransportError('Twilio returned 400: 21610 Attempt to send to unsubscribed recipient', false, 'recipient');
    });
    const total = SENDER_FAILURE_STREAK + 2;
    const rows = ids(total).map((id) => ({ ...recipient(id), phone: `+1415555${1000 + id}` }));
    const db = fakeDb([
      [{ ...sendingCampaign, channel: 'sms' }], [], rows,
      // each STOP also flips the member's phone_status: claim, member update, write-back
      ...ids(total).flatMap((id) => [[{ id }], [], [{ id }]]),
      [{ remaining: 40, queuedLeft: 40 }], [],
    ]);
    const result = await run(kvEnv().env, db);
    expect(send).toHaveBeenCalledTimes(total);
    expect(result.status).toBe('sending');
  });

  it('never counts a known per-recipient Twilio code: a run of landline numbers fails each row, not the campaign', async () => {
    vi.mocked(resolveCampaignSender).mockResolvedValue({
      ok: true, sender: { transport: 'twilio', channel: 'sms', fromLabel: '+14155551234', send },
    });
    send.mockImplementation(async () => {
      throw new TransportError('Twilio returned 400: 21614 To is not a mobile number', false, 'recipient');
    });
    const total = SENDER_FAILURE_STREAK + 2;
    const rows = ids(total).map((id) => ({ ...recipient(id), phone: `+1415555${1000 + id}` }));
    const db = fakeDb([
      [{ ...sendingCampaign, channel: 'sms' }], [], rows,
      ...claimAndWriteBack(ids(total)),
      [{ remaining: 40, queuedLeft: 40 }], [],
    ]);
    const result = await run(kvEnv().env, db);
    expect(send).toHaveBeenCalledTimes(total);   // every recipient was attempted; the breaker never tripped
    expect(result).toMatchObject({ sent: 0, failed: total, status: 'sending' });
    // Each row was failed individually, and no statement failed the campaign.
    expect(updates(db).filter((c) => payload(c).status === 'failed')).toHaveLength(total);
  });
});

describe('a provider that does not answer', () => {
  const timeout = () => new TransportError('Upstream did not respond within 20s', true, 'recipient', true);

  it('stops the batch at the first no-response failure and requeues that row; the rest are never claimed', async () => {
    send.mockRejectedValue(timeout());
    const { env, puts } = kvEnv();
    const db = fakeDb([
      [sendingCampaign], [], ids(5).map((id) => recipient(id)),
      [{ id: 1 }], [{ id: 1 }],   // row 1: claim (its attempt is consumed: it WAS tried), write-back
      [{ remaining: 9, queuedLeft: 9 }], [],
    ]);
    const result = await run(env, db);

    expect(send).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ sent: 0, failed: 0, status: 'sending', stopped: 'no_response' });
    const writes = updates(db);
    // One claim and one requeue, then the campaign counters: rows 2..5 were never touched.
    expect(writes.filter((c) => payload(c).status === 'sending')).toHaveLength(1);
    expect(writes.filter((c) => payload(c).status === 'queued')).toHaveLength(1);
    // A requeue-only batch must not signal.
    expect(puts).toEqual([]);
  });

  it('reads the queued rows least-attempted first, then by id, so an outage gives every recipient one try before any gets two', async () => {
    send.mockResolvedValue({});
    const db = fakeDb([[sendingCampaign], [], [], [{ remaining: 0, queuedLeft: 0 }], []]);
    await run(kvEnv().env, db);
    const read = db.calls.filter((c) => c.kind === 'select' && c.orderBy)[0]!;
    const order = read.orderBy!.map((o) => rendered(o).sql);
    expect(order).toHaveLength(2);
    expect(order[0]).toMatch(/"attempts" asc$/);
    expect(order[1]).toMatch(/"id" asc$/);
  });

  it('is a retryable failure: below the ceiling it is requeued, at the ceiling it is written off', async () => {
    send.mockRejectedValue(timeout());
    const below = fakeDb([[sendingCampaign], [], [recipient(1, 0)], [{ id: 1 }], [{ id: 1 }], [{ remaining: 1, queuedLeft: 1 }], []]);
    await run(kvEnv().env, below);
    expect(payload(updates(below)[1]!)).toMatchObject({ status: 'queued' });

    const atCeiling = fakeDb([[sendingCampaign], [], [recipient(1, 2)], [{ id: 1 }], [{ id: 1 }], [{ remaining: 1, queuedLeft: 1 }], []]);
    const result = await run(kvEnv().env, atCeiling);
    expect(payload(updates(atCeiling)[1]!)).toMatchObject({ status: 'failed' });
    expect(result).toMatchObject({ failed: 1, stopped: 'no_response' });
  });
});

describe('finishing the campaign', () => {
  it('reads `failed`, not `sent`, when it finishes with nothing delivered and rows failed', async () => {
    send.mockRejectedValue(recipientRefused());
    const db = fakeDb([
      [sendingCampaign], [], [recipient(1)], [{ id: 1 }], [{ id: 1 }],
      [{ remaining: 0, queuedLeft: 0 }],
      [{ status: 'failed' }],   // what the finishing UPDATE ... RETURNING reads back
    ]);
    const result = await run(kvEnv().env, db);
    expect(result).toMatchObject({ sent: 0, failed: 1, remaining: 0, status: 'failed' });

    const finish = rendered(payload(updates(db).at(-1)!).status);
    expect(finish.sql).toContain('failed');
    expect(finish.sql).toContain('sent');
  });

  it('falls back to `failed` for a zero-sent finish even if the row does not come back', async () => {
    send.mockRejectedValue(recipientRefused());
    const db = fakeDb([[sendingCampaign], [], [recipient(1)], [{ id: 1 }], [{ id: 1 }], [{ remaining: 0, queuedLeft: 0 }], []]);
    expect((await run(kvEnv().env, db)).status).toBe('failed');
  });

  it('still reads `sent` when something was delivered', async () => {
    send.mockResolvedValueOnce({}).mockRejectedValueOnce(recipientRefused());
    const db = fakeDb([
      [sendingCampaign], [], [recipient(1), recipient(2)], ...claimAndWriteBack([1, 2]),
      [{ remaining: 0, queuedLeft: 0 }], [],
    ]);
    expect((await run(kvEnv().env, db)).status).toBe('sent');
  });

  it('flips to a finished status only while the campaign is still `sending`, and always lands the counters', async () => {
    send.mockResolvedValue({});
    const db = fakeDb([[sendingCampaign], [], [recipient(1)], [{ id: 1 }], [{ id: 1 }], [{ remaining: 0, queuedLeft: 0 }], [{ status: 'failed' }]]);
    const result = await run(kvEnv().env, db);
    const finish = updates(db).at(-1)!;
    // A concurrent batch had already failed the campaign: the result reflects what the row reads.
    expect(result.status).toBe('failed');
    expect(rendered(payload(finish).status).sql).toContain("<> 'sending'");
    expect(rendered(payload(finish).completedAt).sql).toContain("= 'sending'");
    expect(rendered(payload(finish).sent).params).toEqual([1]);
    expect(rendered(payload(finish).failed).params).toEqual([0]);
  });
});
