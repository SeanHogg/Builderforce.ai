/**
 * The Spawn account at a glance — what the website's account page and the desktop
 * app's header both show: may this person build, and with how many tokens.
 *
 * Age, membership and balance are each read through their own cached reader. The
 * recent-activity list is a bounded (20-row), indexed read of one ledger account,
 * served fresh on purpose: it is the receipt a player checks right after a build or
 * a purchase, and a cached receipt that lags the balance above it reads as an error.
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  MIN_BUILD_TOKENS, SPAWN_MIN_AGE, SPAWN_PLAN, SPAWN_TOKEN_PACKS, SPAWN_TRIAL_DAYS, SPAWN_TRIAL_TOKENS, TYPICAL_BUILD_TOKENS,
} from './spawnCatalog';
import { spawnAgeStatus, type SpawnAgeStatus } from './spawnAge';
import { getSpawnMembership, membershipCanBuild, type SpawnMembershipStatus } from './spawnMembership';
import { personHadTrial, spawnTrialView, type SpawnTrialView } from './spawnTrial';
import { spawnWallet } from './spawnWallet';
import type { PrepaidStatementRow } from '../kernel/prepaidBalance';

export interface SpawnAccountView {
  age: SpawnAgeStatus;
  minAge: number;
  membership: SpawnMembershipStatus;
  monthlyCents: number;
  balance: number;
  /** True when every gate is open: the builder will accept a request. */
  canBuild: boolean;
  /** Does the membership open the builder — paid, or a trial inside its week? The one
   *  answer both clients read, so neither re-derives which statuses count. */
  membershipOpen: boolean;
  trial: SpawnTrialView;
  /** The free trial's length and tokens — public, so the landing page can say them. */
  trialDays: number;
  trialTokens: number;
  packs: Array<{ id: string; cents: number; tokens: number; estimatedBuilds: number }>;
  activity: PrepaidStatementRow[];
}

/** The price list alone — public, for the landing page. */
export function spawnPriceList(): Pick<SpawnAccountView, 'minAge' | 'monthlyCents' | 'packs' | 'trialDays' | 'trialTokens'> {
  return {
    minAge: SPAWN_MIN_AGE,
    monthlyCents: SPAWN_PLAN.monthlyCents,
    trialDays: SPAWN_TRIAL_DAYS,
    trialTokens: SPAWN_TRIAL_TOKENS,
    packs: SPAWN_TOKEN_PACKS.map((pack) => ({ ...pack, estimatedBuilds: Math.floor(pack.tokens / TYPICAL_BUILD_TOKENS) })),
  };
}

export async function spawnAccount(
  db: Db,
  env: Env,
  input: { tenantId: number; userId: string },
): Promise<SpawnAccountView> {
  const [age, membership, balance, activity, personUsed] = await Promise.all([
    spawnAgeStatus(db, env, input.userId),
    getSpawnMembership(db, env, input.tenantId),
    spawnWallet.balance(db, env, input.tenantId),
    spawnWallet.statement(db, input.tenantId, 20),
    personHadTrial(db, env, input.userId),
  ]);
  return {
    ...spawnPriceList(),
    age,
    membership: membership.status,
    balance,
    canBuild: age === 'ok' && membershipCanBuild(membership.status) && balance >= MIN_BUILD_TOKENS,
    membershipOpen: membershipCanBuild(membership.status),
    trial: spawnTrialView(membership, personUsed),
    activity,
  };
}
