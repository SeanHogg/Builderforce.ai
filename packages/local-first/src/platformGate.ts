/**
 * Single enforcement point for a platform call (G02).
 *
 * Host API clients, platform tools, webview fetch adapters, embedded
 * frontend clients, streams, and sockets each used to decide for themselves.
 * Gating one of those paths leaves the others open. `gate` is the only
 * function that decides whether a platform call proceeds. Every other site
 * must call it and register that call here. A second decision function is a
 * bypass.
 *
 * This module does not fetch, open a socket, or import a network client.
 */

export const PLATFORM_GATE_FUNCTION = 'gate';

export const GATE_BYPASSED = 'gate_bypassed';

/** The only action that may reach the platform. */
export type GateAction = 'platform' | 'local' | 'denied';

export interface GateDecision {
  readonly action?: string | null;
}

export interface GateProceed {
  readonly proceed: true;
}

export interface GateRefuse {
  readonly proceed: false;
  readonly reason: 'local_only' | 'denied';
}

export type GateResult = GateProceed | GateRefuse;

/**
 * A registered platform call site. `functionName` must be `gate`.
 * A function value is read through its `.name`. A string is the name itself.
 */
export type GateCallSite =
  | {
      readonly functionName?: string | null;
      readonly name?: string | null;
    }
  | ((...args: never[]) => unknown)
  | string;

const PROCEED: GateProceed = Object.freeze({ proceed: true });
const LOCAL_ONLY: GateRefuse = Object.freeze({ proceed: false, reason: 'local_only' });
const DENIED: GateRefuse = Object.freeze({ proceed: false, reason: 'denied' });

/**
 * Decide whether a platform call proceeds.
 * Only `action === 'platform'` proceeds. `local` stays on the device.
 * `denied`, a missing decision, and any other action are denied.
 */
export function gate(decision: GateDecision | null | undefined): GateResult {
  if (decision != null && decision.action === 'platform') return PROCEED;
  if (decision != null && decision.action === 'local') return LOCAL_ONLY;
  return DENIED;
}

function bypassed(): never {
  throw Object.assign(new Error(GATE_BYPASSED), { code: GATE_BYPASSED });
}

function functionNameOf(site: unknown): string | undefined {
  if (typeof site === 'string') return site.length > 0 ? site : undefined;
  if (typeof site === 'function') return site.name.length > 0 ? site.name : undefined;
  if (site == null || typeof site !== 'object') return undefined;
  const record = site as { functionName?: unknown; name?: unknown };
  const named = 'functionName' in record ? record.functionName : record.name;
  return typeof named === 'string' && named.length > 0 ? named : undefined;
}

/**
 * Every registered call site must invoke `gate`.
 * A different function name, or a site with no function name, throws
 * `gate_bypassed` so a second gate function cannot be registered.
 */
export function assertSingleGate(callSites: readonly GateCallSite[]): void {
  if (!Array.isArray(callSites)) bypassed();
  for (const site of callSites) {
    if (functionNameOf(site) !== PLATFORM_GATE_FUNCTION) bypassed();
  }
}
