import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyClientSideFilters,
  attachmentTooLargeMessage,
  availableMailboxProviders,
  buildMimeMessage,
  clampMailboxLimit,
  getMailboxProvider,
  htmlToPreviewText,
  isMailboxAuthFailure,
  isMailboxProviderName,
  isMailboxRateLimited,
  MailboxProviderError,
  safeAttachmentFilename,
  MAX_ATTACHMENT_BYTES,
  type MailboxMessage,
} from './mailboxProviders';

const message = (over: Partial<MailboxMessage> = {}): MailboxMessage => ({
  id: 'm1', threadId: null, from: 'ada@acme.test', fromName: 'Ada Lovelace',
  to: ['me@example.test'], subject: 'Quarterly numbers', snippet: '', bodyText: 'body',
  receivedAtISO: '2026-08-06T10:00:00.000Z', unread: false, hasAttachments: false,
  labels: [], webUrl: null, ...over,
});

/**
 * The filters BOTH providers must agree on.
 *
 * Gmail pushes nearly everything down to its `q` string; Graph cannot combine
 * `$search` with `$filter` at all. That asymmetry is the reason this pass
 * exists — without it, the same filter would silently mean different things
 * depending on which mailbox the user happened to connect.
 */
describe('applyClientSideFilters', () => {
  it('matches the sender by substring, case-insensitively, across address AND display name', () => {
    const rows = [message(), message({ id: 'm2', from: 'bob@other.test', fromName: 'Bob' })];
    expect(applyClientSideFilters(rows, { from: 'ACME' }).map((m) => m.id)).toEqual(['m1']);
    expect(applyClientSideFilters(rows, { from: 'lovelace' }).map((m) => m.id)).toEqual(['m1']);
  });

  it('matches the subject by substring, case-insensitively', () => {
    const rows = [message(), message({ id: 'm2', subject: 'Lunch?' })];
    expect(applyClientSideFilters(rows, { subject: 'QUARTERLY' }).map((m) => m.id)).toEqual(['m1']);
  });

  it('applies unread and attachment flags', () => {
    const rows = [message({ unread: true, hasAttachments: true }), message({ id: 'm2' })];
    expect(applyClientSideFilters(rows, { unreadOnly: true }).map((m) => m.id)).toEqual(['m1']);
    expect(applyClientSideFilters(rows, { hasAttachments: true }).map((m) => m.id)).toEqual(['m1']);
  });

  it('applies the date window at INSTANT precision, not day precision', () => {
    // Gmail's pushed-down `after:` operator is day-granular, so the exact
    // instant a caller asked for is only honoured here.
    const rows = [
      message({ id: 'early', receivedAtISO: '2026-08-06T08:00:00.000Z' }),
      message({ id: 'late', receivedAtISO: '2026-08-06T18:00:00.000Z' }),
    ];
    expect(applyClientSideFilters(rows, { afterISO: '2026-08-06T12:00:00.000Z' }).map((m) => m.id))
      .toEqual(['late']);
    expect(applyClientSideFilters(rows, { beforeISO: '2026-08-06T12:00:00.000Z' }).map((m) => m.id))
      .toEqual(['early']);
  });

  it('is a no-op for an empty filter, and combines predicates with AND', () => {
    const rows = [message({ unread: true }), message({ id: 'm2', from: 'bob@other.test', unread: true })];
    expect(applyClientSideFilters(rows, {})).toHaveLength(2);
    expect(applyClientSideFilters(rows, { unreadOnly: true, from: 'acme' }).map((m) => m.id)).toEqual(['m1']);
  });

  it('ignores an unparseable date bound rather than dropping everything', () => {
    expect(applyClientSideFilters([message()], { afterISO: 'not a date' })).toHaveLength(1);
  });
});

describe('clampMailboxLimit', () => {
  it('bounds a caller into [1, 100] and defaults when absent or unparseable', () => {
    // An inbox tile and a model's context window do not want 500 messages.
    expect(clampMailboxLimit(undefined)).toBe(25);
    expect(clampMailboxLimit('abc')).toBe(25);
    expect(clampMailboxLimit(0)).toBe(1);
    expect(clampMailboxLimit(-4)).toBe(1);
    expect(clampMailboxLimit(1_000)).toBe(100);
    expect(clampMailboxLimit('40')).toBe(40);
  });
});

describe('htmlToPreviewText', () => {
  it('drops style and script BODIES, which are most of a marketing email', () => {
    const text = htmlToPreviewText('<style>.a{color:red}</style><script>x()</script><p>Real words</p>');
    expect(text).toBe('Real words');
  });

  it('turns block boundaries into line breaks and decodes common entities', () => {
    expect(htmlToPreviewText('<p>One</p><p>Two</p>')).toBe('One\nTwo');
    expect(htmlToPreviewText('<p>A &amp; B &lt;c&gt; &quot;d&quot; &#39;e&#39;</p>')).toBe('A & B <c> "d" \'e\'');
  });
});

/**
 * The MIME headers here are a DELIVERABILITY decision, not a vendor detail:
 * bulk mail without a working one-click unsubscribe is filed as spam by Gmail
 * and Outlook regardless of its content.
 */
describe('buildMimeMessage', () => {
  const outgoing = { to: 'sam@example.test', subject: 'Hello', html: '<p>Hi <b>there</b></p>' };

  it('always sends multipart/alternative with a text part derived from the HTML', () => {
    const mime = buildMimeMessage({ email: 'me@acme.test' }, outgoing);
    expect(mime).toContain('Content-Type: multipart/alternative');
    expect(mime).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(mime).toContain('Content-Type: text/html; charset="UTF-8"');
    // The two parts are generated from ONE source, so they cannot describe
    // different offers.
    expect(mime).toContain('Hi there');
    expect(mime).toContain('<p>Hi <b>there</b></p>');
  });

  it('emits BOTH unsubscribe headers — List-Unsubscribe alone is not one-click', () => {
    const mime = buildMimeMessage({ email: 'me@acme.test' }, {
      ...outgoing, listUnsubscribeUrl: 'https://builderforce.ai/gateway/api/campaign-track/unsubscribe/tok',
    });
    expect(mime).toContain('List-Unsubscribe: <https://builderforce.ai/gateway/api/campaign-track/unsubscribe/tok>');
    expect(mime).toContain('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
  });

  it('omits the unsubscribe headers entirely for a one-off message', () => {
    expect(buildMimeMessage({ email: 'me@acme.test' }, outgoing)).not.toContain('List-Unsubscribe');
  });

  it('RFC 2047-encodes a non-ASCII display name instead of writing it raw', () => {
    // A raw non-ASCII header is mojibake in most clients and rejected by some MTAs.
    const mime = buildMimeMessage({ email: 'me@acme.test' }, { ...outgoing, fromName: 'Ada Løvelace' });
    expect(mime).toMatch(/From: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <me@acme\.test>/);
    expect(mime).not.toContain('Ada Løvelace <');
  });

  it('leaves an ASCII display name readable', () => {
    expect(buildMimeMessage({ email: 'me@acme.test' }, { ...outgoing, fromName: 'Acme Team' }))
      .toContain('From: Acme Team <me@acme.test>');
  });
});

describe('the provider registry', () => {
  it('resolves only the two known providers', () => {
    expect(getMailboxProvider('google')?.name).toBe('google');
    expect(getMailboxProvider('microsoft')?.name).toBe('microsoft');
    expect(getMailboxProvider('yahoo')).toBeNull();
    expect(isMailboxProviderName('google')).toBe(true);
    expect(isMailboxProviderName('yahoo')).toBe(false);
  });

  it('requests read-state + send scopes — never permanent delete', () => {
    // A tenant connecting a mailbox to run a campaign has not agreed to let us
    // delete their mail.
    const google = getMailboxProvider('google')!;
    expect(google.scopes).toContain('https://www.googleapis.com/auth/gmail.modify');
    expect(google.scopes).toContain('https://www.googleapis.com/auth/gmail.send');
    expect(google.scopes).not.toContain('https://mail.google.com/');

    const microsoft = getMailboxProvider('microsoft')!;
    expect(microsoft.scopes).toContain('Mail.ReadWrite');
    expect(microsoft.scopes).toContain('Mail.Send');
    expect(microsoft.scopes).not.toContain('Mail.ReadWrite.Shared');
  });

  it('asks for the params that actually yield a refresh token', () => {
    // Without these a grant expires in an hour and a campaign mid-send dies
    // with no way to recover.
    expect(getMailboxProvider('google')!.extraAuthParams).toMatchObject({ access_type: 'offline' });
    expect(getMailboxProvider('microsoft')!.scopes).toContain('offline_access');
  });

  it('reports what this deployment can offer rather than assuming both', () => {
    const partial = availableMailboxProviders({ GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b' });
    expect(partial.find((p) => p.name === 'google')?.configured).toBe(true);
    expect(partial.find((p) => p.name === 'microsoft')?.configured).toBe(false);
  });

  it('treats a client id without its secret as UNCONFIGURED', () => {
    // A half-bound provider would offer a redirect that fails at token exchange.
    const half = availableMailboxProviders({ MICROSOFT_CLIENT_ID: 'a' });
    expect(half.find((p) => p.name === 'microsoft')?.configured).toBe(false);
  });
});

/**
 * Attachments — the three things that are load-bearing rather than plumbing.
 *
 * `hasAttachments` was populated from both providers and the filter honoured it,
 * and there was no way to open the file. Closing that put ATTACKER-SUPPLIED bytes
 * and an ATTACKER-SUPPLIED filename on a path into this origin, which is why the
 * sanitiser and the size ceiling are tested harder than the happy path is.
 */
describe('safeAttachmentFilename', () => {
  it('keeps an ordinary filename intact', () => {
    expect(safeAttachmentFilename('Invoice 2026-08.pdf')).toBe('Invoice 2026-08.pdf');
  });

  it('cannot escape a download directory', () => {
    // The name comes from a sender — someone outside the tenant — and lands on a
    // disk on the far side.
    // Separators collapse to underscores FIRST, then the leading dots go — so a
    // traversal loses both the separators that make it one and the dot-prefix
    // that would have hidden the result.
    expect(safeAttachmentFilename('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(safeAttachmentFilename('C:\\Windows\\system32\\cmd.exe')).toBe('C:_Windows_system32_cmd.exe');
  });

  it('cannot split or terminate the Content-Disposition header', () => {
    // A CR/LF would inject a header; a quote would close the filename parameter
    // early and let everything after it be read as more parameters.
    expect(safeAttachmentFilename('a\r\nSet-Cookie: x=1')).toBe('aSet-Cookie: x=1');
    expect(safeAttachmentFilename('re"port.pdf')).toBe('report.pdf');
    expect(safeAttachmentFilename("re'port.pdf")).toBe('report.pdf');
  });

  it('cannot produce a hidden file, or an empty one', () => {
    expect(safeAttachmentFilename('.bashrc')).toBe('bashrc');
    expect(safeAttachmentFilename('///')).toBe('_');
    expect(safeAttachmentFilename('')).toBe('attachment');
    expect(safeAttachmentFilename('"')).toBe('attachment');
  });

  it('bounds the length', () => {
    expect(safeAttachmentFilename('x'.repeat(500))).toHaveLength(200);
  });
});

describe('attachmentTooLargeMessage', () => {
  it('names the file and both sizes, so the person knows what to do instead', () => {
    // A bare "download failed" sends somebody hunting for a network problem that
    // is not there. This is a hard memory ceiling, not a transient failure.
    const message = attachmentTooLargeMessage('deck.key', 41 * 1024 * 1024);
    expect(message).toContain('deck.key');
    expect(message).toContain('41.0 MB');
    expect(message).toContain('20.0 MB');
    expect(message).toContain('mail client');
  });
});

describe('MAX_ATTACHMENT_BYTES', () => {
  it('is a ceiling a Worker can actually hold', () => {
    // Both providers hand the bytes over base64-encoded, so the peak is ~1.4x the
    // file. This is the number the adapters enforce BEFORE reading a body.
    expect(MAX_ATTACHMENT_BYTES).toBe(20 * 1024 * 1024);
  });
});

/**
 * What a 403 means. The HTTP status alone cannot say: Gmail answers 403 for a withdrawn consent AND
 * for a quota hit, and treating every 401/403 as a revoked grant failed a whole campaign for good,
 * and marked a working mailbox revoked, on one rate-limit response.
 */
describe('the provider failure reason', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const outgoing = { to: 'a@x.com', subject: 'Hi', html: '<p>Hi</p>' };

  /** Stub `fetch` so Gmail's profile lookup succeeds and the send itself answers `status` + `body`. */
  const gmailSendFails = async (status: number, body: unknown): Promise<MailboxProviderError> => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (
      String(url).endsWith('/profile')
        ? new Response(JSON.stringify({ emailAddress: 'me@x.com' }), { status: 200 })
        : new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
    )));
    return getMailboxProvider('google')!.sendMessage('tok', outgoing).then(
      () => { throw new Error('expected the send to fail'); },
      (error: unknown) => error as MailboxProviderError,
    );
  };

  const graphSendFails = async (status: number, body: unknown): Promise<MailboxProviderError> => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
    return getMailboxProvider('microsoft')!.sendMessage('tok', outgoing).then(
      () => { throw new Error('expected the send to fail'); },
      (error: unknown) => error as MailboxProviderError,
    );
  };

  const gmail403 = (reason: string) => ({ error: { code: 403, message: 'denied', errors: [{ reason, domain: 'usageLimits' }], status: 'PERMISSION_DENIED' } });

  it('reads Gmail\'s machine-readable reason off errors[].reason', async () => {
    const error = await gmailSendFails(403, gmail403('userRateLimitExceeded'));
    expect(error).toBeInstanceOf(MailboxProviderError);
    expect(error.status).toBe(403);
    expect(error.reason).toBe('userRateLimitExceeded');
  });

  it('reads Graph\'s reason off error.code', async () => {
    const error = await graphSendFails(429, { error: { code: 'TooManyRequests', message: 'slow down' } });
    expect(error.reason).toBe('TooManyRequests');
  });

  it('falls back to the newer details[].reason and to a status string, and is null when the body says nothing', async () => {
    const details = await gmailSendFails(403, { error: { code: 403, message: 'x', details: [{ reason: 'RATE_LIMIT_EXCEEDED' }] } });
    expect(details.reason).toBe('RATE_LIMIT_EXCEEDED');
    const status = await gmailSendFails(429, { error: { code: 429, message: 'x', status: 'RESOURCE_EXHAUSTED' } });
    expect(status.reason).toBe('RESOURCE_EXHAUSTED');
    const none = await gmailSendFails(403, '<html>Forbidden</html>');
    expect(none.reason).toBeNull();
  });

  it.each(['rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded'])(
    'Gmail 403 %s is a rate limit: retryable, and never an auth failure',
    async (reason) => {
      const error = await gmailSendFails(403, gmail403(reason));
      expect(isMailboxRateLimited(error)).toBe(true);
      expect(isMailboxAuthFailure(error)).toBe(false);
    },
  );

  it('a 403 for a withdrawn consent, or with no reason at all, IS an auth failure', async () => {
    for (const body of [gmail403('insufficientPermissions'), gmail403('forbidden'), '<html>Forbidden</html>']) {
      const error = await gmailSendFails(403, body);
      expect(isMailboxAuthFailure(error)).toBe(true);
      expect(isMailboxRateLimited(error)).toBe(false);
    }
  });

  it('a 401 is always an auth failure, whatever the body says', async () => {
    const error = await gmailSendFails(401, gmail403('rateLimitExceeded'));
    expect(isMailboxAuthFailure(error)).toBe(true);
  });

  it('a 429 is a rate limit and not an auth failure; a Graph throttling code on a 403 is too', async () => {
    expect(isMailboxRateLimited(new MailboxProviderError('x', 429))).toBe(true);
    expect(isMailboxAuthFailure(new MailboxProviderError('x', 429))).toBe(false);
    const graph = await graphSendFails(403, { error: { code: 'ApplicationThrottled', message: 'x' } });
    expect(isMailboxRateLimited(graph)).toBe(true);
    expect(isMailboxAuthFailure(graph)).toBe(false);
    const denied = await graphSendFails(403, { error: { code: 'ErrorAccessDenied', message: 'x' } });
    expect(isMailboxAuthFailure(denied)).toBe(true);
  });

  it('a 500 is neither: the provider failing is not a grant problem', () => {
    const error = new MailboxProviderError('x', 500);
    expect(isMailboxAuthFailure(error)).toBe(false);
    expect(isMailboxRateLimited(error)).toBe(false);
  });
});
