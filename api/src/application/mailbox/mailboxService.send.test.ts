/**
 * `sendFromMailbox` and the read path's failure handling: what a provider failure does to the
 * mailbox row, what the caller is told, and the header-injection refusal.
 *
 * The provider adapter and the token vault are replaced, so each test says exactly which failure
 * the provider returns. The real `MailboxProviderError` and the real predicates
 * (`isMailboxAuthFailure`, `isMailboxRateLimited`) are used: those are what is under test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));
vi.mock('../integrations/oauthTokenVault', () => ({
  providerGrantRefresher: vi.fn(() => vi.fn()),
  refreshGrantIfStale: vi.fn(),
  sealOAuthTokens: vi.fn(),
  unsealOAuthTokens: vi.fn(),
}));
vi.mock('./mailboxProviders', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mailboxProviders')>()),
  getMailboxProvider: vi.fn(),
}));

import { refreshGrantIfStale, unsealOAuthTokens } from '../integrations/oauthTokenVault';
import { getMailboxProvider, MailboxProviderError } from './mailboxProviders';
import { readMailboxAttachment, sendFromMailbox } from './mailboxService';

const connectionRow = { id: 3, tenantId: 7, provider: 'google', status: 'connected', accountEmail: 'me@x.com', tokenEnc: 'e', tokenIv: 'i' };
const sendMessage = vi.fn();
const readAttachment = vi.fn();

beforeEach(() => {
  sendMessage.mockReset();
  readAttachment.mockReset();
  vi.mocked(getMailboxProvider).mockReturnValue({ name: 'google', label: 'Gmail', sendMessage, readAttachment } as never);
  vi.mocked(unsealOAuthTokens).mockResolvedValue({ accessToken: 'tok', refreshToken: 'r', expiresAtMs: null } as never);
  vi.mocked(refreshGrantIfStale).mockResolvedValue({ ok: true, refreshed: false, tokens: { accessToken: 'tok' } } as never);
});

const message = { to: 'a@x.com', subject: 'Hi', html: '<p>Hi</p>' };
const send = (db: ReturnType<typeof fakeDb>, over: Record<string, unknown> = {}) =>
  sendFromMailbox(db as unknown as Db, {} as Env, 7, 3, { ...message, ...over });

/** The statements that wrote `status: 'revoked'` to the mailbox row. */
const revocations = (db: ReturnType<typeof fakeDb>) =>
  db.calls.filter((c) => c.kind === 'update' && (c.payload as { status?: string } | undefined)?.status === 'revoked');

const gmail403 = (reason: string | null) => new MailboxProviderError(`Gmail send failed (403): ${reason ?? 'forbidden'}`, 403, reason);

describe('sendFromMailbox — what a provider failure does to the mailbox', () => {
  it.each(['rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded'])(
    'a Gmail 403 %s is retryable, flags the provider unavailable, and NEVER revokes the mailbox',
    async (reason) => {
      sendMessage.mockRejectedValue(gmail403(reason));
      const db = fakeDb([[connectionRow]]);
      const result = await send(db);

      expect(result).toMatchObject({ ok: false, status: 502, retryable: true, providerUnavailable: true });
      expect(revocations(db)).toHaveLength(0);
    },
  );

  it('a 403 for a withdrawn consent revokes the mailbox and is terminal', async () => {
    sendMessage.mockRejectedValue(gmail403('insufficientPermissions'));
    const db = fakeDb([[connectionRow], []]);
    const result = await send(db);

    expect(result).toMatchObject({ ok: false, status: 409, retryable: false });
    expect(result).not.toHaveProperty('providerUnavailable');
    expect(revocations(db)).toHaveLength(1);
  });

  it('a 403 with no readable reason, and a 401, are still treated as a revoked grant', async () => {
    for (const error of [gmail403(null), new MailboxProviderError('Gmail send failed (401)', 401)]) {
      sendMessage.mockRejectedValue(error);
      const db = fakeDb([[connectionRow], []]);
      expect(await send(db)).toMatchObject({ ok: false, status: 409, retryable: false });
      expect(revocations(db)).toHaveLength(1);
    }
  });

  it('flags the provider unavailable for no answer, a 429 and a 5xx, and not for a refusal of this one message', async () => {
    const cases: Array<[unknown, boolean]> = [
      [new Error('fetch failed'), true],
      [new MailboxProviderError('x', 429), true],
      [new MailboxProviderError('x', 500), true],
      [new MailboxProviderError('x', 503), true],
      [new MailboxProviderError('x', 400), false],
      [new MailboxProviderError('x', 422), false],
    ];
    for (const [error, unavailable] of cases) {
      sendMessage.mockRejectedValue(error);
      const result = await send(fakeDb([[connectionRow]]));
      expect(result).toMatchObject({ ok: false, status: 502, retryable: unavailable });
      expect(Boolean((result as { providerUnavailable?: boolean }).providerUnavailable)).toBe(unavailable);
    }
  });

  it('marks a failure UNDELIVERED only when the message definitely did not go out: a 429 or a rate-limit 403, never no answer or a 5xx', async () => {
    const cases: Array<[unknown, boolean]> = [
      [new MailboxProviderError('x', 429), true],
      [gmail403('rateLimitExceeded'), true],
      [new Error('fetch failed'), false],
      [new MailboxProviderError('x', 500), false],
      [new MailboxProviderError('x', 503), false],
      [new MailboxProviderError('x', 400), false],
    ];
    for (const [error, undelivered] of cases) {
      sendMessage.mockRejectedValue(error);
      const result = await send(fakeDb([[connectionRow]]));
      expect(Boolean((result as { undelivered?: boolean }).undelivered)).toBe(undelivered);
    }
  });

  it('flags the token endpoint being down (`expired`) as the provider being unavailable, and as undelivered', async () => {
    vi.mocked(refreshGrantIfStale).mockResolvedValue({ ok: false, reason: 'failed', message: 'token endpoint 503', error: new Error('503') } as never);
    const result = await send(fakeDb([[connectionRow], []]));
    expect(result).toMatchObject({ ok: false, status: 409, retryable: true, providerUnavailable: true, undelivered: true });
  });

  it('does NOT flag a revoked grant found at refresh as the provider being unavailable', async () => {
    vi.mocked(refreshGrantIfStale).mockResolvedValue({ ok: false, reason: 'revoked', message: 'invalid_grant' } as never);
    const result = await send(fakeDb([[connectionRow], []]));
    expect(result).toMatchObject({ ok: false, status: 409, retryable: false });
    expect(result).not.toHaveProperty('providerUnavailable');
    expect(result).not.toHaveProperty('undelivered');
  });
});

describe('readMailboxAttachment — a read path obeys the same predicate', () => {
  it('a rate-limit 403 on a read does not revoke the mailbox', async () => {
    readAttachment.mockRejectedValue(gmail403('userRateLimitExceeded'));
    const db = fakeDb([[connectionRow], []]);
    const result = await readMailboxAttachment(db as unknown as Db, {} as Env, 7, 3, 'm1', 'a1');

    expect(result).toMatchObject({ ok: false, status: 502 });
    expect(revocations(db)).toHaveLength(0);
  });

  it('an auth-failure 403 on a read revokes it', async () => {
    readAttachment.mockRejectedValue(gmail403('insufficientPermissions'));
    const db = fakeDb([[connectionRow], []]);
    const result = await readMailboxAttachment(db as unknown as Db, {} as Env, 7, 3, 'm1', 'a1');

    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(revocations(db)).toHaveLength(1);
  });
});

/**
 * The one chokepoint for every mailbox send (by hand, agent tool, campaign, sequence). `to` and
 * `replyTo` are written into message headers verbatim, so a CR or LF in either adds a header:
 * `replyTo: 'x@y.com\r\nBcc: erased@x.com'` adds a recipient no do-not-contact check saw. The refusal is a
 * 400 (this message's problem). The subject is encoded by the adapters and is not refused.
 */
describe('sendFromMailbox — header injection', () => {
  const refused = (result: Awaited<ReturnType<typeof send>>) => {
    expect(result).toMatchObject({ ok: false, status: 400, retryable: false });
    return (result as { error: string }).error;
  };

  it.each([
    ['CR', '\r'],
    ['LF', '\n'],
    ['CRLF', '\r\n'],
    ['NUL', '\u0000'],
    ['DEL', '\u007f'],
    ['tab', '\t'],
  ])('refuses a replyTo containing %s before any provider call', async (_name, control) => {
    const db = fakeDb([[connectionRow]]);
    const error = refused(await send(db, { replyTo: `x@y.com${control}Bcc: erased@x.com` }));
    expect(error).toContain('reply-to');
    expect(sendMessage).not.toHaveBeenCalled();
    // Refused before the token is even read: no statement at all.
    expect(db.calls).toHaveLength(0);
  });

  it.each([
    ['to', 'a@x.com\r\nBcc: erased@x.com', 'recipient'],
    ['to', 'a@x.com\nBcc: erased@x.com', 'recipient'],
    ['replyTo', 'a@x.com\r\nBcc: erased@x.com', 'reply-to'],
  ])('refuses %s containing a line break, and names the field', async (field, value, label) => {
    const error = refused(await send(fakeDb([[connectionRow]]), { [field]: value }));
    expect(error).toContain(label);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['a trailing newline', 'Hello\n'],
    ['a line break', 'Hello\r\nBcc: erased@x.com'],
    ['a tab', 'Hello\tthere'],
  ])('still sends a subject with %s: the adapters encode it, so it cannot add a header', async (_name, subject) => {
    sendMessage.mockResolvedValue({ id: 'sent-2' });
    expect(await send(fakeDb([[connectionRow]]), { subject })).toMatchObject({ ok: true, id: 'sent-2' });
    expect(sendMessage).toHaveBeenCalledWith('tok', expect.objectContaining({ subject }));
  });

  it('lets a clean message through, with or without a replyTo', async () => {
    sendMessage.mockResolvedValue({ id: 'sent-1' });
    expect(await send(fakeDb([[connectionRow]]))).toMatchObject({ ok: true, id: 'sent-1' });
    expect(await send(fakeDb([[connectionRow]]), { replyTo: 'boss@x.com' })).toMatchObject({ ok: true });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });
});
