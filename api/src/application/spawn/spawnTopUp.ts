/**
 * BUYING SPAWN TOKENS — the only door that puts tokens in a Spawn wallet.
 *
 * The platform's standard one-off purchase, the same three moves as
 * `commsTopUp.ts`: open a hosted checkout for a published pack with the account
 * and the pack stamped in its metadata; let the processor take the money; read
 * the session BACK from the processor and only then credit the wallet. The
 * credit is keyed on the payment intent, so the redirect and the webhook (a
 * player who pays and closes the tab) land on one ledger row.
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { buildPaymentProvider } from '../../infrastructure/payment';
import { assertCovers } from '../finance/verifiedCheckout';
import { spawnTokenPack } from './spawnCatalog';
import { verifySpawnCheckout } from './spawnCheckout';
import { SpawnError } from './spawnErrors';
import { spawnWallet } from './spawnWallet';
import { assertSpawnMember } from './spawnMembership';

/** The `purchaseKind` stamped on a token-pack session. */
export const SPAWN_TOKENS_KIND = 'spawn_tokens';

export async function startSpawnTopUp(
  db: Db,
  env: Env,
  input: { tenantId: number; userId: string; packId: string; billingEmail?: string | null; appUrl: string },
): Promise<{ checkoutUrl: string; sessionId: string }> {
  const pack = spawnTokenPack(input.packId);
  if (!pack) throw new SpawnError('That token pack does not exist', 404, 'pack_not_found');
  if (!env.STRIPE_SECRET_KEY) throw new SpawnError('Payments are not configured', 400, 'payments_unavailable');
  // Tokens only spend inside a membership, so selling them outside one would take
  // money for something the buyer cannot use yet.
  await assertSpawnMember(db, env, { tenantId: input.tenantId, userId: input.userId });

  return buildPaymentProvider(env).createOneTimeCheckoutSession({
    amountCents: pack.cents,
    currency: 'USD',
    productName: `Spawn tokens — ${pack.tokens.toLocaleString('en-US')}`,
    billingEmail: input.billingEmail ?? null,
    successUrl: `${input.appUrl}/spawn/account?tokens={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${input.appUrl}/spawn/account?tokens=cancelled`,
    metadata: {
      purchaseKind: SPAWN_TOKENS_KIND,
      tenantId: String(input.tenantId),
      packId: pack.id,
      cents: String(pack.cents),
    },
    // Same account + same pack + same day = one session, so a double-click does not
    // open two checkouts the buyer could pay twice.
    idempotencyKey: `spawn-tokens:${input.tenantId}:${pack.id}:${new Date().toISOString().slice(0, 10)}`,
  });
}

export async function completeSpawnTopUp(
  db: Db,
  env: Env,
  input: { tenantId: number; checkoutSessionId: string },
): Promise<{ applied: boolean; creditedTokens: number; balance: number }> {
  const verified = await verifySpawnCheckout(env, {
    checkoutSessionId: input.checkoutSessionId,
    purchaseKind: SPAWN_TOKENS_KIND,
    tenantId: input.tenantId,
  });
  const pack = spawnTokenPack(verified.metadata.packId ?? '');
  if (!pack) throw new SpawnError('That token pack no longer exists', 404, 'pack_not_found');
  // What the processor captured has to cover the pack — otherwise a buyer can open
  // checkout at one price and complete it after the price changed.
  assertCovers(verified, pack.cents, 'That payment did not cover the token pack', (message, status) =>
    new SpawnError(message, status, 'payment_short'));

  const applied = await spawnWallet.credit(db, env, {
    tenantId: input.tenantId,
    amount: pack.tokens,
    reference: `spawn:tokens:${verified.paymentRef}`,
    memo: `Spawn tokens — $${(pack.cents / 100).toFixed(2)} pack`,
    metadata: { packId: pack.id, paymentRef: verified.paymentRef, kind: 'topup' },
  });

  return { applied, creditedTokens: pack.tokens, balance: await spawnWallet.balance(db, env, input.tenantId) };
}
