import { describe, expect, it, vi } from 'vitest';
import { isCampaignTransport, resolveCampaignSender, TransportError } from './campaignTransports';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/**
 * `resolveCampaignSender` is the pre-flight that makes a started campaign safe
 * to run to completion. Every precondition that protects a real person is
 * checked HERE, once, before the first recipient row exists — the same
 * discipline `startCampaign` already applies to suppression and membership.
 *
 * `retryable` on the failures is the other half of the contract, and getting it
 * wrong has two opposite failure modes: classify a revoked grant as retryable
 * and the campaign grinds through its whole audience writing the same error;
 * classify a 429 as terminal and it silently under-delivers.
 */

const env = {} as Env;

const verifiedIdentity = { fromEmail: 'hi@acme.test', fromName: 'Acme', status: 'verified' };

const binding = (over: Partial<Parameters<typeof resolveCampaignSender>[3]> = {}) => ({
  transport: 'platform',
  senderIdentity: verifiedIdentity,
  mailboxConnectionId: null,
  connectorConnectionId: null,
  fromName: '',
  ...over,
});

describe('isCampaignTransport', () => {
  it('accepts only the three real transports', () => {
    expect(isCampaignTransport('platform')).toBe(true);
    expect(isCampaignTransport('mailbox')).toBe(true);
    expect(isCampaignTransport('sendgrid')).toBe(true);
    expect(isCampaignTransport('smtp')).toBe(false);
    expect(isCampaignTransport(undefined)).toBe(false);
  });
});

describe('resolveCampaignSender — platform', () => {
  it('resolves a verified identity into a display From', async () => {
    const result = await resolveCampaignSender(fakeDb() as unknown as Db, env, 7, binding());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sender.transport).toBe('platform');
    expect(result.sender.fromLabel).toBe('Acme <hi@acme.test>');
  });

  it('falls back to the bare address when there is no display name', async () => {
    const result = await resolveCampaignSender(
      fakeDb() as unknown as Db, env, 7,
      binding({ senderIdentity: { ...verifiedIdentity, fromName: '' } }),
    );
    expect(result.ok && result.sender.fromLabel).toBe('hi@acme.test');
  });

  it('refuses an unverified identity — a tenant cannot send as a domain they do not own', async () => {
    const result = await resolveCampaignSender(
      fakeDb() as unknown as Db, env, 7,
      binding({ senderIdentity: { ...verifiedIdentity, status: 'pending' } }),
    );
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toContain('not verified');
  });

  it('refuses when no identity is chosen at all', async () => {
    const result = await resolveCampaignSender(
      fakeDb() as unknown as Db, env, 7, binding({ senderIdentity: null }),
    );
    expect(result).toMatchObject({ ok: false });
  });

  it('treats an unknown transport string as the platform default', async () => {
    // The value comes off a database column; an unrecognised one must degrade to
    // the safest transport rather than throwing inside the send loop.
    const result = await resolveCampaignSender(
      fakeDb() as unknown as Db, env, 7, binding({ transport: 'carrier-pigeon' }),
    );
    expect(result.ok && result.sender.transport).toBe('platform');
  });
});

describe('resolveCampaignSender — mailbox', () => {
  const mailboxBinding = binding({
    transport: 'mailbox', senderIdentity: null, mailboxConnectionId: 3, fromName: 'Ada',
  });

  const connected = {
    id: 3, provider: 'google', accountEmail: 'ada@acme.test', displayName: 'Ada',
    status: 'connected', allowSending: true, lastError: null, lastSyncedAt: null, createdAt: new Date(),
  };

  /** `getMailboxConnection` is imported dynamically inside the resolver, so the
   *  module is mocked rather than the query being replayed through fakeDb. */
  const withConnection = (row: unknown) => {
    vi.doMock('../mailbox/mailboxService', () => ({
      getMailboxConnection: vi.fn(async () => row),
      sendFromMailbox: vi.fn(async () => ({ ok: true, id: 'x', accountEmail: 'ada@acme.test' })),
    }));
  };

  it('refuses when no mailbox is chosen', async () => {
    const result = await resolveCampaignSender(
      fakeDb() as unknown as Db, env, 7, { ...mailboxBinding, mailboxConnectionId: null },
    );
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toContain('connected mailbox');
  });

  it('resolves a live, send-enabled mailbox and uses the campaign display name', async () => {
    vi.resetModules();
    withConnection(connected);
    const { resolveCampaignSender: resolve } = await import('./campaignTransports');
    const result = await resolve(fakeDb() as unknown as Db, env, 7, mailboxBinding);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sender.transport).toBe('mailbox');
    expect(result.sender.fromLabel).toBe('Ada <ada@acme.test>');
  });

  it('refuses a REVOKED grant with the reconnect instruction, not a bare failure', async () => {
    vi.resetModules();
    withConnection({ ...connected, status: 'revoked' });
    const { resolveCampaignSender: resolve } = await import('./campaignTransports');
    const result = await resolve(fakeDb() as unknown as Db, env, 7, mailboxBinding);
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toContain('reconnected');
  });

  it('honours the per-mailbox sending opt-out — readable is not the same as sendable', async () => {
    vi.resetModules();
    withConnection({ ...connected, allowSending: false });
    const { resolveCampaignSender: resolve } = await import('./campaignTransports');
    const result = await resolve(fakeDb() as unknown as Db, env, 7, mailboxBinding);
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toContain('turned off');
  });

  it('refuses a mailbox that has since been disconnected', async () => {
    vi.resetModules();
    withConnection(null);
    const { resolveCampaignSender: resolve } = await import('./campaignTransports');
    const result = await resolve(fakeDb() as unknown as Db, env, 7, mailboxBinding);
    expect(result).toMatchObject({ ok: false });
  });
});

describe('resolveCampaignSender — sendgrid', () => {
  const sendgridBinding = binding({ transport: 'sendgrid', connectorConnectionId: 'conn-1' });
  const enabledConnection = { id: 'conn-1', name: 'Production', connectorKey: 'sendgrid', enabled: true };

  it('refuses when no connection is chosen', async () => {
    const result = await resolveCampaignSender(
      fakeDb() as unknown as Db, env, 7, { ...sendgridBinding, connectorConnectionId: null },
    );
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toContain('SendGrid');
  });

  it('resolves an enabled SendGrid connection', async () => {
    const result = await resolveCampaignSender(
      fakeDb([[enabledConnection]]) as unknown as Db, env, 7, sendgridBinding,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sender.transport).toBe('sendgrid');
    expect(result.sender.fromLabel).toBe('Acme <hi@acme.test>');
  });

  it('STILL requires a verified identity — SendGrid enforces its own sender verification', async () => {
    // The connector replaces the delivery PIPE, never the identity model.
    const result = await resolveCampaignSender(
      fakeDb([[enabledConnection]]) as unknown as Db, env, 7,
      { ...sendgridBinding, senderIdentity: { ...verifiedIdentity, status: 'pending' } },
    );
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toContain('not verified');
  });

  it('refuses a connection that belongs to a DIFFERENT connector', async () => {
    const result = await resolveCampaignSender(
      fakeDb([[{ ...enabledConnection, connectorKey: 'slack' }]]) as unknown as Db, env, 7, sendgridBinding,
    );
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toContain('not a SendGrid connection');
  });

  it('refuses a disabled connection, naming it', async () => {
    const result = await resolveCampaignSender(
      fakeDb([[{ ...enabledConnection, enabled: false }]]) as unknown as Db, env, 7, sendgridBinding,
    );
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toContain('Production');
  });

  it('refuses a connection that no longer exists', async () => {
    const result = await resolveCampaignSender(fakeDb([[]]) as unknown as Db, env, 7, sendgridBinding);
    expect(result).toMatchObject({ ok: false });
  });
});

describe('TransportError', () => {
  it('carries the retryable flag the send engine branches on', () => {
    // The engine requeues a retryable failure and writes off a terminal one;
    // without this flag it could only do one or the other.
    expect(new TransportError('429', true).retryable).toBe(true);
    expect(new TransportError('bad key', false).retryable).toBe(false);
  });
});
