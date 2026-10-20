/**
 * Policy capability enforcement (G02 remainder).
 *
 * Host call sites used to decide for themselves whether a platform capability
 * was allowed. `decide` is that check: a capability proceeds only when the
 * policy value is exactly true. A missing policy, a missing capability, and
 * any value that is not the boolean true are denied.
 *
 * This module does not fetch, open a socket, or read a host setting.
 */

export type EnforceAction = 'allowed' | 'denied';

export interface EnforceAllowed {
  readonly proceed: true;
  readonly action: 'allowed';
}

export interface EnforceDenied {
  readonly proceed: false;
  readonly action: 'denied';
}

export type EnforceDecision = EnforceAllowed | EnforceDenied;

const ALLOWED: EnforceAllowed = Object.freeze({ proceed: true, action: 'allowed' });
const DENIED: EnforceDenied = Object.freeze({ proceed: false, action: 'denied' });

function capabilityValue(policy: unknown, capability: unknown): unknown {
  if (policy == null || typeof policy !== 'object') return undefined;
  if (typeof capability !== 'string' || capability.length === 0) return undefined;
  if (!Object.hasOwn(policy, capability)) return undefined;
  return (policy as Record<string, unknown>)[capability];
}

/**
 * Allow a platform capability only when its policy value is exactly true.
 * Missing policy, a missing capability, and a non-boolean value are denied.
 */
export function decide(policy: unknown, capability?: unknown): EnforceDecision {
  if (capabilityValue(policy, capability) === true) return ALLOWED;
  return DENIED;
}
