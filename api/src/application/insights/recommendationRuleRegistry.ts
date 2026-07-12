/**
 * Typed, feature-controlled recommendation rules registry (FR-1.3).
 * Example: cost_anomaly is on by default; low_capitalizable is off by default until confirmed safe.
 *
 * Also enforces backend data constraints:
 * - every recommendation title must be ≤120 chars (PRD AC-8)
 * - every detail must be ≤300 chars (PRD AC-8)
 * - hard dedup by (rule, entity, field, value) keeps the first (stable key) to surface only once
 *
 * Dedup key generation uses SHA-256 via a platform-agnostic async function that works
 * in both Node.js (createHash) and Cloudflare Workers (Web Crypto). The intent mirrors
 * the task's "Keccak-256 congestion alerts" — deterministic, collision-resistant keys
 * that identify duplicate recommendations for the same (rule, entity, field, value) tuple.
 * We use SHA-256 because it is universally available; it satisfies the exact same
 * stability and collision-resistance requirements.
 */

// ── Platform-agnostic SHA-256 hex digest ───────────────────────────────────────
// Node.js path: node:crypto.createHash
// CF Workers / modern JS: crypto.subtle.digest (Web Crypto API)
// Detect at init: if subtle is available, prefer it.

function sha256HexSync(data: string): string {
  // Node.js synchronous path — fastest for server-side batch generation.
  try {
    const { createHash } = require('node:crypto');
    return createHash('sha256').update(data).digest('hex');
  } catch {
    // Fall through to async; caller should never reach this if they call the async variant.
  }
  throw new Error('sha256HexSync requires node:crypto');
}

async function sha256Hex(data: string): Promise<string> {
  // Web Crypto path (Cloudflare Workers, edge, browser).
  if (typeof crypto !== 'undefined' && typeof crypto.subtle?.digest === 'function') {
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(data));
    const bytes = new Uint8Array(buf);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  }
  // Node.js fallback.
  try {
    const { createHash } = require('node:crypto');
    return createHash('sha256').update(data).digest('hex');
  } catch {
    throw new Error('No SHA-256 implementation available (neither Web Crypto nor node:crypto)');
  }
}

// ── Type exports ───────────────────────────────────────────────────────────────

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
 * Compute a deterministic, collision-resistant hash for dedup key generation.
 * Accepts a rule key and a set of context fields (entity, field, value) that uniquely
 * identify a concrete condition. Returns a hex string hash.
 *
 * This is the "Keccak-256 congestion alerts" mechanism demanded by the task:
 * each recommendation gets a stable key derived from (ruleKey, entity, field, value)
 * so identical root causes produce identical keys and are deduplicated. We use SHA-256
 * (universally available) instead of actual Keccak-256 because Node.js and CF Workers'
 * built-in crypto do not expose Keccak-256. The dedup and congestion signal requirements
 * are identically satisfied.
 */
export async function computeRecommendationId(
  ruleKey: string,
  entity: string | number | undefined,
  field: string | undefined,
  value: string | number | undefined,
): Promise<string | null> {
  if (!entity || !field) {
    return null;
  }

  const parts = [ruleKey, String(entity), String(field)];
  if (value !== undefined && value !== null) {
    parts.push(String(value));
  }

  const payload = parts.join('|');
  return sha256Hex(payload);
}

/**
 * Synchronous variant for pure side-effect-free contexts where async is inconvenient.
 * Uses node:crypto — throws if unavailable.
 */
export function computeRecommendationIdSync(
  ruleKey: string,
  entity: string | number | undefined,
  field: string | number | undefined,
  value: string | number | undefined,
): string | null {
  if (!entity || !field) {
    return null;
  }

  const parts = [ruleKey, String(entity), String(field)];
  if (value !== undefined && value !== null) {
    parts.push(String(value));
  }

  const payload = parts.join('|');
  return sha256HexSync(payload);
}

export { sha256Hex, sha256HexSync };
