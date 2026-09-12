import { describe, expect, it } from 'vitest';

import { describeMailboxFilter, mailboxFilterParts } from './mailboxApi';

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
