import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/**
 * `mailbox.send` is the agent's way to email one person, and an agent has no human to be warned
 * about a do-not-contact recipient, so the tool refuses. The check runs for real (against a fake
 * database) so what the tool does with a multi-address `to` is the check's own behaviour.
 */
vi.mock('../mailbox/mailboxService', () => ({
  resolveMailbox: vi.fn(async () => ({ ok: true, connection: { id: 3, accountEmail: 'me@acme.test' } })),
  sendFromMailbox: vi.fn(async () => ({ ok: true, id: 'sent-1', accountEmail: 'me@acme.test' })),
}));
vi.mock('../activity/activityLog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../activity/activityLog')>()),
  recordActivity: vi.fn(async () => undefined),
}));
vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));

import { callBuiltinTool } from './builtinMcpService';
import { sendFromMailbox } from '../mailbox/mailboxService';
import { TenantRole } from '../../domain/shared/types';

const send = (db: ReturnType<typeof fakeDb>, to: string) =>
  callBuiltinTool(db as unknown as Db, {
    tenantId: 7, tool: 'mailbox.send', env: {} as Env, role: TenantRole.MANAGER,
    arguments: { to, subject: 'Hello', html: '<p>Hi</p>' },
  });

beforeEach(() => vi.mocked(sendFromMailbox).mockClear());

describe('mailbox.send and the do-not-contact list', () => {
  it('refuses a do-not-contact recipient and sends nothing', async () => {
    const db = fakeDb([[{ k: 'e', v: 'erased@x.com' }]]);
    await expect(send(db, 'Jane <Erased@X.com>')).rejects.toThrow(/do-not-contact list.*NOT sent/);
    expect(sendFromMailbox).not.toHaveBeenCalled();
  });

  it('refuses when ANY address in a multi-address `to` is do-not-contact', async () => {
    const db = fakeDb([[{ k: 'e', v: 'erased@x.com' }]]);
    await expect(send(db, 'ok@y.com, "Doe, Jane" <Erased@X.com>')).rejects.toThrow(/do-not-contact/);
    expect(sendFromMailbox).not.toHaveBeenCalled();
  });

  it('sends to a recipient that is on no list', async () => {
    const db = fakeDb([[]]);
    await expect(send(db, 'ok@y.com')).resolves.toMatchObject({ sent: true, id: 'sent-1' });
    expect(sendFromMailbox).toHaveBeenCalledTimes(1);
  });
});
