/**
 * Payout destinations, and the money that leaves through them.
 *
 * Two responsibilities that belong together because neither is meaningful alone:
 *
 *  1. **Connect / describe / disconnect** a destination — a `connections` row
 *     with `capability = 'payout'`, its credential sealed into the sibling
 *     `credentials` row by the same `credentialCrypto` every connection uses.
 *
 *     There is no `payout_connections` table. A payout destination is a
 *     connected third party with a sealed credential, a status and a reconnect
 *     story, which is the kernel `connections` primitive exactly (PRD 20 §6.2) —
 *     the same one `youtubePublishing` reads. Two things payout needs that the
 *     kernel's own indexes do not give it are held as partial unique indexes in
 *     migration 0459: uniqueness keyed by USER rather than tenant (money follows
 *     the person — an associate in two workspaces has one bank account), and a
 *     single default destination.
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
import { connections, credentials, ledgerEntries } from '../../infrastructure/database/schema';
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

/** The kernel capability that makes a `connections` row a payout destination. */
const PAYOUT = 'payout';

/**
 * The purpose of the sealed secret. A payout credential is a stored vendor
 * credential rather than an OAuth grant — typed bank fields for `bank`, an API
 * credential for the rest — so it takes the kernel's existing `api_key` purpose.
 */
const PAYOUT_SECRET = 'api_key';

type ConnectionRow = typeof connections.$inferSelect;

/**
 * The three facts a payout destination has that a mailbox does not.
 *
 * They live in the kernel's `config` rather than in three added columns, because
 * a column every other capability leaves null is how a shared table turns back
 * into six. `isDefault` is still enforced as data — migration 0459 puts a partial
 * unique index on this exact expression.
 */
interface PayoutConfig {
  currency?: string | null;
  country?: string | null;
  isDefault?: boolean;
}

const payoutConfig = (row: ConnectionRow): PayoutConfig => (row.config ?? {}) as PayoutConfig;

/** SQL for "this row is the default", shared by the ordering and the lookup so
 *  the predicate and the partial index can never drift apart. */
const IS_DEFAULT = sql`coalesce(${connections.config}->>'isDefault', 'false') = 'true'`;

function view(row: ConnectionRow): PayoutAccountView {
  const config = payoutConfig(row);
  return {
    id: row.id,
    provider: row.vendor as PayoutProviderName,
    label: row.displayName,
    currency: config.currency ?? null,
    country: config.country ?? null,
    status: row.status,
    isDefault: config.isDefault === true,
    lastError: row.lastError,
    lastPayoutAtISO: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
    connectedAtISO: row.createdAt.toISOString(),
  };
}

export class PayoutAccountService {
  constructor(private readonly db: Db, private readonly env: Env) {}

  /** Every destination this person has connected IN THIS WORKSPACE, default
   *  first. Scoped to the tenant like every other connection: the row carries a
   *  tenant-derived encryption key, so reading one from another workspace would
   *  mean decrypting that workspace's credential here. */
  async list(tenantId: number, userId: string): Promise<PayoutAccountView[]> {
    const rows = await this.db.select().from(connections)
      .where(and(
        eq(connections.tenantId, tenantId),
        eq(connections.userId, userId),
        eq(connections.capability, PAYOUT),
      ))
      .orderBy(desc(IS_DEFAULT), desc(connections.createdAt));
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

    // Reconnecting must not silently demote a destination that was already the
    // default, so the existing flag is carried forward rather than reset.
    const [current] = await this.db.select({ config: connections.config }).from(connections)
      .where(and(
        eq(connections.tenantId, input.tenantId),
        eq(connections.userId, input.userId),
        eq(connections.capability, PAYOUT),
        eq(connections.vendor, input.provider),
      )).limit(1);
    const wasDefault = ((current?.config ?? {}) as PayoutConfig).isDefault === true;

    const values = {
      tenantId: input.tenantId,
      userId: input.userId,
      vendor: input.provider,
      capability: PAYOUT,
      displayName: summary.label.slice(0, 255),
      externalAccount: (input.credential.externalAccountId ?? '').slice(0, 320),
      config: { currency: summary.currency, country: summary.country, isDefault: wasDefault } satisfies PayoutConfig,
      status: 'connected',
      lastError: null,
      updatedAt: new Date(),
    };

    const [row] = await this.db.insert(connections).values(values)
      .onConflictDoUpdate({
        target: [connections.tenantId, connections.userId, connections.vendor],
        targetWhere: eq(connections.capability, PAYOUT),
        set: values,
      })
      .returning();
    if (!row) return null;

    // The secret rides in its own row so the listing read never pulls ciphertext.
    await this.db.insert(credentials).values({
      tenantId: input.tenantId,
      connectionId: row.id,
      purpose: PAYOUT_SECRET,
      secretEnc: sealed.enc,
      secretIv: sealed.iv,
      status: 'active',
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [credentials.tenantId, credentials.connectionId, credentials.purpose],
      set: { secretEnc: sealed.enc, secretIv: sealed.iv, status: 'active', updatedAt: new Date() },
    });

    // The FIRST destination is the default whether or not anyone asked: a person
    // with exactly one connected account and no default would be told they have
    // nowhere to be paid, which is false.
    const [existing] = await this.db.select({ id: connections.id }).from(connections)
      .where(and(
        eq(connections.tenantId, input.tenantId),
        eq(connections.userId, input.userId),
        eq(connections.capability, PAYOUT),
        IS_DEFAULT,
      )).limit(1);
    if (!input.makeDefault && existing) return view(row);
    return (await this.setDefault(input.tenantId, input.userId, row.id)) ?? view(row);
  }

  /** Exactly one default, enforced by clearing the others first (the partial
   *  unique index is the backstop, not the mechanism). */
  async setDefault(tenantId: number, userId: string, id: number): Promise<PayoutAccountView | null> {
    const setFlag = (value: boolean) => ({
      config: sql`jsonb_set(coalesce(${connections.config}, '{}'::jsonb), '{isDefault}', ${value ? 'true' : 'false'}::jsonb)`,
      updatedAt: new Date(),
    });
    // Clear before setting: the partial unique index would refuse the moment two
    // rows claimed the flag, which is the point of having it.
    await this.db.update(connections).set(setFlag(false))
      .where(and(
        eq(connections.tenantId, tenantId),
        eq(connections.userId, userId),
        eq(connections.capability, PAYOUT),
        IS_DEFAULT,
      ));
    const [row] = await this.db.update(connections).set(setFlag(true))
      .where(and(
        eq(connections.tenantId, tenantId),
        eq(connections.userId, userId),
        eq(connections.capability, PAYOUT),
        eq(connections.id, id),
      ))
      .returning();
    return row ? view(row) : null;
  }

  /** Remove a destination. Any payout already sent through it stays in the
   *  ledger — deleting where money went is not a thing this offers. */
  async disconnect(tenantId: number, userId: string, id: number): Promise<boolean> {
    // The sealed credential goes with it: `credentials.connectionId` cascades.
    const rows = await this.db.delete(connections)
      .where(and(
        eq(connections.tenantId, tenantId),
        eq(connections.userId, userId),
        eq(connections.capability, PAYOUT),
        eq(connections.id, id),
      ))
      .returning({ id: connections.id });
    if (rows.length === 0) return false;
    // Promote whatever is left, so removing the default never leaves a person
    // with connected accounts and nowhere to be paid.
    const [next] = await this.db.select({ id: connections.id }).from(connections)
      .where(and(
        eq(connections.tenantId, tenantId),
        eq(connections.userId, userId),
        eq(connections.capability, PAYOUT),
      ))
      .orderBy(desc(connections.createdAt)).limit(1);
    if (next) await this.setDefault(tenantId, userId, next.id);
    return true;
  }

  private async openCredential(row: ConnectionRow): Promise<PayoutCredential | null> {
    const [secret] = await this.db.select({ enc: credentials.secretEnc, iv: credentials.secretIv })
      .from(credentials)
      .where(and(
        eq(credentials.connectionId, row.id),
        eq(credentials.tenantId, row.tenantId),
        eq(credentials.purpose, PAYOUT_SECRET),
      )).limit(1);
    if (!secret) return null;
    const blob = await decryptCredentials(secret.enc, secret.iv, credentialSecret(this.env), row.tenantId);
    if (!blob) return null;
    return blob as unknown as PayoutCredential;
  }

  /** Money that has actually left THIS workspace, newest first. */
  async payouts(tenantId: number, userId: string, limit = 50): Promise<PayoutRecord[]> {
    const rows = await this.db.select().from(ledgerEntries)
      .where(and(
        eq(ledgerEntries.tenantId, tenantId),
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

  /** Total already paid out in this workspace, in cents. One indexed SUM, never
   *  a fetch-and-add. */
  async paidCents(tenantId: number, userId: string): Promise<number> {
    const [row] = await this.db.select({ total: sql<string>`coalesce(sum(abs(${ledgerEntries.amount})), 0)` })
      .from(ledgerEntries)
      .where(and(
        eq(ledgerEntries.tenantId, tenantId),
        eq(ledgerEntries.accountKind, 'user'),
        eq(ledgerEntries.accountRef, userId),
        eq(ledgerEntries.entryKind, 'payout'),
        eq(ledgerEntries.denomination, USD_CENTS),
      ));
    return Math.round(Number(row?.total ?? 0));
  }

  /** Earned − paid. `earnedCents` is the caller's domain fact (commission, an
   *  invoice total); this service never guesses at it. */
  async balance(tenantId: number, userId: string, earnedCents: number): Promise<PayoutBalance> {
    const paid = await this.paidCents(tenantId, userId);
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

    const [row] = await this.db.select().from(connections)
      .where(and(
        eq(connections.tenantId, input.tenantId),
        eq(connections.userId, input.userId),
        eq(connections.capability, PAYOUT),
        IS_DEFAULT,
      )).limit(1);

    let result: PayoutResult;
    let providerName = 'webhook';

    if (row) {
      const provider = getPayoutProvider(row.vendor);
      const credential = provider ? await this.openCredential(row) : null;
      if (!provider) {
        result = { ok: false, error: `Unknown payout provider "${row.vendor}"`, retryable: false };
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
      // `lastSyncedAt` IS "when money last left here" for a payout connection —
      // the kernel's word for the last successful use of the connection.
      await this.db.update(connections)
        .set(result.ok
          ? { lastSyncedAt: new Date(), lastError: null, updatedAt: new Date() }
          : { lastError: result.error.slice(0, 500), updatedAt: new Date() })
        .where(and(eq(connections.tenantId, input.tenantId), eq(connections.id, row.id)));
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
