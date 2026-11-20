/**
 * The exit waterfall as an application service — the cap-table read plus the pure
 * calculator in `exitWaterfall.ts`, cached under the company's `equityVersionKey`
 * token so any ledger write retires every cached waterfall for that company at once.
 *
 * Lives here (not in the route) so the presentation layer never touches the cache or
 * the database; and not in `exitWaterfall.ts`, which stays pure and I/O-free.
 */

import type { Db } from '../../infrastructure/database/connection';
import { getCacheVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import type { Env } from '../../env';
import { capTable, companyKey, equityVersionKey } from './equity';
import {
  computeWaterfall,
  exitRange,
  goalSeekExit,
  sensitivity,
  type SensitivityPoint,
  type VestingTreatment,
  type WaterfallInput,
  type WaterfallResult,
} from './exitWaterfall';

const WATERFALL_CACHE = { kvTtlSeconds: 300, l1TtlMs: 30_000 } as const;

export interface WaterfallRequest {
  companyRef: string | null;
  exitValue: number;
  debt?: number | null;
  vesting?: VestingTreatment;
  asOf?: string | null;
  participationCaps?: Record<string, number>;
}

export interface WaterfallSensitivityRequest {
  companyRef: string | null;
  debt?: number | null;
  vesting?: VestingTreatment;
  asOf?: string | null;
  participationCaps?: Record<string, number>;
  exitValues?: number[];
  from?: number | null;
  to?: number | null;
  steps?: number | null;
  goal?: { partyRef: string; targetPayout: number };
}

export interface WaterfallSensitivityResult {
  points: SensitivityPoint[];
  goal: { partyRef: string; targetPayout: number; exitValue: number | null } | null;
}

/** The cap table folded at `asOf`, shaped as the calculator's base input. */
async function waterfallBase(
  db: Db,
  env: Env,
  tenantId: number,
  company: string,
  asOf: string,
  req: { debt?: number | null; vesting?: VestingTreatment; participationCaps?: Record<string, number> },
): Promise<Omit<WaterfallInput, 'exitValue'>> {
  const table = await capTable(db, env, tenantId, company, asOf);
  return {
    holders: table.holders,
    classes: table.classes,
    debt: req.debt ?? 0,
    vesting: req.vesting ?? 'normal',
    asOf: new Date(asOf),
    participationCaps: req.participationCaps,
  };
}

/** Who gets what at one exit. Writes nothing and stores no total. */
export async function exitWaterfall(
  db: Db,
  env: Env,
  tenantId: number,
  req: WaterfallRequest,
): Promise<WaterfallResult> {
  const company = companyKey(req.companyRef);
  const asOf = req.asOf ?? new Date().toISOString();
  const version = await getCacheVersion(env, equityVersionKey(tenantId, company));
  const key = `finance:equity:waterfall:${tenantId}:${company}:${version}:${asOf.slice(0, 10)}:`
    + `${req.exitValue}:${req.debt ?? 0}:${req.vesting ?? 'normal'}:${JSON.stringify(req.participationCaps ?? {})}`;
  return getOrSetCached(env, key, async () => {
    const base = await waterfallBase(db, env, tenantId, company, asOf, req);
    return computeWaterfall({ ...base, exitValue: req.exitValue });
  }, WATERFALL_CACHE);
}

/** The same function over a range of exits; optionally a goal-seek bisection. */
export async function exitWaterfallSensitivity(
  db: Db,
  env: Env,
  tenantId: number,
  req: WaterfallSensitivityRequest,
): Promise<WaterfallSensitivityResult> {
  const company = companyKey(req.companyRef);
  const asOf = req.asOf ?? new Date().toISOString();
  const version = await getCacheVersion(env, equityVersionKey(tenantId, company));
  const key = `finance:equity:waterfall-sens:${tenantId}:${company}:${version}:${asOf.slice(0, 10)}:`
    + `${JSON.stringify(req)}`;
  return getOrSetCached(env, key, async () => {
    const base = await waterfallBase(db, env, tenantId, company, asOf, req);
    const exits = req.exitValues?.length
      ? req.exitValues
      : exitRange(req.from ?? 0, req.to ?? 250_000_000, Math.min(60, req.steps ?? 11));
    return {
      points: sensitivity(base, exits),
      goal: req.goal
        ? {
          partyRef: req.goal.partyRef,
          targetPayout: req.goal.targetPayout,
          exitValue: goalSeekExit(base, req.goal.partyRef, req.goal.targetPayout),
        }
        : null,
    };
  }, WATERFALL_CACHE);
}
