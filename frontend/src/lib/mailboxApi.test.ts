import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiRequest = vi.fn(async () => ({ sent: true, id: 'm1', accountEmail: 'me@x.com' }));
vi.mock('./apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./apiClient')>()),
  apiRequest: (...args: unknown[]) => apiRequest(...(args as [])),
}));

import { describeMailboxFilter, mailboxApi, mailboxFilterParts } from './mailboxApi';

/**
 * The inbox tile's filter line is persisted with the board, so the lib hands back
 * DATA (parts the card words in its reader's language) and keeps English only for
 * the model-facing one-liner.
 */
describe('mailboxFilterParts', () => {
  it('returns no parts for an empty filter — the card words that as "all recent mail"', () => {
    expect(mailboxFilterParts({})).toEqual([]);
    expect(mailboxFilterParts()).toEqual([]);
  });

  it('returns one structured part per clause, in a stable order, with no prose', () => {
    expect(mailboxFilterParts({
      q: ' invoice ', from: 'dana@acme.com', subject: 'Q3', unread: true, hasAttachments: true,
      after: '2026-09-01T00:00:00Z', before: '2026-09-10',
    })).toEqual([
      { kind: 'unread' },
      { kind: 'from', value: 'dana@acme.com' },
      { kind: 'subject', value: 'Q3' },
      { kind: 'matching', value: 'invoice' },
      { kind: 'attachments' },
      { kind: 'since', value: '2026-09-01' },
      { kind: 'before', value: '2026-09-10' },
    ]);
  });

  it('drops blank text clauses', () => {
    expect(mailboxFilterParts({ from: '  ', q: '' })).toEqual([]);
  });
});

describe('describeMailboxFilter (model-facing English)', () => {
  it('names the whole mailbox when nothing filters it', () => {
    expect(describeMailboxFilter({})).toBe('All recent mail');
  });

  it('reads as one capitalised line', () => {
    expect(describeMailboxFilter({ unread: true, from: 'dana@acme.com' })).toBe('Unread, from dana@acme.com');
    expect(describeMailboxFilter({ from: 'dana@acme.com', hasAttachments: true })).toBe('From dana@acme.com, with attachments');
  });
});

/**
 * A 409 from `send` is handled by the composer, not a fault: the do-not-contact one is a question it asks
 * the person, and the other (the mailbox needs reconnecting) is rendered inline from the error's message.
 * Neither may raise the global error toast or a quality report first.
 */
describe('mailboxApi.send', () => {
  beforeEach(() => { apiRequest.mockClear(); });

  it('lists 400 and 409 as expected errors and posts the message as JSON', async () => {
    await mailboxApi.send(3, { to: 'a@x.com, b@y.com', subject: 'Hi', html: '<p>Hi</p>' });
    const [path, options] = apiRequest.mock.calls[0] as unknown as [string, { method: string; expectedErrors?: number[]; body: string }];
    expect(path).toBe('/api/mailbox/connections/3/send');
    expect(options.method).toBe('POST');
    expect(options.expectedErrors).toEqual([400, 409]);
    expect(JSON.parse(options.body)).toMatchObject({ to: 'a@x.com, b@y.com' });
  });
});
