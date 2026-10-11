/**
 * Commerce test helpers — mocked Stripe provider, in-memory db, auth
 * scaffolding. Copied from knowledgeCommerce.test.ts for the replay purchase
 * flow. One set per test file keeps the tests readable.
 */
import { vi, describe, expect, it } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { buildPaymentProvider } from '../../infrastructure/payment';
import { SYSTEM_ACTOR } from '../activity/activityLog';
import { REPLAY_PACKS } from './replayCatalog';
import { replayUpgradePrompt } from './replayPacks';

/**
 * First recorded argument of a spy. Throws instead of `!` so
 * `noUncheckedIndexedAccess` does not make `mock.calls[0][0]` a
 * possibly-undefined read.
 */
function firstCallArg<T>(spy: { mock: { calls: unknown[][] } }): T {
  const call = spy.mock.calls[0];
  if (!call) {
    throw new Error('expected mock to have been called');
  }
  const arg = call[0];
  if (arg === undefined) {
    throw new Error('expected mock call argument');
  }
  return arg as T;
}

// ──────────────────────────────────────────────────────────────────────────────
// Mocked payment provider — same pattern as knowledgeCommerce.test.ts
// ──────────────────────────────────────────────────────────────────────────────

vi.mock('../../infrastructure/payment', () => {
  class PaymentNotConfiguredError extends Error {
    readonly code = 'payment_not_configured' as const;
    constructor(public missing: string) {
      super(`Payments are not configured: ${missing} is not set on this Worker.`);
      this.name = 'PaymentNotConfiguredError';
    }
  }
  const mockSession = {
    checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_123',
    sessionId: 'cs_test_123',
  };
  const createOneTimeCheckoutSession = vi.fn().mockResolvedValue(mockSession);
  return {
    PaymentNotConfiguredError,
    buildPaymentProvider: vi.fn((env: { STRIPE_SECRET_KEY?: string }) => {
      if (!env.STRIPE_SECRET_KEY) {
        return {
          createOneTimeCheckoutSession: () =>
            Promise.reject(new PaymentNotConfiguredError('STRIPE_SECRET_KEY')),
        };
      }
      return { createOneTimeCheckoutSession };
    }),
  };
});

// ──────────────────────────────────────────────────────────────────────────────
// Test — upgrade prompts and access state
// ──────────────────────────────────────────────────────────────────────────────

describe('replayAccess and upgrade prompts', () => {
  it('prompts to install when the capability is not present', () => {
    const prompt = replayUpgradePrompt('not_installed');
    expect(prompt.cta).toBe('install');
    expect(prompt.packs).toEqual(REPLAY_PACKS);
  });

  it('prompts to buy a pack when free is exhausted', () => {
    const prompt = replayUpgradePrompt('exhausted');
    expect(prompt.cta).toBe('buy_pack');
    expect(prompt.packs).toEqual(REPLAY_PACKS);
  });

  it('replayUpgradePrompt returns install prompt with correct structure', () => {
    const prompt = replayUpgradePrompt('not_installed');
    expect(prompt).toEqual({
      reason: 'not_installed',
      title: 'Install session replay',
      body: expect.stringContaining('free install'),
      cta: 'install',
      packs: REPLAY_PACKS,
    });
  });

  it('replayUpgradePrompt returns exhausted prompt with correct structure', () => {
    const prompt = replayUpgradePrompt('exhausted');
    expect(prompt).toEqual({
      reason: 'exhausted',
      title: 'Recording allowance used up',
      body: expect.stringContaining('paid credits'),
      cta: 'buy_pack',
      packs: REPLAY_PACKS,
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Test — checkout flow end-to-end (no real Stripe)
// ──────────────────────────────────────────────────────────────────────────────

describe('replay pack checkout flow', () => {
  // Minimal fake DB for the checkout function — it reads packs from catalog_items
  // (empty in test) and falls back to REPLAY_PACKS, so we can call the
  // checkout function directly.
  const fakeDb = {
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
    insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: () => Promise.resolve([{ id: 1 }]) }) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) }),
    delete: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
  } as unknown as Db;

  const fakeEnv = {
    STRIPE_SECRET_KEY: 'sk_test_123',
  } as unknown as Env;

  it('startReplayPackCheckout builds a session with correct metadata', async () => {
    const { startReplayPackCheckout } = await import('./replayPacks');
    const result = await startReplayPackCheckout(fakeDb, fakeEnv, {
      tenantId: 7,
      buyerRef: 'u1',
      packId: 'p10k',
      billingEmail: 'buyer@example.com',
      returnUrl: 'https://app.example.com/replay',
      actor: SYSTEM_ACTOR,
    });

    expect(result.pack.id).toBe('p10k');
    expect(result.pack.cents).toBe(4_000);
    expect(result.sessionId).toBe('cs_test_123');
    expect(result.checkoutUrl).toBe('https://checkout.stripe.com/pay/cs_test_123');

    const provider = await buildPaymentProvider(fakeEnv);
    const call = firstCallArg<{
      metadata: Record<string, string>;
      idempotencyKey: string;
    }>(provider.createOneTimeCheckoutSession as ReturnType<typeof vi.fn>);
    expect(call.metadata).toEqual({
      purchaseKind: 'replay_pack',
      tenantId: '7',
      packId: 'p10k',
      cents: '4000',
      buyerRef: 'u1',
    });
    expect(call.idempotencyKey).toMatch(/^replay-pack:7:p10k:/);
  });

  it('startReplayPackCheckout throws when payments are not configured', async () => {
    const { startReplayPackCheckout } = await import('./replayPacks');
    const noStripe = { STRIPE_SECRET_KEY: undefined } as unknown as Env;
    await expect(startReplayPackCheckout(fakeDb, noStripe, {
      tenantId: 7,
      buyerRef: 'u1',
      packId: 'p10k',
      returnUrl: 'https://app.example.com/replay',
    })).rejects.toThrow('Payments are not configured');
  });

  it('startReplayPackCheckout throws for an unknown pack', async () => {
    const { startReplayPackCheckout } = await import('./replayPacks');
    await expect(startReplayPackCheckout(fakeDb, fakeEnv, {
      tenantId: 7,
      buyerRef: 'u1',
      packId: 'does-not-exist',
      returnUrl: 'https://app.example.com/replay',
    })).rejects.toThrow('That recording pack does not exist');
  });
});
