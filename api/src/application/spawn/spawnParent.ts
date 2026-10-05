/**
 * The grown-up's side of Spawn — what `/spawn/parent?t=…` shows and does.
 *
 * Every call starts by reading the signed parent link (`spawnParentLink.ts`), which
 * names ONE workspace and ONE player. From there it is the player's own purchase
 * flow with two differences: the checkout returns to the parent page (`spawnReturn`),
 * and it is pre-filled with the grown-up's email from the trial. Nothing here
 * grants anything by itself — memberships and tokens still arrive only through
 * `completeSpawnMembership` / `completeSpawnTopUp`, verified against the processor.
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { users } from '../../infrastructure/database/schema';
import { spawnPriceList } from './spawnAccount';
import { completeSpawnMembership, getSpawnMembership, startSpawnMembership, type SpawnMembershipStatus } from './spawnMembership';
import { readSpawnParentToken, type SpawnParentGrant } from './spawnParentLink';
import { completeSpawnTopUp, startSpawnTopUp } from './spawnTopUp';
import { spawnTrialView } from './spawnTrial';
import { spawnWallet } from './spawnWallet';

export interface SpawnParentView extends ReturnType<typeof spawnPriceList> {
  player: string;
  membership: SpawnMembershipStatus;
  trialDaysLeft: number | null;
  balance: number;
}

async function playerName(db: Db, userId: string): Promise<string> {
  const [row] = await db.select({ displayName: users.displayName, username: users.username, email: users.email })
    .from(users).where(eq(users.id, userId)).limit(1);
  return row?.displayName?.trim() || row?.username?.trim() || row?.email.split('@')[0] || '';
}

const grantOf = (env: Env, token: string): Promise<SpawnParentGrant> => readSpawnParentToken(env.JWT_SECRET, token);

export async function spawnParentView(db: Db, env: Env, token: string): Promise<SpawnParentView> {
  const grant = await grantOf(env, token);
  const [player, membership, balance] = await Promise.all([
    playerName(db, grant.userId),
    getSpawnMembership(db, env, grant.tenantId),
    spawnWallet.balance(db, env, grant.tenantId),
  ]);
  return {
    ...spawnPriceList(),
    player,
    membership: membership.status,
    trialDaysLeft: spawnTrialView(membership, true).daysLeft,
    balance,
  };
}

async function billingEmail(db: Db, env: Env, tenantId: number): Promise<string | null> {
  return (await getSpawnMembership(db, env, tenantId)).trial?.parentEmail ?? null;
}

export async function startParentMembership(db: Db, env: Env, input: { token: string; appUrl: string }) {
  const grant = await grantOf(env, input.token);
  return startSpawnMembership(db, env, {
    ...grant,
    appUrl: input.appUrl,
    billingEmail: await billingEmail(db, env, grant.tenantId),
    returnTo: { kind: 'parent', token: input.token },
  });
}

export async function completeParentMembership(db: Db, env: Env, input: { token: string; sessionId: string }) {
  const grant = await grantOf(env, input.token);
  return completeSpawnMembership(db, env, { tenantId: grant.tenantId, checkoutSessionId: input.sessionId });
}

export async function startParentTopUp(db: Db, env: Env, input: { token: string; packId: string; appUrl: string }) {
  const grant = await grantOf(env, input.token);
  return startSpawnTopUp(db, env, {
    ...grant,
    packId: input.packId,
    appUrl: input.appUrl,
    billingEmail: await billingEmail(db, env, grant.tenantId),
    returnTo: { kind: 'parent', token: input.token },
  });
}

export async function completeParentTopUp(db: Db, env: Env, input: { token: string; sessionId: string }) {
  const grant = await grantOf(env, input.token);
  return completeSpawnTopUp(db, env, { tenantId: grant.tenantId, checkoutSessionId: input.sessionId });
}
