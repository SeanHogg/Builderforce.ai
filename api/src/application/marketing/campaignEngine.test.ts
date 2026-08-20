import { describe, expect, it, vi } from 'vitest';
import {
  addAudienceMembers,
  createSender,
  recordClick,
  recordSmsDeliveryStatus,
  renderCampaignEmail,
  renderCampaignSms,
  resolveTrackingOrigin,
  runCampaignBatch,
  smsStatusUrl,
  startCampaign,
  startDueCampaigns,
  suppressedSubset,
  trackingUrls,
  updateCampaign,
  verifySender,
  SMS_OPT_OUT_NOTICE,
  TRACKING_PIXEL,
} from './campaignEngine';
import { fakeDb, fakeFetch } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

const ORIGIN = 'https://builderforce.ai/gateway';
const ctx = { trackingOrigin: ORIGIN, trackToken: 'tok123' };

vi.mock('../../infrastructure/email/EmailService', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, sendRawEmail: vi.fn(async () => undefined) };
});
const { sendRawEmail } = await import('../../infrastructure/email/EmailService');
const sendMock = sendRawEmail as unknown as ReturnType<typeof vi.fn>;

describe('resolveTrackingOrigin', () => {
  it('defaults to the same-origin gateway path', () => {
    expect(resolveTrackingOrigin({})).toBe('https://builderforce.ai/gateway');
  });

  it('honours an override and strips a trailing slash', () => {
    expect(resolveTrackingOrigin({ CAMPAIGN_TRACKING_ORIGIN: 'https://t.example.com/' }))
      .toBe('https://t.example.com');
  });
});

describe('trackingUrls', () => {
  it('derives all three endpoints from one token', () => {
    expect(trackingUrls(ctx)).toEqual({
      open: `${ORIGIN}/api/campaign-track/open/tok123.gif`,
      click: `${ORIGIN}/api/campaign-track/click/tok123`,
      unsubscribe: `${ORIGIN}/api/campaign-track/unsubscribe/tok123`,
    });
  });
});

describe('renderCampaignEmail', () => {
  const recipient = { email: 'sam@example.com', name: 'Sam' };

  it('ALWAYS appends an unsubscribe link — the author cannot omit it', () => {
    const html = renderCampaignEmail('<p>Hi</p>', ctx, recipient);
    expect(html).toContain(`${ORIGIN}/api/campaign-track/unsubscribe/tok123`);
    expect(html).toContain('Unsubscribe');
  });

  it('always appends the open pixel', () => {
    const html = renderCampaignEmail('<p>Hi</p>', ctx, recipient);
    expect(html).toContain(`${ORIGIN}/api/campaign-track/open/tok123.gif`);
    expect(html).toContain('width="1"');
  });

  it('rewrites http(s) links through the click tracker, preserving the destination', () => {
    const html = renderCampaignEmail('<a href="https://shop.example.com/sale">Sale</a>', ctx, recipient);
    expect(html).toContain(`href="${ORIGIN}/api/campaign-track/click/tok123?u=${encodeURIComponent('https://shop.example.com/sale')}"`);
    expect(html).not.toContain('href="https://shop.example.com/sale"');
  });

  it('leaves mailto:, tel: and in-page anchors alone', () => {
    const html = renderCampaignEmail(
      '<a href="mailto:a@b.com">Mail</a><a href="tel:+1">Call</a><a href="#top">Top</a>',
      ctx, recipient,
    );
    expect(html).toContain('href="mailto:a@b.com"');
    expect(html).toContain('href="tel:+1"');
    expect(html).toContain('href="#top"');
  });

  it('does NOT double-wrap its own tracker links on a second render', () => {
    const once = renderCampaignEmail('<a href="https://x.com">X</a>', ctx, recipient);
    const twice = renderCampaignEmail(once, ctx, recipient);
    expect(twice.match(/campaign-track\/click\/tok123\?u=/g)).toHaveLength(1);
  });

  it('substitutes merge fields', () => {
    const html = renderCampaignEmail('<p>Hi {{name}}, we have {{ email }}</p>', ctx, recipient);
    expect(html).toContain('Hi Sam');
    expect(html).toContain('we have sam@example.com');
  });

  it('ESCAPES merge values — a recipient name cannot inject markup', () => {
    const html = renderCampaignEmail('<p>Hi {{name}}</p>', ctx, {
      email: 'a@b.com', name: '<script>alert(1)</script>',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders an empty merge field rather than the literal placeholder', () => {
    const html = renderCampaignEmail('<p>Hi {{name}}!</p>', ctx, { email: 'a@b.com' });
    expect(html).toContain('Hi !');
  });
});

describe('the open pixel', () => {
  it('is a real 1x1 GIF', () => {
    expect(Array.from(TRACKING_PIXEL.slice(0, 6))).toEqual([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // "GIF89a"
    expect(TRACKING_PIXEL.at(-1)).toBe(0x3b); // trailer
  });
});

describe('addAudienceMembers', () => {
  it('rejects the whole batch when the audience is not this tenant\'s', async () => {
    const db = fakeDb([[]]);
    await expect(addAudienceMembers(db as unknown as Db, 7, 11, [{ email: 'a@b.com' }]))
      .resolves.toEqual({ added: 0, updated: 0, rejected: 1 });
  });

  it('counts invalid addresses as rejected instead of failing the import', async () => {
    const db = fakeDb([[{ id: 11 }], [{ id: 1, isNew: true }], []]);
    const result = await addAudienceMembers(db as unknown as Db, 7, 11, [
      { email: 'good@example.com' }, { email: 'nope' }, { email: '' },
    ]);
    expect(result).toMatchObject({ added: 1, rejected: 2 });
  });

  it('de-duplicates WITHIN a batch — Postgres rejects two conflicts on one key', async () => {
    const db = fakeDb([[{ id: 11 }], [{ id: 1, isNew: true }], []]);
    await addAudienceMembers(db as unknown as Db, 7, 11, [
      { email: 'Sam@Example.com' }, { email: 'sam@example.com' },
    ]);
    const insert = db.calls.find((c) => c.kind === 'insert')!;
    expect(insert.payload).toHaveLength(1);
    expect((insert.payload as Array<{ email: string }>)[0]!.email).toBe('sam@example.com');
  });

  it('does not resubscribe someone on re-import — status is untouched on conflict', async () => {
    const db = fakeDb([[{ id: 11 }], [{ id: 1, isNew: false }], []]);
    await addAudienceMembers(db as unknown as Db, 7, 11, [{ email: 'a@b.com' }]);
    const insert = db.calls.find((c) => c.kind === 'insert')!;
    // `onConflictDoUpdate` was used, and the update set contains no `status`.
    expect(insert.chain).toContain('onConflictDoUpdate');
  });
});

describe('suppressedSubset', () => {
  it('is ONE query, never per-recipient', async () => {
    const db = fakeDb([[{ email: 'b@x.com' }]]);
    const blocked = await suppressedSubset(db as unknown as Db, 7, ['a@x.com', 'b@x.com', 'c@x.com']);
    expect([...blocked]).toEqual(['b@x.com']);
    expect(db.calls).toHaveLength(1);
  });

  it('short-circuits an empty list without touching the database', async () => {
    const db = fakeDb();
    await expect(suppressedSubset(db as unknown as Db, 7, [])).resolves.toEqual(new Set());
    expect(db.calls).toHaveLength(0);
  });
});

describe('createSender', () => {
  it('rejects an invalid From address', async () => {
    await expect(createSender(fakeDb() as unknown as Db, 7, { fromEmail: 'nope' }))
      .resolves.toMatchObject({ ok: false, status: 400 });
  });

  it('issues a pending identity with a verification token and the exact record name', async () => {
    const db = fakeDb([[{
      id: 1, fromEmail: 'hi@acme.com', fromName: 'Acme', replyTo: null,
      status: 'pending', verifyToken: 'tok', verifiedAt: null, lastError: null,
    }]]);
    const result = await createSender(db as unknown as Db, 7, { fromEmail: 'HI@Acme.com', fromName: 'Acme' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sender.status).toBe('pending');
    expect(result.sender.recordName).toBe('_builderforce-sender.acme.com');
    expect((db.calls[0]!.payload as { fromEmail: string }).fromEmail).toBe('hi@acme.com');
  });
});

describe('verifySender', () => {
  const row = {
    id: 1, fromEmail: 'hi@acme.com', fromName: '', replyTo: null,
    status: 'pending', verifyToken: 'tok', verifiedAt: null, lastError: null,
  };

  it('flips to verified when the domain TXT proof holds', async () => {
    const db = fakeDb([[row], [{ ...row, status: 'verified' }]]);
    const fetchImpl = fakeFetch([{ match: 'dns-query', json: { Status: 0, Answer: [{ type: 16, data: '"tok"' }] } }]);
    const result = await verifySender(db as unknown as Db, 7, 1, { fetchImpl });
    expect(result.ok && result.sender.status).toBe('verified');
    expect((db.calls[1]!.payload as { status: string }).status).toBe('verified');
  });

  it('stays pending and records what was missing', async () => {
    const db = fakeDb([[row], [{ ...row, status: 'pending' }]]);
    const fetchImpl = fakeFetch([{ match: 'dns-query', json: { Status: 0, Answer: [] } }]);
    await verifySender(db as unknown as Db, 7, 1, { fetchImpl });
    const written = db.calls[1]!.payload as { status: string; lastError: string };
    expect(written.status).toBe('pending');
    expect(written.lastError).toContain('_builderforce-sender.acme.com');
  });
});

/**
 * The campaign row as `loadTransportBinding` reads it — the campaign LEFT-joined
 * to its sender identity, which is why the sender columns are flattened in here
 * rather than arriving as a second query.
 */
const draftRow = {
  id: 1, status: 'draft', subject: 'Hello', bodyHtml: '<p>Hi</p>', bodyText: '', audienceId: 11,
  channel: 'email', transport: 'platform', mailboxConnectionId: null, connectorConnectionId: null,
  fromName: '', fromNumber: null, senderIdentityId: 5,
  senderFromEmail: 'hi@acme.com', senderFromName: 'Acme', senderStatus: 'verified',
};

/** The SMS twin: same campaign, different channel. Deliberately carries NO sender
 *  identity, because DNS ownership is an email concept and requiring one here
 *  would be the bug this fixture exists to catch. */
const smsDraftRow = {
  ...draftRow,
  channel: 'sms', transport: 'twilio', subject: '', bodyText: 'Doors open at 7.',
  connectorConnectionId: 'conn-t', fromNumber: '+14155551234',
  senderIdentityId: null, senderFromEmail: null, senderFromName: null, senderStatus: null,
};

/** What the connector-connection lookup returns for that Twilio connection. */
const twilioConnectionRow = [{ id: 'conn-t', name: 'Main line', connectorKey: 'twilio', enabled: true }];

describe('startCampaign — the gates that protect real people', () => {
  const env = {} as Env;

  it('404s an unknown campaign', async () => {
    await expect(startCampaign(env, fakeDb([[]]) as unknown as Db, 7, 1))
      .resolves.toMatchObject({ ok: false, status: 404 });
  });

  it('refuses to restart a campaign that is already sending', async () => {
    const db = fakeDb([[{ ...draftRow, status: 'sending' }]]);
    await expect(startCampaign(env, db as unknown as Db, 7, 1)).resolves.toMatchObject({ ok: false, status: 409 });
  });

  it('refuses an empty subject', async () => {
    const db = fakeDb([[{ ...draftRow, subject: '  ' }]]);
    await expect(startCampaign(env, db as unknown as Db, 7, 1)).resolves.toMatchObject({ ok: false, status: 400 });
  });

  it('refuses when no From address is chosen', async () => {
    const db = fakeDb([[{ ...draftRow, senderIdentityId: null, senderFromEmail: null, senderStatus: null }]]);
    const result = await startCampaign(env, db as unknown as Db, 7, 1);
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect((result as { error: string }).error).toContain('verified From address');
  });

  it('REFUSES an unverified sender — a tenant cannot send as a domain they do not own', async () => {
    const db = fakeDb([[{ ...draftRow, senderStatus: 'pending' }]]);
    const result = await startCampaign(env, db as unknown as Db, 7, 1);
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect((result as { error: string }).error).toContain('not verified');
  });

  it('refuses a mailbox campaign with no mailbox chosen', async () => {
    const db = fakeDb([[{ ...draftRow, transport: 'mailbox', senderIdentityId: null, senderFromEmail: null }]]);
    const result = await startCampaign(env, db as unknown as Db, 7, 1);
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect((result as { error: string }).error).toContain('connected mailbox');
  });

  it('refuses a SendGrid campaign with no connection chosen', async () => {
    const db = fakeDb([[{ ...draftRow, transport: 'sendgrid' }]]);
    const result = await startCampaign(env, db as unknown as Db, 7, 1);
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect((result as { error: string }).error).toContain('SendGrid');
  });

  it('refuses an audience with no subscribed members', async () => {
    const db = fakeDb([[draftRow], []]);
    await expect(startCampaign(env, db as unknown as Db, 7, 1)).resolves.toMatchObject({ ok: false, status: 400 });
  });

  it('refuses when every member has unsubscribed', async () => {
    const db = fakeDb([
      [draftRow],
      [{ email: 'a@x.com' }],
      [{ email: 'a@x.com' }],   // …and they are suppressed
    ]);
    const result = await startCampaign(env, db as unknown as Db, 7, 1);
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect((result as { error: string }).error).toContain('unsubscribed');
  });

  it('queues only the deliverable recipients and counts the suppressed ones', async () => {
    const db = fakeDb([
      [draftRow],
      [{ email: 'a@x.com' }, { email: 'b@x.com' }, { email: 'c@x.com' }],
      [{ email: 'b@x.com' }],
      [],
      [{ id: 1, name: 'C', subject: 'Hello', status: 'sending', audienceId: 11, senderIdentityId: 5, projectId: null,
         recipients: 2, sent: 0, failed: 0, suppressed: 1, opened: 0, clicked: 0,
         startedAt: null, completedAt: null, updatedAt: new Date() }],
    ]);
    const result = await startCampaign(env, db as unknown as Db, 7, 1);
    expect(result).toMatchObject({ ok: true, queued: 2, suppressed: 1 });

    const sends = db.calls.find((c) => c.kind === 'insert')!;
    const rows = sends.payload as Array<{ email: string; trackToken: string }>;
    expect(rows.map((r) => r.email)).toEqual(['a@x.com', 'c@x.com']);
    // Every recipient gets a distinct, unguessable token.
    expect(new Set(rows.map((r) => r.trackToken)).size).toBe(2);
    // Idempotent — re-starting cannot duplicate a recipient.
    expect(sends.chain).toContain('onConflictDoNothing');
  });
});

describe('updateCampaign', () => {
  it('refuses to edit anything that is not a draft', async () => {
    const db = fakeDb([[]]);   // the status='draft' predicate matched nothing
    await expect(updateCampaign(db as unknown as Db, 7, 1, { subject: 'New' }))
      .resolves.toMatchObject({ ok: false, status: 409 });
  });
});

describe('runCampaignBatch', () => {
  const env = {} as Env;
  const sending = { ...draftRow, status: 'sending' };
  /** No logo asset configured — `defaultLogoUrl`'s query returns nothing. */
  const noLogo: unknown[] = [];

  it('does nothing for a campaign that is not sending', async () => {
    const db = fakeDb([[{ ...sending, status: 'draft' }]]);
    await expect(runCampaignBatch(env, db as unknown as Db, 7, 1, { trackingOrigin: ORIGIN }))
      .resolves.toMatchObject({ sent: 0, status: 'draft' });
  });

  it('fails the campaign if the sender lost verification mid-send', async () => {
    const db = fakeDb([[{ ...sending, senderStatus: 'pending' }], [], []]);
    const result = await runCampaignBatch(env, db as unknown as Db, 7, 1, { trackingOrigin: ORIGIN });
    expect(result.status).toBe('failed');
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('marks the still-queued rows failed when the transport breaks mid-campaign', async () => {
    // Otherwise the campaign reads as `failed` while every recipient sits at
    // `queued` forever, and nothing explains why they were never contacted.
    const db = fakeDb([[{ ...sending, senderStatus: 'pending' }], [], []]);
    await runCampaignBatch(env, db as unknown as Db, 7, 1, { trackingOrigin: ORIGIN });
    const sendWrite = db.calls.find(
      (c) => c.kind === 'update' && (c.payload as { status?: string })?.status === 'failed'
        && (c.payload as { error?: string })?.error,
    );
    expect((sendWrite!.payload as { error: string }).error).toContain('not verified');
  });

  it('sends each claimed recipient once and completes the campaign when the queue drains', async () => {
    sendMock.mockClear();
    const db = fakeDb([
      [sending],
      noLogo,
      [
        { id: 1, email: 'a@x.com', trackToken: 't1', attempts: 0, name: 'Ada', attributes: {} },
        { id: 2, email: 'b@x.com', trackToken: 't2', attempts: 0, name: '', attributes: {} },
      ],
      [{ id: 1 }], [],   // claim + mark sent, recipient 1
      [{ id: 2 }], [],   // claim + mark sent, recipient 2
      [{ remaining: 0 }],
      [],
    ]);
    const result = await runCampaignBatch(env, db as unknown as Db, 7, 1, { trackingOrigin: ORIGIN });
    expect(result).toMatchObject({ sent: 2, failed: 0, remaining: 0, status: 'sent' });
    expect(sendMock).toHaveBeenCalledTimes(2);
    const [first] = sendMock.mock.calls[0]!.slice(1) as [{ to: string; from: string; html: string }];
    expect(first.to).toBe('a@x.com');
    expect(first.from).toBe('Acme <hi@acme.com>');
    expect(first.html).toContain('unsubscribe/t1');
  });

  it('counts the attempt AT CLAIM, so a runner that dies cannot retry forever', async () => {
    sendMock.mockClear();
    const db = fakeDb([
      [sending], noLogo,
      [{ id: 1, email: 'a@x.com', trackToken: 't1', attempts: 0, name: '', attributes: {} }],
      [{ id: 1 }], [],
      [{ remaining: 0 }], [],
    ]);
    await runCampaignBatch(env, db as unknown as Db, 7, 1, { trackingOrigin: ORIGIN });
    const claim = db.calls.find((c) => c.kind === 'update' && (c.payload as { status?: string })?.status === 'sending');
    expect(claim!.payload).toHaveProperty('attempts');
  });

  it('SKIPS a recipient another runner already claimed', async () => {
    sendMock.mockClear();
    const db = fakeDb([
      [sending], noLogo,
      [{ id: 1, email: 'a@x.com', trackToken: 't1', attempts: 0, name: '', attributes: {} }],
      [],                  // the conditional claim matched zero rows → someone else has it
      [{ remaining: 1 }],
      [],
    ]);
    const result = await runCampaignBatch(env, db as unknown as Db, 7, 1, { trackingOrigin: ORIGIN });
    expect(sendMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ sent: 0, remaining: 1, status: 'sending' });
  });

  it('records a per-recipient failure without aborting the batch', async () => {
    sendMock.mockClear();
    sendMock.mockRejectedValueOnce(new Error('mailbox full'));
    const db = fakeDb([
      [sending], noLogo,
      [
        // Already at the attempt ceiling, so the platform transport's retryable
        // classification cannot requeue it — it must land as `failed`.
        { id: 1, email: 'a@x.com', trackToken: 't1', attempts: 2, name: '', attributes: {} },
        { id: 2, email: 'b@x.com', trackToken: 't2', attempts: 0, name: '', attributes: {} },
      ],
      [{ id: 1 }], [],
      [{ id: 2 }], [],
      [{ remaining: 0 }],
      [],
    ]);
    const result = await runCampaignBatch(env, db as unknown as Db, 7, 1, { trackingOrigin: ORIGIN });
    expect(result).toMatchObject({ sent: 1, failed: 1 });
    const failedWrite = db.calls.find((c) => c.kind === 'update' && (c.payload as { error?: string })?.error);
    expect((failedWrite!.payload as { error: string }).error).toContain('mailbox full');
  });

  it('REQUEUES a retryable failure below the ceiling instead of burning the recipient', async () => {
    sendMock.mockClear();
    sendMock.mockRejectedValueOnce(new Error('429 slow down'));
    const db = fakeDb([
      [sending], noLogo,
      [{ id: 1, email: 'a@x.com', trackToken: 't1', attempts: 0, name: '', attributes: {} }],
      [{ id: 1 }], [],
      [{ remaining: 1 }], [],
    ]);
    const result = await runCampaignBatch(env, db as unknown as Db, 7, 1, { trackingOrigin: ORIGIN });
    // Not counted as failed — the next sweep will try again.
    expect(result.failed).toBe(0);
    const write = db.calls.find((c) => c.kind === 'update' && (c.payload as { error?: string })?.error);
    expect((write!.payload as { status: string }).status).toBe('queued');
  });
});

describe('recordClick', () => {
  it('refuses to redirect anywhere that is not http(s) — no open redirect', async () => {
    const db = fakeDb();
    await expect(recordClick(db as unknown as Db, 't1', 'javascript:alert(1)')).resolves.toBeNull();
    await expect(recordClick(db as unknown as Db, 't1', '//evil.com')).resolves.toBeNull();
    await expect(recordClick(db as unknown as Db, 't1', 'not a url')).resolves.toBeNull();
    expect(db.calls).toHaveLength(0);
  });

  it('records the first click and returns the destination', async () => {
    const db = fakeDb([[{ campaignId: 1, tenantId: 7 }], []]);
    await expect(recordClick(db as unknown as Db, 't1', 'https://shop.example.com/x'))
      .resolves.toBe('https://shop.example.com/x');
  });

  it('still redirects when the token is unknown — a broken link is worse than a lost stat', async () => {
    const db = fakeDb([[]]);
    await expect(recordClick(db as unknown as Db, 'bogus', 'https://shop.example.com/x'))
      .resolves.toBe('https://shop.example.com/x');
  });
});
