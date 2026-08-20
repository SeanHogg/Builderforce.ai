import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hmacSha256Hex } from '../../infrastructure/crypto/webhookHmac';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

// The stored secret never leaves the vault in a test either — the ingest path
// decrypts, and here that decrypt is stubbed to hand back this exact value.
const SECRET = ['whsec', 'test', 'webhook', 'ingest', '0123456789abcdef'].join('_');

vi.mock('../integrations/credentialCrypto', () => ({
  credentialSecret: () => 'base-secret',
  decryptCredentials: async () => ({ secret: SECRET }),
}));

const submitFeedback = vi.fn();
vi.mock('./feedbackEngine', () => ({
  submitFeedback: (...args: unknown[]) => submitFeedback(...args),
}));

const { ingestFeedbackWebhook } = await import('./feedbackWebhookIngest');

const COLLECTOR = {
  id: 'col-1', tenantId: 7, projectId: 3, enabled: true, autoCreateTask: true, dailyLimit: 100,
};
const INTEGRATION = { id: 'int-1', enabled: true, secretEnc: 'v2:xxx', secretIv: 'iv' };

interface DbCalls {
  inserts: number;
  deletes: number;
  updates: number;
}

/**
 * Chainable drizzle stand-in. `selects` is consumed in order (collector, then
 * integration); `insertBehaviour` decides whether the delivery claim succeeds or
 * loses the unique race that IS the replay guard.
 */
function mockDb(
  selects: unknown[][],
  insertBehaviour: 'ok' | 'conflict',
  calls: DbCalls,
): Db {
  let i = 0;
  const selectChain: Record<string, unknown> = {
    from: () => selectChain,
    where: () => selectChain,
    limit: () => Promise.resolve(i < selects.length ? selects[i++] : []),
  };
  const thenable = (onFinish: () => void) => {
    const chain: Record<string, unknown> = {
      set: () => chain,
      where: () => { onFinish(); return Promise.resolve([{ id: 'row' }]); },
      returning: () => { onFinish(); return Promise.resolve([{ id: 'row' }]); },
    };
    return chain;
  };
  return {
    select: () => selectChain,
    insert: () => ({
      values: () => ({
        returning: () => {
          calls.inserts++;
          if (insertBehaviour === 'conflict') {
            return Promise.reject(Object.assign(new Error('duplicate key value violates unique constraint "uq_feedback_webhook_delivery"'), { code: '23505' }));
          }
          return Promise.resolve([{ id: 'delivery-1' }]);
        },
      }),
    }),
    update: () => thenable(() => { calls.updates++; }),
    delete: () => thenable(() => { calls.deletes++; }),
  } as unknown as Db;
}

const env = { JWT_SECRET: 'jwt' } as unknown as Env;

/** A PostHog survey response, signed the way the adapter expects. */
async function signedPosthog(overrides: Record<string, unknown> = {}) {
  const rawBody = JSON.stringify({
    event: { uuid: 'evt-1', event: 'survey sent', properties: { $survey_response: 'bulk edit please' } },
    ...overrides,
  });
  const sig = await hmacSha256Hex(SECRET, rawBody);
  return { rawBody, getHeader: (n: string) => (n.toLowerCase() === 'x-posthog-signature' ? sig : undefined) };
}

describe('ingestFeedbackWebhook', () => {
  beforeEach(() => {
    submitFeedback.mockReset();
    submitFeedback.mockResolvedValue({ submissionId: 'sub-1', taskId: 42, deduped: false });
  });

  it('accepts a correctly signed delivery and routes it through the shared engine', async () => {
    const calls: DbCalls = { inserts: 0, deletes: 0, updates: 0 };
    const { rawBody, getHeader } = await signedPosthog();
    const out = await ingestFeedbackWebhook(
      mockDb([[COLLECTOR], [INTEGRATION]], 'ok', calls), env,
      { collectorId: 'col-1', provider: 'posthog', rawBody, getHeader },
    );
    expect(out).toMatchObject({ kind: 'accepted', eventId: 'evt-1', submissionIds: ['sub-1'] });

    // The whole point of the design: one ingest path. The webhook must reach the
    // SAME submitFeedback the snippet does, carrying the collector's ceiling.
    expect(submitFeedback).toHaveBeenCalledTimes(1);
    expect(submitFeedback.mock.calls[0]![2]).toMatchObject({
      collectorId: 'col-1', tenantId: 7, projectId: 3, dailyLimit: 100,
    });
    expect(calls.deletes).toBe(0);
  });

  it('rejects a tampered body before writing anything', async () => {
    const calls: DbCalls = { inserts: 0, deletes: 0, updates: 0 };
    const { getHeader } = await signedPosthog();
    const tampered = JSON.stringify({ event: { uuid: 'evt-1', event: 'survey sent', properties: { $survey_response: 'something else' } } });
    const out = await ingestFeedbackWebhook(
      mockDb([[COLLECTOR], [INTEGRATION]], 'ok', calls), env,
      { collectorId: 'col-1', provider: 'posthog', rawBody: tampered, getHeader },
    );
    expect(out).toEqual({ kind: 'invalid_signature' });
    // No delivery row, no submission: an unauthenticated caller must not be able
    // to make us do work by posting at a guessed URL.
    expect(calls.inserts).toBe(0);
    expect(submitFeedback).not.toHaveBeenCalled();
  });

  it('refuses an integration that has no secret rather than accepting unsigned posts', async () => {
    const calls: DbCalls = { inserts: 0, deletes: 0, updates: 0 };
    const { rawBody, getHeader } = await signedPosthog();
    const out = await ingestFeedbackWebhook(
      mockDb([[COLLECTOR], [{ ...INTEGRATION, secretEnc: null, secretIv: null }]], 'ok', calls), env,
      { collectorId: 'col-1', provider: 'posthog', rawBody, getHeader },
    );
    expect(out).toEqual({ kind: 'not_configured' });
    expect(submitFeedback).not.toHaveBeenCalled();
  });

  it('treats a re-delivered event as a duplicate instead of opening a second ticket', async () => {
    const calls: DbCalls = { inserts: 0, deletes: 0, updates: 0 };
    const { rawBody, getHeader } = await signedPosthog();
    const out = await ingestFeedbackWebhook(
      mockDb([[COLLECTOR], [INTEGRATION]], 'conflict', calls), env,
      { collectorId: 'col-1', provider: 'posthog', rawBody, getHeader },
    );
    expect(out).toEqual({ kind: 'duplicate', eventId: 'evt-1' });
    expect(submitFeedback).not.toHaveBeenCalled();
  });

  it('UN-CLAIMS the delivery when the plan quota refuses it, so a retry can land', async () => {
    submitFeedback.mockResolvedValue({ quotaExceeded: true, effectivePlan: 'free', used: 200, limit: 200 });
    const calls: DbCalls = { inserts: 0, deletes: 0, updates: 0 };
    const { rawBody, getHeader } = await signedPosthog();
    const out = await ingestFeedbackWebhook(
      mockDb([[COLLECTOR], [INTEGRATION]], 'ok', calls), env,
      { collectorId: 'col-1', provider: 'posthog', rawBody, getHeader },
    );
    expect(out).toEqual({ kind: 'quota_exceeded', effectivePlan: 'free', used: 200, limit: 200 });
    // Leaving the row claimed would turn every later retry into a silent
    // "duplicate" and drop the customer's request permanently.
    expect(calls.deletes).toBe(1);
  });

  it('un-claims a rolling-24h refusal for the same reason', async () => {
    submitFeedback.mockResolvedValue({ rateLimited: true });
    const calls: DbCalls = { inserts: 0, deletes: 0, updates: 0 };
    const { rawBody, getHeader } = await signedPosthog();
    const out = await ingestFeedbackWebhook(
      mockDb([[COLLECTOR], [INTEGRATION]], 'ok', calls), env,
      { collectorId: 'col-1', provider: 'posthog', rawBody, getHeader },
    );
    expect(out).toEqual({ kind: 'rate_limited' });
    expect(calls.deletes).toBe(1);
  });

  it('records — but does not submit — an authentic event it does not import', async () => {
    const calls: DbCalls = { inserts: 0, deletes: 0, updates: 0 };
    const rawBody = JSON.stringify({ event: { uuid: 'evt-9', event: 'order completed', properties: { message: 'shipped' } } });
    const sig = await hmacSha256Hex(SECRET, rawBody);
    const out = await ingestFeedbackWebhook(
      mockDb([[COLLECTOR], [INTEGRATION]], 'ok', calls), env,
      { collectorId: 'col-1', provider: 'posthog', rawBody, getHeader: () => sig },
    );
    expect(out).toEqual({ kind: 'ignored', eventId: 'evt-9' });
    // The claim STAYS, so the sender's retries of it cost one index hit.
    expect(calls.inserts).toBe(1);
    expect(calls.deletes).toBe(0);
  });

  it('answers an unknown provider and an unknown collector without touching the engine', async () => {
    const calls: DbCalls = { inserts: 0, deletes: 0, updates: 0 };
    expect(await ingestFeedbackWebhook(
      mockDb([], 'ok', calls), env,
      { collectorId: 'col-1', provider: 'logrocket', rawBody: '{}', getHeader: () => undefined },
    )).toEqual({ kind: 'unknown_provider' });

    expect(await ingestFeedbackWebhook(
      mockDb([[]], 'ok', calls), env,
      { collectorId: 'nope', provider: 'sentry', rawBody: '{}', getHeader: () => undefined },
    )).toEqual({ kind: 'unknown_collector' });

    expect(submitFeedback).not.toHaveBeenCalled();
  });
});
