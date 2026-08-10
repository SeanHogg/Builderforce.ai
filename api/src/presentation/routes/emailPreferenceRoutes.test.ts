/**
 * The PUBLIC unsubscribe endpoint, driven end-to-end through Hono.
 *
 * This leg is the one that has to work when nothing else does: no session, no
 * JavaScript, opened from a mail client on an unknown device, possibly years
 * after the send. It is also the leg that carries legal weight — a broken
 * unsubscribe is a CAN-SPAM violation, not a cosmetic bug — so it gets real
 * request-level coverage rather than unit coverage of its helpers.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';
import { createEmailPreferenceRoutes } from './emailPreferenceRoutes';
import { signUnsubscribeToken } from '../../application/email/sendEmail';

const JWT_SECRET = 'unsubscribe-test-secret';

/** Captures what the route upserted so the assertion is about BEHAVIOUR (consent
 *  actually recorded), not about which query builder methods were called. */
function makeDb(userRow: Record<string, unknown> | null) {
  const upserts: Record<string, unknown>[] = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (userRow ? [userRow] : []),
        }),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoUpdate: async () => { upserts.push(v); },
      }),
    }),
  } as unknown as Db;
  return { db, upserts };
}

function mountApp(db: Db) {
  const app = new Hono<HonoEnv>();
  app.route('/api/email-preferences', createEmailPreferenceRoutes(db));
  return app;
}

const ENV = { JWT_SECRET } as Env;

describe('GET /api/email-preferences/unsubscribe', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('records a global opt-out for a valid token and confirms in HTML', async () => {
    const { db, upserts } = makeDb({ id: 'u1', locale: 'en', email: 'ada@example.com' });
    const token = await signUnsubscribeToken(JWT_SECRET, 'ada@example.com');

    const res = await mountApp(db).request(
      `/api/email-preferences/unsubscribe?token=${encodeURIComponent(token)}`,
      {},
      ENV,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');

    const html = await res.text();
    expect(html).toContain('ada@example.com');
    // The user must be told what they will STILL receive, or a "why am I still
    // getting mail from you" complaint is guaranteed.
    expect(html).toContain('Account and security messages are still sent');

    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ email: 'ada@example.com', unsubscribedAll: true });
  });

  it('renders the confirmation in the account holder’s language', async () => {
    // They just clicked a link inside a German email; switching them to English
    // at the final step would be jarring.
    const { db } = makeDb({ id: 'u1', locale: 'de', email: 'kurt@example.com' });
    const token = await signUnsubscribeToken(JWT_SECRET, 'kurt@example.com');

    const res = await mountApp(db).request(
      `/api/email-preferences/unsubscribe?token=${encodeURIComponent(token)}`, {}, ENV,
    );
    const html = await res.text();
    expect(html).toContain('Sie wurden abgemeldet');
    expect(html).toContain('Abmelden');
  });

  it('still unsubscribes an address that has no account', async () => {
    // A cold workspace invite goes to someone with no `users` row. Their opt-out
    // has to stick anyway — that is why consent is keyed on email, not user id.
    const { db, upserts } = makeDb(null);
    const token = await signUnsubscribeToken(JWT_SECRET, 'cold@example.com');

    const res = await mountApp(db).request(
      `/api/email-preferences/unsubscribe?token=${encodeURIComponent(token)}`, {}, ENV,
    );

    expect(res.status).toBe(200);
    expect(upserts[0]).toMatchObject({ email: 'cold@example.com', unsubscribedAll: true, userId: null });
  });

  it('rejects a tampered token without recording anything', async () => {
    const { db, upserts } = makeDb({ id: 'u1', locale: 'en', email: 'ada@example.com' });
    const token = await signUnsubscribeToken(JWT_SECRET, 'ada@example.com');

    const res = await mountApp(db).request(
      `/api/email-preferences/unsubscribe?token=${encodeURIComponent(token + 'x')}`, {}, ENV,
    );

    expect(res.status).toBe(400);
    expect(upserts).toHaveLength(0);
  });

  it('rejects a missing token without recording anything', async () => {
    const { db, upserts } = makeDb(null);
    const res = await mountApp(db).request('/api/email-preferences/unsubscribe', {}, ENV);
    expect(res.status).toBe(400);
    expect(upserts).toHaveLength(0);
  });

  it('needs no Authorization header at all', async () => {
    // The whole point: it works from a mail client with no session.
    const { db } = makeDb({ id: 'u1', locale: 'en', email: 'ada@example.com' });
    const token = await signUnsubscribeToken(JWT_SECRET, 'ada@example.com');
    const res = await mountApp(db).request(
      `/api/email-preferences/unsubscribe?token=${encodeURIComponent(token)}`,
      { headers: {} },
      ENV,
    );
    expect(res.status).toBe(200);
  });

  it('lowercases the address so the opt-out is not case-sensitive', async () => {
    const { db, upserts } = makeDb(null);
    const token = await signUnsubscribeToken(JWT_SECRET, 'Ada@Example.COM');
    await mountApp(db).request(
      `/api/email-preferences/unsubscribe?token=${encodeURIComponent(token)}`, {}, ENV,
    );
    expect(upserts[0]).toMatchObject({ email: 'ada@example.com' });
  });
});
