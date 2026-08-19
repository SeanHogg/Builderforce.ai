/**
 * IS THE CODING POOL ACTUALLY REACHABLE RIGHT NOW?
 *
 * ── THE FAILURE THIS CLOSES ──────────────────────────────────────────────────────
 * Measured on project 11, 2026-07-31: 150 of 164 terminal runs in one day were provider
 * 429s. The consequence downstream was not just wasted runs — it was a LOOP. Three
 * consecutive failures trip a ticket's autonomy breaker; the manager's stall triage
 * diagnoses `failure_breaker` and applies its `reset_breaker` remedy; the fresh run
 * dispatches into the same saturated pool and 429s; the breaker re-arms. That is why the
 * `failure_breaker` cohort GREW while triage was working perfectly: every remedy was
 * correct in isolation and every one of them spent a billable run to learn nothing.
 *
 * A reset is a bet that the next attempt can succeed. While the pool is throttled that
 * bet is knowably lost before it is placed, and the manager should hold rather than
 * spend. This module answers the one question that turns that judgement into a fact.
 *
 * ── WHY THE COOLDOWN STORE IS THE RIGHT SOURCE ───────────────────────────────────
 * It is already the platform's record of "this upstream just refused us", it is written
 * by the dispatcher on the real failure path (so it cannot drift from what actually
 * happened), and it is KV — so asking it costs no database round-trip on a manager pass
 * that is already budget-bound. Deriving the same verdict from `executions` would mean a
 * scan per pass to rediscover something the dispatcher already wrote down.
 *
 * Layering: application-tier, reading the infrastructure cooldown store and the static
 * pool constants. It touches no table and no request context, so the manager, the
 * dispatcher and any diagnostic surface can all consult ONE verdict rather than each
 * inventing a threshold.
 */

import { loadCooledVendors, type CooldownEnv } from '../../infrastructure/auth/cooldownStore';
import { CODING_MODEL_POOL } from './modelPool';
import { vendorForModel, type VendorId } from './vendors';

/**
 * Share of the coding pool's distinct vendors that must be on cooldown before the pool
 * counts as rate-limited.
 *
 * Not 1.0. Requiring EVERY vendor to be cooled makes the verdict unreachable in practice
 * — the pool spans a dozen upstreams and the funded last-resort floor is deliberately
 * hard to exhaust — so a threshold of "all" would report a healthy pool on the exact day
 * 91% of runs were dying. Three quarters is the point at which the cascade has no
 * meaningful headroom left: what remains is the tail it only reaches after walking (and
 * paying for) everything in front of it.
 */
export const POOL_RATE_LIMITED_RATIO = 0.75;

export interface PoolHealth {
  /** True when the coding pool has no meaningful headroom left right now. */
  rateLimited: boolean;
  /** Vendors currently benched by {@link loadCooledVendors}. */
  cooledVendors: VendorId[];
  /** Distinct vendors backing the coding pool. */
  totalVendors: number;
}

/** Distinct vendors backing the curated coding pool. Stable order (pool order), so the
 *  diagnostic string a manager writes is deterministic across passes. */
export function codingPoolVendors(): VendorId[] {
  const seen = new Set<VendorId>();
  const out: VendorId[] = [];
  for (const model of CODING_MODEL_POOL) {
    const vendor = vendorForModel(model);
    if (seen.has(vendor)) continue;
    seen.add(vendor);
    out.push(vendor);
  }
  return out;
}

/** The pure half — given which vendors are cooled, is the pool out of headroom? */
export function judgePoolHealth(vendors: readonly VendorId[], cooled: ReadonlySet<VendorId>): PoolHealth {
  const cooledVendors = vendors.filter((v) => cooled.has(v));
  const totalVendors = vendors.length;
  return {
    // An empty pool is not a rate-limited pool — it is a misconfiguration, and reporting
    // it as throttled would make the manager hold forever on a condition no capacity
    // could ever clear.
    rateLimited: totalVendors > 0 && cooledVendors.length / totalVendors >= POOL_RATE_LIMITED_RATIO,
    cooledVendors,
    totalVendors,
  };
}

/**
 * Read the live verdict. ONE KV read per distinct vendor, so it is called ONCE PER PASS
 * and the result threaded to every ticket — never per ticket. Never throws: a store that
 * cannot be read reports a healthy pool, because holding the whole manager on a KV blip
 * is a strictly worse failure than spending one run.
 */
export async function readCodingPoolHealth(env: CooldownEnv): Promise<PoolHealth> {
  const vendors = codingPoolVendors();
  try {
    const cooled = await loadCooledVendors(env, vendors);
    return judgePoolHealth(vendors, cooled);
  } catch {
    return { rateLimited: false, cooledVendors: [], totalVendors: vendors.length };
  }
}
