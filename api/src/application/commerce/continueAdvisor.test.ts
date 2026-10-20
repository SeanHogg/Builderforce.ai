/**
 * The founder-side relation (users.advisor_reservation_id) and the second
 * session that reuses it. The booker is injected so the test proves WHICH
 * advisor and service were booked, not the overlap transaction that owns.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { ActorIdentity } from '../activity/activityLog';
const reserveForHost = vi.fn(async () => ({ id: 901, status: 'confirmed' }));
vi.mock('./bookings', () => ({ reserveForHost: (...a: unknown[]) => reserveForHost(...(a as [])) }));

import {
  ContinueAdvisorError,
  continueWithAdvisor,
  recordAdvisorRelation,
  reserveContinuation,
  type AdvisorSessionRow,
} from './continueAdvisor';

const founder = 'founder-1';
const advisor = 'advisor-9';
const completed: AdvisorSessionRow = {
  id: 42,
  tenantId: 3,
  serviceId: 7,
  hostRef: advisor,
  bookerRef: founder,
  status: 'completed',
};

const actor: ActorIdentity = { type: 'human', ref: founder, name: 'Founder' };
const env = {} as Env;
const startsAt = new Date('2026-11-02T15:00:00.000Z');

function fakeDb(session: AdvisorSessionRow | null, relationId: number | null) {
  const updates: Array<{ set: Record<string, unknown> }> = [];
  const db = {
    select: (fields: Record<string, unknown>) => {
      const relation = 'advisorReservationId' in fields;
      const chain = {
        from: () => chain,
        where: () => chain,
        limit: async () => (relation ? [{ advisorReservationId: relationId }] : session ? [session] : []),
      };
      return chain;
    },
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: async () => { updates.push({ set }); },
      }),
    }),
  };
  return { db: db as unknown as Db, updates };
}

describe('recordAdvisorRelation', () => {
  it('writes the completed session onto the founder user row', async () => {
    const { db, updates } = fakeDb(completed, null);
    const written = await recordAdvisorRelation(db, { founderRef: founder, reservationId: 42 });

    expect(written).toMatchObject({
      table: 'users',
      column: 'advisor_reservation_id',
      founderRef: founder,
      reservationId: 42,
      advisorUserId: advisor,
      serviceId: 7,
      tenantId: 3,
    });
    // Through the Drizzle `users.advisorReservationId` column, not raw SQL.
    expect(updates).toEqual([{ set: { advisorReservationId: 42 } }]);
  });

  it('refuses a session that is not completed', async () => {
    const { db } = fakeDb({ ...completed, status: 'confirmed' }, null);
    await expect(recordAdvisorRelation(db, { founderRef: founder, reservationId: 42 }))
      .rejects.toBeInstanceOf(ContinueAdvisorError);
  });

  it('refuses a session booked by someone else', async () => {
    const { db } = fakeDb({ ...completed, bookerRef: 'other-founder' }, null);
    await expect(recordAdvisorRelation(db, { founderRef: founder, reservationId: 42 }))
      .rejects.toMatchObject({ status: 404 });
  });
});

describe('continueWithAdvisor', () => {
  it('books a second session with the stored advisor and service — no catalogue search', async () => {
    const book = vi.fn(async () => ({ id: 900, status: 'confirmed' as const }));
    const { db } = fakeDb(completed, 42);

    const continued = await continueWithAdvisor(
      db, env, actor, { founderRef: founder, startsAt, timezone: 'UTC' }, book,
    );

    expect(continued.reservationId).toBe(42);
    expect(continued.advisorUserId).toBe(advisor);
    expect(continued.serviceId).toBe(7);
    expect(book).toHaveBeenCalledTimes(1);
    expect(book).toHaveBeenCalledWith(db, env, 3, actor, {
      serviceId: 7,
      startsAt,
      hostRef: advisor,
      bookerRef: founder,
      timezone: 'UTC',
    });
  });

  it('refuses a cold start when the founder has no stored relation', async () => {
    const book = vi.fn(async () => ({ id: 900, status: 'confirmed' as const }));
    const { db } = fakeDb(completed, null);
    await expect(continueWithAdvisor(db, env, actor, { founderRef: founder, startsAt }, book))
      .rejects.toMatchObject({ status: 404, message: 'no continued advisor relationship' });
    expect(book).not.toHaveBeenCalled();
  });
});

describe('reserveContinuation', () => {
  it('books through the Marketplace Book guard + provisioning, pinned to the session tenant', async () => {
    const { db } = fakeDb(completed, 42);
    await reserveContinuation(db, env, 3, actor, {
      serviceId: 7, startsAt, hostRef: advisor, bookerRef: founder, timezone: 'UTC',
    });
    expect(reserveForHost).toHaveBeenCalledWith(db, env, actor, advisor, {
      serviceId: 7, startsAt, bookerRef: founder, timezone: 'UTC',
    }, { tenantId: 3 });
  });
});
