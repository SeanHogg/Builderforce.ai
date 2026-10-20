/**
 * Host capability support gate (G21).
 *
 * Classifies a requested capability against a host's declared support table
 * and refuses it when unsupported. Refusal is the only outcome for a miss:
 * this module never returns, maps, or falls through to a different capability
 * that looks similar (for example `voice_call` must not become `chat`).
 */

export const CAPABILITY_UNSUPPORTED = 'capability_unsupported';

export type CapabilitySupport = Readonly<Record<string, boolean>>;

export class CapabilityUnsupportedError extends Error {
  readonly code = CAPABILITY_UNSUPPORTED;
  readonly capability: string;

  constructor(capability: string) {
    super(`Capability '${capability}' is unsupported and must not be substituted.`);
    this.name = 'CapabilityUnsupportedError';
    this.capability = capability;
  }
}

function declared(capability: string, support: CapabilitySupport): boolean {
  return Object.prototype.hasOwnProperty.call(support, capability) && support[capability] === true;
}

function unsupported(capability: string): never {
  throw new CapabilityUnsupportedError(capability);
}

/**
 * Accepts a capability only when the host's support table explicitly lists it
 * as true. A missing key, an explicit false, an empty name, and an inherited
 * prototype key all refuse. Never substitutes.
 */
export function assertSupported(capability: string, support: CapabilitySupport): void {
  if (capability.length === 0 || !declared(capability, support)) unsupported(capability);
}

/**
 * Refuses a requested capability rather than handing back a different one.
 * There is no supported return path: the caller asked for a substitute, and
 * a substitute is exactly what this gate exists to prevent.
 */
export function substituteRefused(requested: string, support: CapabilitySupport): never {
  void support;
  unsupported(requested);
}
