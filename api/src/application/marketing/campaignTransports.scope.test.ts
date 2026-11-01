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
import {
  providerStatusScope,
  resolveCampaignSender,
  TransportError,
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
    for (const status of [400, 413, 422, 429, 500, 503, 0]) expect(providerStatusScope(status)).toBe('recipient');
    expect(providerStatusScope(null)).toBe('recipient');
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

  it('an unclassified error (a network failure) is retried', async () => {
    vi.mocked(executeConnectorAction).mockRejectedValue(new Error('fetch failed'));
    expect(await thrownBy(await senderFor(binding, connection))).toMatchObject({ retryable: true });
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
    expect(await thrownBy(await senderFor(binding))).toMatchObject({ retryable: true, scope: 'recipient' });
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
