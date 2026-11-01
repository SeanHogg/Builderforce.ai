/**
 * `POST /connections/:id/send` and the do-not-contact list. A person may knowingly write to
 * someone who unsubscribed from marketing (a reply to a customer), but is told first: 409
 * `do_not_contact` until the body carries `confirmDoNotContact: true`. The check runs for real
 * against a fake database; the send itself is replaced.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../../env';
import { fakeDb } from '../../../test/fakeDb';

vi.mock('../middleware/authMiddleware', async (importOriginal) => {
  const real = await importOriginal<typeof import('../middleware/authMiddleware')>();
  const fakeAuth: MiddlewareHandler<HonoEnv> = async (c, next) => {
    c.set('tenantId', 7);
    c.set('userId', 'u1');
    c.set('role', 'manager' as never);
    await next();
  };
  return { ...real, authMiddleware: fakeAuth };
});
vi.mock('../../application/mailbox/mailboxService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../application/mailbox/mailboxService')>()),
  sendFromMailbox: vi.fn(async () => ({ ok: true, id: 'sent-1', accountEmail: 'me@acme.test' })),
}));

import { errorHandler } from '../middleware/errorHandler';
import { sendFromMailbox } from '../../application/mailbox/mailboxService';
import { createMailboxRoutes } from './mailboxRoutes';

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

const post =(db: ReturnType<typeof fakeDb>, body: Record<string, unknown>) => {
  const router = createMailboxRoutes(db as never);
  router.onError(errorHandler as never);
  return router.request(
    '/connections/3/send',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subject: 'Hi', html: '<p>Hi</p>', ...body }) },
    {} as never,
    ctx,
  );
};
/** A suppression-ledger hit for `erased@x.com`: what the one check statement reads. */
const listed = () => fakeDb([[{ k: 'e', v: 'erased@x.com' }]]);

beforeEach(() => vi.mocked(sendFromMailbox).mockClear());

describe('POST /connections/:id/send — do-not-contact', () => {
  it('answers 409 do_not_contact and does not send, when the recipient is on a list', async () => {
    const res = await post(listed(), { to: 'Jane <Erased@X.com>' });
    expect(res.status).toBe(409);
    const json = await res.json() as { error: string; code: string };
    expect(json.code).toBe('do_not_contact');
    expect(json.error).toMatch(/do-not-contact/);
    expect(sendFromMailbox).not.toHaveBeenCalled();
  });

  it('catches a do-not-contact address anywhere in a multi-address `to`', async () => {
    const res = await post(listed(), { to: 'ok@y.com, "Doe, Jane" <Erased@X.com>' });
    expect(res.status).toBe(409);
    expect(sendFromMailbox).not.toHaveBeenCalled();
  });

  it('sends when the person confirmed, without even asking the list', async () => {
    const db = listed();
    const res = await post(db, { to: 'erased@x.com', confirmDoNotContact: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sent: true, id: 'sent-1' });
    expect(sendFromMailbox).toHaveBeenCalledTimes(1);
    expect(db.calls).toHaveLength(0);
  });

  it('sends to a recipient that is on no list', async () => {
    const res = await post(fakeDb([[]]), { to: 'ok@y.com' });
    expect(res.status).toBe(200);
    expect(sendFromMailbox).toHaveBeenCalledTimes(1);
  });
});
