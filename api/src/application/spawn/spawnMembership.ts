/**
 * THE SPAWN MEMBERSHIP — $1.99 a month, and the key to the builder.
 *
 * An ADD-ON subscription, not a workspace plan: a Spawn member's workspace keeps
 * whatever Builderforce plan it has (usually Free), and a lapsed Spawn card never
 * touches that plan. It reaches us as `addon.*` events carrying
 * `purchaseKind: 'spawn_plan'`, which `TenantService.handleWebhookEvent` ignores by
 * construction.
 *
 * The state is one `settings` singleton per workspace (`feature = 'spawn_membership'`)
 * — the same home the business-phone entitlement uses — written by exactly two
 * doors: the checkout return (verified against the processor) and the webhook.
 * There is no third, so there is no way to become a member without a paid session.
 * (The free trial is not membership: it is its own `trial` status, written once by
 * `spawnTrial.ts`, and it closes by the clock.)
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { settings } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { buildPaymentProvider } from '../../infrastructure/payment';
import type { WebhookEvent } from '../../infrastructure/payment/PaymentProvider';
import { assertCovers } from '../finance/verifiedCheckout';
import { SPAWN_PLAN } from './spawnCatalog';
import { verifySpawnCheckout } from './spawnCheckout';
import { SpawnError } from './spawnErrors';
import { assertSpawnAge } from './spawnAge';
import { spawnReturnUrl, type SpawnReturn } from './spawnReturn';

/** The `purchaseKind` stamped on a membership session and carried onto its subscription. */
export const SPAWN_PLAN_KIND = 'spawn_plan';
const FEATURE = 'spawn_membership';

/** `trial` is the free week (`spawnTrial.ts`); `trial_ended` is a trial whose week is
 *  over — derived on read from `trial.endsAt`, and persisted by the reminder sweep. */
export type SpawnMembershipStatus = 'none' | 'trial' | 'trial_ended' | 'active' | 'past_due' | 'cancelled';

/** The parent emails a trial sends, each at most once (`spawnTrial.ts`). */
export type SpawnTrialNotice = 'start' | 'midway' | 'lastDay' | 'ended';

/** The workspace's one free trial. Kept after the trial (and after joining) as its record. */
export interface SpawnTrial {
  startedAt: string;
  endsAt: string;
  /** Who started it — the person whose `users.spawn_trial_at` it claimed. */
  userId: string;
  /** The grown-up the reminders go to. */
  parentEmail: string;
  sent: SpawnTrialNotice[];
}

export interface SpawnMembership {
  status: SpawnMembershipStatus;
  externalSubscriptionId: string | null;
  trial: SpawnTrial | null;
  updatedAt: string | null;
}

type StoredMembership = Omit<SpawnMembership, 'updatedAt'>;

const membershipKey = (tenantId: number) => `spawn:membership:t:${tenantId}`;

const membershipRow = (tenantId: number) => and(
  eq(settings.tenantId, tenantId),
  eq(settings.scope, 'tenant'),
  eq(settings.scopeRef, ''),
  eq(settings.feature, FEATURE),
);

export async function getSpawnMembership(
  db: Db, env: Env | undefined, tenantId: number, now: Date = new Date(),
): Promise<SpawnMembership> {
  const stored = await getOrSetCached(env, membershipKey(tenantId), async (): Promise<SpawnMembership> => {
    const [row] = await db.select({ value: settings.value, updatedAt: settings.updatedAt })
      .from(settings).where(membershipRow(tenantId)).limit(1);
    if (!row) return { status: 'none', externalSubscriptionId: null, trial: null, updatedAt: null };
    const value = row.value as Partial<StoredMembership>;
    return {
      status: value.status ?? 'none',
      externalSubscriptionId: value.externalSubscriptionId ?? null,
      trial: value.trial ?? null,
      updatedAt: (row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt)).toISOString(),
    };
  }, { kvTtlSeconds: 300 });
  // A trial ends by the clock, not by a write: the sweep persists `trial_ended`
  // later, but the builder closes the moment the week is over.
  if (stored.status === 'trial' && stored.trial && now.getTime() >= Date.parse(stored.trial.endsAt)) {
    return { ...stored, status: 'trial_ended' };
  }
  return stored;
}

/**
 * Write the membership, keeping whatever the patch does not name — a payment
 * landing on a trial workspace must not erase the trial's record (it is what
 * stops a second trial), and a trial write must not drop a subscription id.
 */
export async function writeMembership(
  db: Db, env: Env | undefined, tenantId: number, patch: Partial<StoredMembership>,
): Promise<void> {
  const current = await getSpawnMembership(db, undefined, tenantId);
  const value: StoredMembership = {
    status: patch.status ?? current.status,
    externalSubscriptionId: patch.externalSubscriptionId !== undefined ? patch.externalSubscriptionId : current.externalSubscriptionId,
    trial: patch.trial !== undefined ? patch.trial : current.trial,
  };
  await db.insert(settings)
    .values({ tenantId, scope: 'tenant', scopeRef: '', feature: FEATURE, value })
    .onConflictDoUpdate({
      target: [settings.tenantId, settings.scope, settings.scopeRef, settings.feature],
      set: { value, updatedAt: sql`now()` },
    });
  await invalidateCached(env, membershipKey(tenantId));
}

/** May this membership build? A paid one, or a trial still inside its week. */
export function membershipCanBuild(status: SpawnMembershipStatus): boolean {
  return status === 'active' || status === 'trial';
}

/** Refuse unless the person may build: old enough, and their workspace is a member. */
export async function assertSpawnMember(db: Db, env: Env | undefined, input: { tenantId: number; userId: string }): Promise<void> {
  await assertSpawnAge(db, env, input.userId);
  const membership = await getSpawnMembership(db, env, input.tenantId);
  if (!membershipCanBuild(membership.status)) {
    throw new SpawnError('Join Spawn to start building', 402, 'membership_required');
  }
}

/** Refuse unless the workspace has PAID — token packs are sold only inside a paid
 *  membership, so a trial that runs out cannot strand tokens someone bought. */
export async function assertSpawnPaidMember(db: Db, env: Env | undefined, input: { tenantId: number; userId: string }): Promise<void> {
  await assertSpawnAge(db, env, input.userId);
  const membership = await getSpawnMembership(db, env, input.tenantId);
  if (membership.status !== 'active') {
    throw new SpawnError('Join Spawn to buy tokens', 402, 'membership_required');
  }
}

export async function startSpawnMembership(
  db: Db,
  env: Env,
  input: { tenantId: number; userId: string; billingEmail?: string | null; appUrl: string; returnTo?: SpawnReturn },
): Promise<{ checkoutUrl: string; sessionId: string }> {
  if (!env.STRIPE_SECRET_KEY) throw new SpawnError('Payments are not configured', 400, 'payments_unavailable');
  await assertSpawnAge(db, env, input.userId);
  const back = spawnReturnUrl(input.appUrl, input.returnTo);

  return buildPaymentProvider(env).createSubscriptionCheckoutSession({
    amountCents: SPAWN_PLAN.monthlyCents,
    currency: SPAWN_PLAN.currency,
    productName: 'Spawn membership',
    billingEmail: input.billingEmail ?? null,
    interval: 'month',
    successUrl: `${back}joined={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${back}joined=cancelled`,
    metadata: { purchaseKind: SPAWN_PLAN_KIND, tenantId: String(input.tenantId) },
    idempotencyKey: `spawn-plan:${input.tenantId}:${new Date().toISOString().slice(0, 10)}`,
  });
}

/** The checkout return: verified against the processor, then the membership is live. */
export async function completeSpawnMembership(
  db: Db,
  env: Env,
  input: { tenantId: number; checkoutSessionId: string },
): Promise<SpawnMembership> {
  const verified = await verifySpawnCheckout(env, {
    checkoutSessionId: input.checkoutSessionId,
    purchaseKind: SPAWN_PLAN_KIND,
    tenantId: input.tenantId,
  });
  assertCovers(verified, SPAWN_PLAN.monthlyCents, 'That payment did not cover the membership', (message, status) =>
    new SpawnError(message, status, 'payment_short'));
  await writeMembership(db, env, input.tenantId, {
    status: 'active',
    externalSubscriptionId: verified.session.subscriptionId,
  });
  return getSpawnMembership(db, env, input.tenantId);
}

/** The webhook door: the subscription's lifecycle, as the processor reports it. */
export async function recordSpawnPlanEvent(db: Db, env: Env, event: WebhookEvent): Promise<boolean> {
  if (event.purchaseKind !== SPAWN_PLAN_KIND || !event.tenantId) return false;
  const status: SpawnMembershipStatus = event.type === 'addon.activated' ? 'active'
    : event.type === 'addon.past_due' ? 'past_due'
      : event.type === 'addon.cancelled' ? 'cancelled'
        : 'none';
  if (status === 'none') return false;
  await writeMembership(db, env, event.tenantId, {
    status,
    externalSubscriptionId: event.externalSubscriptionId || null,
  });
  return true;
}
