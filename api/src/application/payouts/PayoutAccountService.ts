/**
 * Payout destinations, and the money that leaves through them.
 *
 * Two responsibilities that belong together because neither is meaningful alone:
 *
 *  1. **Connect / describe / disconnect** a destination — the write side of
 *     {@link payoutConnections}, with the credential sealed by the same
 *     `credentialCrypto` every other connection uses.
 *  2. **Pay** — take what a person has EARNED (their own domain's fact), subtract
 *     what has already been PAID (the ledger), and move the difference through
 *     their connected provider.
 *
 * The earned/paid split is the one design decision worth defending. Commission is
 * already a fact on `sales_referrals` and an invoice is already a fact on the
 * hiring tables; copying either into the ledger would put one fact in two places
 * and guarantee they eventually disagree. So the ledger holds ONLY money that
 * actually moved (`entry_kind = 'payout'`), the domain holds what is owed, and
 * "available" is the subtraction — which cannot drift, because there is nothing
 * to keep in sync.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { ledgerEntries, payoutConnections } from '../../infrastructure/database/schema';
import { credentialSecret, decryptCredentials, encryptCredentials } from '../integrations/credentialCrypto';
import { createPayout as createWebhookPayout, isPayoutsConfigured } from '../integrations/payments';
import {
  getPayoutProvider,
  type PayoutCredential,
  type PayoutProviderName,
  type PayoutResult,
} from './payoutProviders';

/** The ledger denomination every money-shaped row in this file speaks. */
const USD_CENTS = 'usd_cents';

/** A connected destination as any surface may see it — never a credential. */
export interface PayoutAccountView {
  id: number;
  provider: PayoutProviderName;
  label: string;
  currency: string | null;
  country: string | null;
  status: string;
  isDefault: boolean;
  lastError: string | null;
  lastPayoutAtISO: string | null;
  connectedAtISO: string;
}

export interface PayoutRecord {
  id: number;
  amountCents: number;
  status: string;
  provider: string;
  reference: string | null;
  memo: string | null;
  externalRef: string | null;
  occurredAtISO: string;
}

/** What a person is owed, what has left, and what is left to send. */
export interface PayoutBalance {
  earnedCents: number;
  paidCents: number;
  availableCents: number;
}

function view(row: typeof payoutConnections.$inferSelect): PayoutAccountView {
  return {
    id: row.id,
    provider: row.provider as PayoutProviderName,
    label: row.accountLabel,
    currency: row.currency,
    country: row.country,
    status: row.status,
    isDefault: row.isDefault,
    lastError: row.lastError,
    lastPayoutAtISO: row.lastPayoutAt ? row.lastPayoutAt.toISOString() : null,
    connectedAtISO: row.createdAt.toISOString(),
  };
}

export class PayoutAccountService {
  constructor(private readonly db: Db, private readonly env: Env) {}

  /** Every destination this person has connected, default first. */
  async list(userId: string): Promise<PayoutAccountView[]> {
    const rows = await this.db.select().from(payoutConnections)
      .where(eq(payoutConnections.userId, userId))
      .orderBy(desc(payoutConnections.isDefault), desc(payoutConnections.createdAt));
    return rows.map(view);
  }

  /**
   * Store (or replace) a destination.
   *
   * The masked label is produced by the ADAPTER, from the credential, at write
   * time — not by the caller. A caller that formatted its own label would be a
   * second place that knows what a bank account looks like, and the one that
   * renders `•••• 4321` must be the one that has the digits.
   */
  async connect(input: {
    userId: string;
    tenantId: number;
    provider: PayoutProviderName;
    credential: PayoutCredential;
    makeDefault?: boolean;
  }): Promise<PayoutAccountView | null> {
    const provider = getPayoutProvider(input.provider);
    if (!provider) return null;
    const summary = provider.describe(input.credential);
    const sealed = await encryptCredentials(
      input.credential as unknown as Record<string, unknown>,
      credentialSecret(this.env),
      input.tenantId,
    );

    const values = {
      tenantId: input.tenantId,
      userId: input.userId,
      provider: input.provider,
      accountLabel: summary.label.slice(0, 255),
      currency: summary.currency,
      country: summary.country,
      externalAccountId: input.credential.externalAccountId ?? null,
      credentialEnc: sealed.enc,
      credentialIv: sealed.iv,
      status: 'connected',
      lastError: null,
      updatedAt: new Date(),
    };

    const [row] = await this.db.insert(payoutConnections).values(values)
      .onConflictDoUpdate({ target: [payoutConnections.userId, payoutConnections.provider], set: values })
      .returning();
    if (!row) return null;

    // The FIRST destination is the default whether or not anyone asked: a person
    // with exactly one connected account and no default would be told they have
    // nowhere to be paid, which is false.
    const existing = await this.db.select({ id: payoutConnections.id }).from(payoutConnections)
      .where(and(eq(payoutConnections.userId, input.userId), eq(payoutConnections.isDefault, true))).limit(1);
    if (!input.makeDefault && existing.length > 0) return view(row);
    return (await this.setDefault(input.userId, row.id)) ?? view(row);
  }

  /** Exactly one default, enforced by clearing the others first (the partial
   *  unique index is the backstop, not the mechanism). */
  async setDefault(userId: string, id: number): Promise<PayoutAccountView | null> {
    await this.db.update(payoutConnections).set({ isDefault: false, updatedAt: new Date() })
      .where(and(eq(payoutConnections.userId, userId), eq(payoutConnections.isDefault, true)));
    const [row] = await this.db.update(payoutConnections).set({ isDefault: true, updatedAt: new Date() })
      .where(and(eq(payoutConnections.userId, userId), eq(payoutConnections.id, id))).returning();
    return row ? view(row) : null;
  }

  /** Remove a destination. Any payout already sent through it stays in the
   *  ledger — deleting where money went is not a thing this offers. */
  async disconnect(userId: string, id: number): Promise<boolean> {
    const rows = await this.db.delete(payoutConnections)
      .where(and(eq(payoutConnections.userId, userId), eq(payoutConnections.id, id))).returning({ id: payoutConnections.id });
    if (rows.length === 0) return false;
    // Promote whatever is left, so removing the default never leaves a person
    // with connected accounts and nowhere to be paid.
    const [next] = await this.db.select({ id: payoutConnections.id }).from(payoutConnections)
      .where(eq(payoutConnections.userId, userId)).orderBy(desc(payoutConnections.createdAt)).limit(1);
    if (next) await this.setDefault(userId, next.id);
    return true;
  }

  private async openCredential(row: typeof payoutConnections.$inferSelect): Promise<PayoutCredential | null> {
    const blob = await decryptCredentials(row.credentialEnc, row.credentialIv, credentialSecret(this.env), row.tenantId);
    if (!blob) return null;
    return blob as unknown as PayoutCredential;
  }

  /** Money that has actually left, newest first. */
  async payouts(userId: string, limit = 50): Promise<PayoutRecord[]> {
    const rows = await this.db.select().from(ledgerEntries)
      .where(and(
        eq(ledgerEntries.accountKind, 'user'),
        eq(ledgerEntries.accountRef, userId),
        eq(ledgerEntries.entryKind, 'payout'),
        eq(ledgerEntries.denomination, USD_CENTS),
      ))
      .orderBy(desc(ledgerEntries.occurredAt))
      .limit(Math.min(200, Math.max(1, limit)));
    return rows.map((row) => {
      const metadata = (row.metadata ?? {}) as Record<string, unknown>;
      return {
        id: row.id,
        amountCents: Math.round(Math.abs(Number(row.amount) || 0)),
        status: typeof metadata.status === 'string' ? metadata.status : 'paid',
        provider: typeof metadata.provider === 'string' ? metadata.provider : 'unknown',
        reference: row.reference,
        memo: row.memo,
        externalRef: typeof metadata.externalRef === 'string' ? metadata.externalRef : null,
        occurredAtISO: row.occurredAt.toISOString(),
      };
    });
  }

  /** Total already paid out, in cents. One indexed SUM, never a fetch-and-add. */
  async paidCents(userId: string): Promise<number> {
    const [row] = await this.db.select({ total: sql<string>`coalesce(sum(abs(${ledgerEntries.amount})), 0)` })
      .from(ledgerEntries)
      .where(and(
        eq(ledgerEntries.accountKind, 'user'),
        eq(ledgerEntries.accountRef, userId),
        eq(ledgerEntries.entryKind, 'payout'),
        eq(ledgerEntries.denomination, USD_CENTS),
      ));
    return Math.round(Number(row?.total ?? 0));
  }

  /** Earned − paid. `earnedCents` is the caller's domain fact (commission, an
   *  invoice total); this service never guesses at it. */
  async balance(userId: string, earnedCents: number): Promise<PayoutBalance> {
    const paid = await this.paidCents(userId);
    return { earnedCents, paidCents: paid, availableCents: Math.max(0, earnedCents - paid) };
  }

  /**
   * Send money to a person's default destination and record it.
   *
   * `reference` is the idempotency key end to end: the vendor gets it (Stripe's
   * `Idempotency-Key`, PayPal's `sender_batch_id`) and the ledger's unique index
   * refuses a second row for it. A retried sweep therefore cannot pay twice at
   * either layer.
   *
   * Falls back to the deployment's `PAYOUT_WEBHOOK_URL` when the earner has
   * connected nothing — which is exactly what that seam was for before anyone
   * could connect anything, so the old behaviour is preserved rather than removed.
   */
  async pay(input: {
    userId: string;
    tenantId: number;
    amountCents: number;
    currency?: string;
    reference: string;
    memo: string;
  }): Promise<PayoutResult & { recorded: boolean }> {
    if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
      return { ok: false, error: 'A payout must be a positive amount', retryable: false, recorded: false };
    }
    const currency = (input.currency ?? 'USD').toUpperCase();

    const [row] = await this.db.select().from(payoutConnections)
      .where(and(eq(payoutConnections.userId, input.userId), eq(payoutConnections.isDefault, true))).limit(1);

    let result: PayoutResult;
    let providerName = 'webhook';

    if (row) {
      const provider = getPayoutProvider(row.provider);
      const credential = provider ? await this.openCredential(row) : null;
      if (!provider) {
        result = { ok: false, error: `Unknown payout provider "${row.provider}"`, retryable: false };
      } else if (!credential) {
        result = { ok: false, error: 'Payout credential could not be opened — reconnect the account', retryable: false };
      } else {
        providerName = provider.name;
        // Stripe transfers are authenticated by the PLATFORM's secret key, not by
        // the connected account's token, so it is injected here rather than
        // stored on every row — a rotated key must not orphan a connection.
        const enriched: PayoutCredential = provider.name === 'stripe'
          ? { ...credential, fields: { ...(credential.fields ?? {}), platformSecretKey: this.env.STRIPE_SECRET_KEY ?? '' } }
          : credential;
        result = await provider.sendPayout(enriched, {
          amountCents: input.amountCents, currency, reference: input.reference, memo: input.memo,
        });
      }
      await this.db.update(payoutConnections)
        .set(result.ok
          ? { lastPayoutAt: new Date(), lastError: null, updatedAt: new Date() }
          : { lastError: result.error.slice(0, 500), updatedAt: new Date() })
        .where(eq(payoutConnections.id, row.id));
    } else if (isPayoutsConfigured(this.env)) {
      const legacy = await createWebhookPayout(this.env, {
        invoiceId: input.reference, amountCents: input.amountCents, currency,
        freelancerUserId: input.userId, tenantId: input.tenantId,
      });
      result = legacy.ok
        ? { ok: true, externalRef: legacy.externalRef ?? null, status: 'pending' }
        : { ok: false, error: legacy.error ?? 'Payout provider refused the request', retryable: true };
    } else {
      result = { ok: false, error: 'No payout destination is connected', retryable: false };
    }

    if (!result.ok) return { ...result, recorded: false };

    // The ledger row is the receipt. `onConflictDoNothing` on the reference makes
    // the WHOLE operation idempotent, not just the vendor call.
    const inserted = await this.db.insert(ledgerEntries).values({
      tenantId: input.tenantId,
      accountKind: 'user',
      accountRef: input.userId,
      denomination: USD_CENTS,
      amount: String(input.amountCents),
      entryKind: 'payout',
      reference: input.reference,
      memo: input.memo.slice(0, 500),
      metadata: { provider: providerName, externalRef: result.externalRef, status: result.status, currency },
    }).onConflictDoNothing({ target: [ledgerEntries.tenantId, ledgerEntries.denomination, ledgerEntries.reference] })
      .returning({ id: ledgerEntries.id });

    return { ...result, recorded: inserted.length > 0 };
  }
}
