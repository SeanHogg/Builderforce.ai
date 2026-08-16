import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { buildSiteRecordTaskDraft } from './siteTicketBridge';

const mail = vi.hoisted(() => ({ sendRawEmail: vi.fn(async (..._args: unknown[]) => {}) }));
vi.mock('../../infrastructure/email/EmailService', () => mail);

import { notifySiteRecordTicketDone } from './siteTicketBridge';

describe('buildSiteRecordTaskDraft', () => {
  it('titles the ticket from a recognizable summary field', () => {
    const draft = buildSiteRecordTaskDraft('bug-reports', { message: 'The export button is broken' }, 'sam@example.com');
    expect(draft.title).toBe('[bug-reports] The export button is broken');
    expect(draft.description).toContain('**From:** sam@example.com');
    expect(draft.description).toContain('**message:** The export button is broken');
  });

  it('falls back to a generic title naming the collection and submitter', () => {
    const draft = buildSiteRecordTaskDraft('signups', { plan: 'pro' }, 'sam@example.com');
    expect(draft.title).toBe('[signups] New submission from sam@example.com');
  });

  it('falls back further to just the collection when there is no email either', () => {
    const draft = buildSiteRecordTaskDraft('signups', { plan: 'pro' }, null);
    expect(draft.title).toBe('[signups] New submission');
  });

  it('notes an empty payload rather than rendering nothing', () => {
    const draft = buildSiteRecordTaskDraft('contact', {}, null);
    expect(draft.description).toContain('No fields were submitted.');
  });

  it('bounds the title length', () => {
    const draft = buildSiteRecordTaskDraft('bug-reports', { message: 'x'.repeat(600) }, null);
    expect(draft.title.length).toBeLessThanOrEqual(500);
  });
});

describe('notifySiteRecordTicketDone', () => {
  const env = {} as Env;

  beforeEach(() => {
    mail.sendRawEmail.mockClear();
  });

  it('does nothing when the ticket was not raised by a site submission', async () => {
    const db = fakeDb([[{ originSiteRecordId: null, title: 'Some ticket' }]]);
    await notifySiteRecordTicketDone(env, db as unknown as Db, 1);
    expect(mail.sendRawEmail).not.toHaveBeenCalled();
  });

  it('does nothing when the linked record no longer exists', async () => {
    const db = fakeDb([
      [{ originSiteRecordId: 42, title: 'Fix the export button' }],
      [],
    ]);
    await notifySiteRecordTicketDone(env, db as unknown as Db, 1);
    expect(mail.sendRawEmail).not.toHaveBeenCalled();
  });

  it('does nothing for an anonymous submission with no email captured', async () => {
    const db = fakeDb([
      [{ originSiteRecordId: 42, title: 'Fix the export button' }],
      [{ collectionId: 3, email: null, siteUserId: null }],
      [{ siteId: 9, name: 'bug-reports' }],
    ]);
    await notifySiteRecordTicketDone(env, db as unknown as Db, 1);
    expect(mail.sendRawEmail).not.toHaveBeenCalled();
  });

  it('emails the anonymous submitter\'s own address when there is no signed-in owner', async () => {
    const db = fakeDb([
      [{ originSiteRecordId: 42, title: 'Fix the export button' }],
      [{ collectionId: 3, email: 'visitor@example.com', siteUserId: null }],
      [{ siteId: 9, name: 'bug-reports' }],
      [{ subdomain: 'acme', customDomain: null }],
    ]);
    await notifySiteRecordTicketDone(env, db as unknown as Db, 1);
    expect(mail.sendRawEmail).toHaveBeenCalledTimes(1);
    const [, message] = mail.sendRawEmail.mock.calls[0] as [Env, { to: string; subject: string; html: string }];
    expect(message).toMatchObject({ to: 'visitor@example.com' });
    expect(message.html).toContain('acme.builderforce.ai');
  });

  it('prefers the signed-in site_user\'s email and a custom domain when set', async () => {
    const db = fakeDb([
      [{ originSiteRecordId: 42, title: 'Fix the export button' }],
      [{ collectionId: 3, email: 'visitor@example.com', siteUserId: 7 }],
      [{ siteId: 9, name: 'bug-reports' }],
      [{ email: 'owner-account@example.com' }],
      [{ subdomain: 'acme', customDomain: 'acme.app' }],
    ]);
    await notifySiteRecordTicketDone(env, db as unknown as Db, 1);
    expect(mail.sendRawEmail).toHaveBeenCalledTimes(1);
    const [, message] = mail.sendRawEmail.mock.calls[0] as [Env, { to: string; subject: string; html: string }];
    expect(message).toMatchObject({ to: 'owner-account@example.com' });
    expect(message.html).toContain('acme.app');
    expect(message.html).toContain('Fix the export button');
  });

  it('never throws — a failed lookup is swallowed, not propagated', async () => {
    const db = {
      select: () => { throw new Error('db is down'); },
    } as unknown as Db;
    await expect(notifySiteRecordTicketDone(env, db, 1)).resolves.toBeUndefined();
    expect(mail.sendRawEmail).not.toHaveBeenCalled();
  });
});
