/**
 * Web local-first policy (docs/design/vsix-offline-first-architecture-review.md).
 *
 * Classifies a capability as local, platform, or denied before any platform
 * call. A missing snapshot is denied. A capability the snapshot does not grant
 * is denied. A grant is not an allow unless it names `local` or `platform`
 * exactly — there is no default allow, and this module does not fetch.
 *
 * Library only. Callers must consult `decide` and `refusePlatform` before a
 * platform request. A `denied` decision must not reach the platform.
 */

export const PLATFORM_DENIED = 'platform_denied';

export type PolicyAction = 'local' | 'platform' | 'denied';

export interface PolicyDecision {
  readonly action: PolicyAction;
  readonly reason: string;
}

/** An explicit grant. Only `execution: 'platform'` may call the platform. */
export interface PolicyCapabilityGrant {
  readonly capability: string;
  readonly execution: 'local' | 'platform';
}

/**
 * Stored policy. `capabilities` is the closed grant list: a string names a
 * local grant, an object names local or platform. A record maps a capability
 * to `'local'` or `'platform'`. Any other shape does not grant.
 */
export interface PolicySnapshot {
  readonly capabilities:
    | readonly (string | PolicyCapabilityGrant)[]
    | Readonly<Record<string, 'local' | 'platform'>>;
}

function denied(reason: 'no_policy_snapshot' | 'capability_not_granted'): PolicyDecision {
  return Object.freeze({ action: 'denied', reason });
}

function isExecution(value: unknown): value is 'local' | 'platform' {
  return value === 'local' || value === 'platform';
}

function isGrant(value: unknown): value is PolicyCapabilityGrant {
  if (!value || typeof value !== 'object') return false;
  const grant = value as { capability?: unknown; execution?: unknown };
  return typeof grant.capability === 'string' && isExecution(grant.execution);
}

/**
 * Executions named for this capability. An empty list means the snapshot does
 * not grant it. A bare string is a local grant and never a platform allow.
 */
function executionsFor(capabilities: PolicySnapshot['capabilities'] | undefined, capability: string): Array<'local' | 'platform'> {
  if (typeof capability !== 'string' || capability.length === 0) return [];
  if (Array.isArray(capabilities)) {
    const found: Array<'local' | 'platform'> = [];
    for (const entry of capabilities) {
      if (entry === capability) {
        found.push('local');
        continue;
      }
      if (isGrant(entry) && entry.capability === capability) found.push(entry.execution);
    }
    return found;
  }
  if (!capabilities || typeof capabilities !== 'object') return [];
  if (!Object.prototype.hasOwnProperty.call(capabilities, capability)) return [];
  const value = (capabilities as Record<string, unknown>)[capability];
  return isExecution(value) ? [value] : [];
}

/**
 * Classify `capability` against the stored snapshot.
 * Null and undefined are the same denial: there is no policy to allow from.
 * A grant list that does not name the capability is denied. Mixed or malformed
 * grants are denied rather than treated as a platform allow.
 */
export function decide(capability: string, snapshot: PolicySnapshot | null | undefined): PolicyDecision {
  if (snapshot == null) return denied('no_policy_snapshot');
  const executions = executionsFor(snapshot.capabilities, capability);
  if (executions.length === 0) return denied('capability_not_granted');
  if (executions.every((execution) => execution === 'local')) {
    return Object.freeze({ action: 'local', reason: 'local_granted' });
  }
  if (executions.every((execution) => execution === 'platform')) {
    return Object.freeze({ action: 'platform', reason: 'platform_granted' });
  }
  return denied('capability_not_granted');
}

/**
 * Stop a denied decision before a platform call. Local and platform decisions
 * are explicit and do not throw; anything else, including a missing action,
 * throws `platform_denied` so a denied capability cannot reach the platform.
 */
export function refusePlatform(decision: PolicyDecision): void {
  if (decision?.action === 'local' || decision?.action === 'platform') return;
  throw Object.assign(new Error(PLATFORM_DENIED), { code: PLATFORM_DENIED });
}
