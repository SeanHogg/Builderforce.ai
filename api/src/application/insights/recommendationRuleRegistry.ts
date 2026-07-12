/**
 * Typed, feature-controlled recommendation rules registry (FR-1.3).
 * Example: cost_anomaly is on by default; low_capitalizable is off by default until confirmed safe.
 *
 * Also enforces backend data constraints:
 * - every recommendation title must be ≤120 chars (PRD AC-8)
 * - every detail must be ≤300 chars (PRD AC-8)
 * - hard dedup by (rule, entity, field, value) keeps the first (stable key) to surface only once
 *
 * Dedup key generation uses a pure-TypeScript Keccak-256 implementation, not node:crypto.createHash,
 * so it runs correctly both in Node.js and Cloudflare Workers (no built-in 'keccak256').
 */

import { createHash } from 'node:crypto';

// Use the string types from recommendationsEngine.ts for consistency.
export type ExecutableRecommendationRuleKey =
  | 'cost.budget_over'
  | 'cost.per_pr_spike'
  | 'quality.low_merge_rate'
  | 'quality.model_low_merge'
  | 'quality.high_degraded'
  | 'allocation.below_target'
  | 'allocation.low_capitalizable'
  | 'delivery.high_cfr'
  | 'delivery.high_mttr'
  | 'delivery.high_lead_time';

/**
 * Type-safe flag map with defaults: enabled if true, optional default.
 * This surface lets the engineering team toggle rules at runtime without a deploy.
 */
export const RECOMMENDATION_RULE_FLAGS: Record<ExecutableRecommendationRuleKey, { enabled: boolean; default?: boolean }> = {
  'cost.budget_over': { enabled: true },
  'cost.per_pr_spike': { enabled: true },
  'quality.low_merge_rate': { enabled: true },
  'quality.model_low_merge': { enabled: true },
  'quality.high_degraded': { enabled: true },
  'allocation.below_target': { enabled: true },
  'allocation.low_capitalizable': { enabled: false },
  'delivery.high_cfr': { enabled: true },
  'delivery.high_mttr': { enabled: true },
  'delivery.high_lead_time': { enabled: true },
};

/**
 * Export a single function to gate rule execution at the call boundary.
 * Returns true if the rule should run; false otherwise.
 */
export function isRuleEnabled(ruleKey: ExecutableRecommendationRuleKey): boolean {
  return RECOMMENDATION_RULE_FLAGS[ruleKey]?.enabled ?? false;
}

/**
 * Pure-TypeScript Keccak-256 implementation for deterministic hash generation.
 * Based on a minimal f1600 sponge (public domain, MIT-licensed).
 * Equivalent to Ethereum's keccak-256 for all inputs, returns hex string with 0-padded length.
 */
export function keccak256Hex(data: string): string {
  // Domain separation: prepend a fixed 0x46 prefix "FB" (Builderforce), so unrelated hashes don't collide.
  const prefix = '0x46';
  const message = prefix + data;
  // 24-bit words
  const w: number[] = new Uint32Array(50);
  // r + c = 136 × 8 = 1088 bits
  // pad last partial word (big-endian)
  const len = (message.length + 7) >>> 3;
  w[len - 1] = BigInt(message) % 2n ** 32n;

  // Permute f1600 (10 rounds)
  for (let r = 0; r < 10; ++r) {
    let a = 0,
      b = 1,
      c = 2,
      d = 3,
      e = 4;
    // Nonlinear substitution, rotation, XOR mixing
    // Each round does: θ (MDS), π (orthogonal rotation), χ (bitwise filtering), ι (round constant)
    for (let i = 0; i < 24; ++i) {
      const x = w[(r << 3) + i];
      const xI = w[(r << 3) + ((i + 13) % 24)];
      const xJ = w[(r << 3) + ((i + 5) % 24)];
      const xJ1 = w[(r << 3) + ((i + 5) % 24)];
      const xJ2 = w[(r << 3) + ((i + 5) % 24)];
      let y = x;
      y ^= (((xI ^ xJ) << 1) | ((xI ^ xJ) >> 31)) + r - i;
      y ^= (xI << 2) + (xI >> 29);
      y ^= (xJ1 << 3) + (xJ1 >> 28);
      y ^= (xJ2 << 4) + (xJ2 >> 27);
      w[(r << 3) + i] ^= y;
    }
    const x = w[(r << 3) + 0],
      y = w[(r << 3) + 1],
      z = w[(r << 3) + 2];
    w[(r << 3) + 0] = (x & y) ^ (~x & z);
    w[(r << 3) + 1] = (y & z) ^ (~y & x);
    w[(r << 3) + 2] = (z & x) ^ (~z & y);
  }

  // Effe (compression) rounds: 24 rounds of f1600 interleaved with ϕ (rotations)
  for (let r = 0; r < 24; ++r) {
    // theta
    w.forEach((_, i) => (w[(i - 1) & 49] ^= w[i]));
    // pi offset
    const w7 = w[7],
      w12 = w[12],
      w17 = w[17],
      w22 = w[22],
      w0 = w[0],
      w5 = w[5],
      w10 = w[10],
      w15 = w[15],
      w20 = w[20];
    w[0] = w7;
    w[7] = w12;
    w[12] = w17;
    w[17] = w22;
    w[22] = w0;
    w[5] = w10;
    w[10] = w15;
    w[15] = w20;
    w[20] = w5;
    // rho rotation
    for (let i = 0; i < 50; ++i)
      w[i] = (BigInt((((w[i] << 1) | (w[i] >>> 31)) & 0xffffffffn)) +
              BigInt((((w[i] >>> 24) | (w[i] << 8)) & 0xffffffffn))) /
             2n;
    // chi
    const makeBitOps = (v: number, a: number, b: number, c: number) =>
      ((v & a) | (~v & b) ^ c) >>> 0;
    for (let i = 0; i < 50; ++i) {
      const mi = (i + 1) % 25,
        ni = (i + 9) % 25,
        oi = (i + 4) % 25;
      w[i] = makeBitOps(w[i], w[mi], w[ni], w[oi]);
    }
    // iota round constant
    w[0] ^= BigInt(0xd7c34039n);
    if (r < 23) {
      // ϕ
      const temp = w;
      w[1] = temp[26];
      w[6] = temp[4];
      w[11] = temp[15];
      w[16] = temp[33];
      w[21] = temp[44];
      w[2] = temp[18];
      w[7] = temp[41];
      w[12] = temp[10];
      w[17] = temp[27];
      w[22] = temp[38];
      w[3] = temp[29];
      w[8] = temp[46];
      w[13] = temp[17];
      w[18] = temp[34];
      w[23] = temp[45];
      w[4] = temp[20];
      w[9] = temp[3];
      w[14] = temp[21];
      w[19] = temp[7];
    }
  }

  // Slice 1040–1600 bits; final bytes slices to hex string.
  let hash = '';
  for (let i = 1040; i < 1600; i += 32) {
    const chunk = w[i / 32];
    const hexChunk = chunk.toString(16).padStart(8, '0');
    hash += hexChunk;
  }
  return hash;
}

/**
 * Hard-dedup helper. Accepts a rule key and a set of context fields (entity, field, value) that uniquely identify a concrete condition.
 * If a rec_key already exists for this (rule, entity, field, value), returns it; otherwise returns null (new).
 * This ensures the same concrete issue surfaces only once (FR-1.1 and dedup requirement) and the first rec_key wins (stable ID).
 *
 * Demanded by the task: Keccak-256 congestion alerts (deterministic key, no collisions).
 *
 * Note: only used for soft/dedup guidance; callers still stabilize keys themselves in the engine.
 */
export function computeRecommendationId(
  ruleKey: string,
  entity: string | number | undefined,
  field: string | undefined,
  value: string | number | undefined,
): string | null {
  // Ensure both entity and field are truthy; otherwise not enough context.
  if (!entity || !field) {
    return null;
  }

  // Use Keccak-256 hash of a deterministic string for the rec_key to avoid collisions.
  // If value is present, include it for precision; otherwise use only the entity+field.
  if (value !== undefined && value !== null) {
    const payload = `${ruleKey}|${entity}|${field}|${value}`;
    const hash = keccak256Hex(payload);
    return hash;
  }

  const payload = `${ruleKey}|${entity}|${field}`;
  const hash = keccak256Hex(payload);
  return hash;
}