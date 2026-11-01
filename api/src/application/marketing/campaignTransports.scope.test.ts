import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { fakeDb } from '../../../test/fakeDb';

/**
 * Every place a transport throws a `TransportError` decides WHOSE failure it is, because the send
 * loop treats the two opposite ways: a recipient's terminal failure fails that row and the batch
 * carries on; a sender's terminal failure fails the whole campaign. This pins the classification of
 * each throw site, so a status code or error class moving between the two is a visible test change.
 */
vi.mock('../connectors/connectorRuntime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../connectors/connectorRuntime')>()),
  executeConnectorAction: vi.fn(),
}));
vi.mock('../mailbox/mailboxService', () => ({
  getMailboxConnection: vi.fn(async () => ({
    id: 3, accountEmail: 'ada@acme.test', displayName: 'Ada', status: 'connected', allowSending: true,
  })),
  sendFromMailbox: vi.fn(),
}));
vi.mock('../../infrastructure/email/EmailService', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendRawEmail: vi.fn(),
}));

import { executeConnectorAction, ConnectorCallError } from '../connectors/connectorRuntime';
import { sendFromMailbox } from '../mailbox/mailboxService';
import { EmailDeliveryError, sendRawEmail } from '../../infrastructure/email/EmailService';
import { isNoResponseStatus, isRetryableProviderStatus } from '../shared/campaignDelivery';
import {
  isOptOutFailure,
  isPerRecipientCarrierFailure,
  providerStatusScope,
  resolveCampaignSender,
  TransportError,
  TWILIO_SENDER_ERROR_CODES,
  twilioFailureScope,
  type CampaignSender,
  type TransportBinding,
} from './campaignTransports';

const env = {} as Env;
const message = { to: 'x@y.test', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' };

const base: TransportBinding = {
  transport: 'platform', channel: 'email',
  senderIdentity: { fromEmail: 'hi@acme.test', fromName: 'Acme', status: 'verified' },
  mailboxConnectionId: null, connectorConnectionId: null, fromName: '', fromNumber: null,
};

async function senderFor(binding: TransportBinding, rows: unknown[][] = []): Promise<CampaignSender> {
  const result = await resolveCampaignSender(fakeDb(rows) as unknown as Db, env, 7, binding);
  if (!result.ok) throw new Error(`expected a sender, got: ${result.error}`);
  return result.sender;
}

/** What `send` throws, as a TransportError. */
async function thrownBy(sender: CampaignSender): Promise<TransportError> {
  const error = await sender.send(message).then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(TransportError);
  return error as TransportError;
}

beforeEach(() => {
  vi.mocked(executeConnectorAction).mockReset();
  vi.mocked(sendFromMailbox).mockReset();
  vi.mocked(sendRawEmail).mockReset();
});

describe('providerStatusScope', () => {
  it('calls a refused credential, account or endpoint the SENDER\'s, and everything else the recipient\'s', () => {
    for (const status of [401, 402, 403, 404]) expect(providerStatusScope(status)).toBe('sender');
    for (const status of [400, 413, 422, 429, 500, 503]) expect(providerStatusScope(status)).toBe('recipient');
    expect(providerStatusScope(null)).toBe('recipient');
  });

  it('leaves status 0 (no response) to `retryable`: scope only matters for a terminal failure, and 0 is never terminal', () => {
    expect(providerStatusScope(0)).toBe('recipient');
    expect(isRetryableProviderStatus(0)).toBe(true);
    expect(isNoResponseStatus(0)).toBe(true);
  });
});

describe('isRetryableProviderStatus', () => {
  it('treats no response, 429 and 5xx as come-back-later, and every other status as not', () => {
    for (const status of [0, 429, 500, 502, 503, 599]) expect(isRetryableProviderStatus(status)).toBe(true);
    for (const status of [200, 400, 401, 403, 404, 422, 499]) expect(isRetryableProviderStatus(status)).toBe(false);
    expect(isRetryableProviderStatus(null)).toBe(false);
    expect(isRetryableProviderStatus(undefined)).toBe(false);
    expect(isNoResponseStatus(429)).toBe(false);
  });
});

describe('twilioFailureScope', () => {
  it("reads the provider code from the body before the status: a From-level code is the SENDER's even on a 400", () => {
    expect(TWILIO_SENDER_ERROR_CODES).toEqual(['21212', '21603', '21606', '21659']);
    for (const code of TWILIO_SENDER_ERROR_CODES) {
      expect(twilioFailureScope(400, { code: Number(code), message: 'x' })).toBe('sender');
      expect(twilioFailureScope(400, { code, message: 'x' })).toBe('sender');
    }
  });

  it('falls back to the status for any other code, or no readable body', () => {
    expect(twilioFailureScope(400, { code: 21211, message: 'bad To' })).toBe('recipient');
    expect(twilioFailureScope(400, { code: 21610, message: 'STOP' })).toBe('recipient');
    expect(twilioFailureScope(401, {})).toBe('sender');
    expect(twilioFailureScope(400, null)).toBe('recipient');
    expect(twilioFailureScope(400, 'not json')).toBe('recipient');
  });
});

describe('isPerRecipientCarrierFailure', () => {
  it('is true for an opt-out and for each known per-recipient Twilio code', () => {
    expect(isPerRecipientCarrierFailure('Twilio returned 400: 21610 Attempt to send to unsubscribed recipient')).toBe(true);
    expect(isPerRecipientCarrierFailure('Twilio returned 400: 21211 invalid To')).toBe(true);
    expect(isPerRecipientCarrierFailure('Twilio returned 400: 21614 To is not a mobile number')).toBe(true);
  });

  it('is false for a sender-level code or an unlisted one', () => {
    expect(isPerRecipientCarrierFailure('Twilio returned 400: 21606 From is not a valid SMS-capable number')).toBe(false);
    expect(isPerRecipientCarrierFailure('Twilio returned 400: 30003 Unreachable destination handset')).toBe(false);
  });

  it('reads the code from the start of the message, never from digits in the quoted phone number', () => {
    // +12161455512 contains the digits 21614 (and not 21610, which would make it an opt-out).
    expect(isPerRecipientCarrierFailure('Twilio returned 400: 30003 The number +12161455512 failed')).toBe(false);
  });

  it('treats a bad To that quotes a number containing the opt-out digits as per-recipient, not an opt-out', () => {
    const message = 'Twilio returned 400: 21211 The number +14152161000 is invalid';
    expect(isOptOutFailure(message)).toBe(false);
    expect(isPerRecipientCarrierFailure(message)).toBe(true);
  });
});

describe('twilio (SMS)', () => {
  const binding: TransportBinding = {
    ...base, channel: 'sms', transport: 'twilio', senderIdentity: null,
    connectorConnectionId: 'conn-t', fromNumber: '+14155551234',
  };
  const connection = [[{ id: 'conn-t', name: 'Main', connectorKey: 'twilio', enabled: true }]];
  const respond = (status: number, data: unknown = {}) =>
    vi.mocked(executeConnectorAction).mockResolvedValue({ ok: false, status, data, error: 'x', durationMs: 1 } as never);

  it('a 400 (a number Twilio refuses, or a STOP) is terminal and the RECIPIENT\'s', async () => {
    respond(400, { code: 21610, message: 'blocked' });
    expect(await thrownBy(await senderFor(binding, connection))).toMatchObject({ retryable: false, scope: 'recipient' });
  });

  it('a 401 or 403 (the credentials are wrong) is terminal and the SENDER\'s', async () => {
    for (const status of [401, 403]) {
      respond(status);
      expect(await thrownBy(await senderFor(binding, connection))).toMatchObject({ retryable: false, scope: 'sender' });
    }
  });

  it('a 429 or a 5xx is retryable', async () => {
    for (const status of [429, 500, 503]) {
      respond(status);
      expect(await thrownBy(await senderFor(binding, connection))).toMatchObject({ retryable: true, scope: 'recipient' });
    }
  });

  it('a ConnectorCallError (unknown connector, missing credential, blocked URL) is terminal and the SENDER\'s', async () => {
    vi.mocked(executeConnectorAction).mockRejectedValue(new ConnectorCallError('Connection not found', 404));
    expect(await thrownBy(await senderFor(binding, connection))).toMatchObject({ retryable: false, scope: 'sender' });
  });

  it('NO RESPONSE (status 0: how the runtime reports a fetch failure or its timeout) is retryable and flagged', async () => {
    // `executeConnectorAction` does not throw on a network failure: it returns `{ ok: false, status: 0 }`.
    respond(0);
    expect(await thrownBy(await senderFor(binding, connection)))
      .toMatchObject({ retryable: true, scope: 'recipient', noResponse: true });
  });

  it('a real response is not flagged no-response', async () => {
    for (const status of [400, 429, 503]) {
      respond(status);
      expect(await thrownBy(await senderFor(binding, connection))).toMatchObject({ noResponse: false });
    }
  });

  it('an unexpected throw is still retried', async () => {
    vi.mocked(executeConnectorAction).mockRejectedValue(new Error('boom'));
    expect(await thrownBy(await senderFor(binding, connection))).toMatchObject({ retryable: true });
  });

  it.each(TWILIO_SENDER_ERROR_CODES)("error %s on a 400 is terminal and the SENDER's (the From is unusable)", async (code) => {
    respond(400, { code: Number(code), message: 'From is not valid', more_info: 'https://www.twilio.com/docs/errors/' + code });
    expect(await thrownBy(await senderFor(binding, connection))).toMatchObject({ retryable: false, scope: 'sender' });
  });

  it("an ordinary bad-number code on a 400 stays the RECIPIENT's", async () => {
    for (const code of [21211, 21614, 21610]) {
      respond(400, { code, message: 'bad To' });
      expect(await thrownBy(await senderFor(binding, connection))).toMatchObject({ retryable: false, scope: 'recipient' });
    }
  });
});

describe('sendgrid', () => {
  const binding: TransportBinding = { ...base, transport: 'sendgrid', connectorConnectionId: 'conn-1' };
  const connection = [[{ id: 'conn-1', name: 'Prod', connectorKey: 'sendgrid', enabled: true }]];
  const respond = (status: number) =>
    vi.mocked(executeConnectorAction).mockResolvedValue({ ok: false, status, data: {}, error: 'x', durationMs: 1 } as never);

  it('a 400 for one address is terminal and the RECIPIENT\'s', async () => {
    respond(400);
    expect(await thrownBy(await senderFor(binding, connection))).toMatchObject({ retryable: false, scope: 'recipient' });
  });

  it('a 401 or 403 (the API key is wrong) is terminal and the SENDER\'s', async () => {
    for (const status of [401, 403]) {
      respond(status);
      expect(await thrownBy(await senderFor(binding, connection))).toMatchObject({ retryable: false, scope: 'sender' });
    }
  });

  it('a 429 or a 5xx is retryable', async () => {
    for (const status of [429, 502]) {
      respond(status);
      expect(await thrownBy(await senderFor(binding, connection))).toMatchObject({ retryable: true });
    }
  });

  it('NO RESPONSE (status 0) is retryable and flagged', async () => {
    respond(0);
    expect(await thrownBy(await senderFor(binding, connection)))
      .toMatchObject({ retryable: true, scope: 'recipient', noResponse: true });
  });

  it('a ConnectorCallError is terminal and the SENDER\'s', async () => {
    vi.mocked(executeConnectorAction).mockRejectedValue(new ConnectorCallError('blocked URL', 400));
    expect(await thrownBy(await senderFor(binding, connection))).toMatchObject({ retryable: false, scope: 'sender' });
  });
});

describe('mailbox', () => {
  const binding: TransportBinding = { ...base, transport: 'mailbox', senderIdentity: null, mailboxConnectionId: 3 };
  const respond = (status: 404 | 409 | 502, retryable: boolean) =>
    vi.mocked(sendFromMailbox).mockResolvedValue({ ok: false, status, error: 'x', retryable });

  it('a revoked grant (409, not retryable) is terminal and the SENDER\'s', async () => {
    respond(409, false);
    expect(await thrownBy(await senderFor(binding))).toMatchObject({ retryable: false, scope: 'sender' });
  });

  it('a mailbox that is gone (404) is the SENDER\'s', async () => {
    respond(404, false);
    expect(await thrownBy(await senderFor(binding))).toMatchObject({ retryable: false, scope: 'sender' });
  });

  it('an expiring token (409, retryable) is retried, and still labelled the SENDER\'s', async () => {
    respond(409, true);
    expect(await thrownBy(await senderFor(binding))).toMatchObject({ retryable: true, scope: 'sender' });
  });

  it('a provider refusal of one message (502, not retryable) is the RECIPIENT\'s', async () => {
    respond(502, false);
    expect(await thrownBy(await senderFor(binding))).toMatchObject({ retryable: false, scope: 'recipient' });
  });

  it('a provider 429 or 5xx (502, retryable) is retried', async () => {
    respond(502, true);
    expect(await thrownBy(await senderFor(binding))).toMatchObject({ retryable: true, scope: 'recipient', noResponse: false });
  });

  it('a mailbox send that got no answer (flagged by the service) is retryable and flagged no-response', async () => {
    vi.mocked(sendFromMailbox).mockResolvedValue({ ok: false, status: 502, error: 'fetch failed', retryable: true, noResponse: true });
    expect(await thrownBy(await senderFor(binding))).toMatchObject({ retryable: true, scope: 'recipient', noResponse: true });
  });
});

describe('platform', () => {
  it('every failure is retryable (bounded by the attempt ceiling); a refused platform key is labelled the SENDER\'s', async () => {
    const sender = await senderFor(base);
    vi.mocked(sendRawEmail).mockRejectedValue(new Error('timeout'));
    expect(await thrownBy(sender)).toMatchObject({ retryable: true, scope: 'recipient' });
    vi.mocked(sendRawEmail).mockRejectedValue(new EmailDeliveryError('bad key', 'resend', 401));
    expect(await thrownBy(sender)).toMatchObject({ retryable: true, scope: 'sender' });
  });
});
