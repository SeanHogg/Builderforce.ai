export type PlatformCapability =
  | 'synchronize'
  | 'gateway-inference'
  | 'connected-feature'
  | 'authenticate'
  | 'model-download'
  | 'direct-provider'
  | 'external-mcp'
  | 'git-remote';

export interface PlatformPolicySnapshot {
  synchronize: boolean;
  gatewayInference: boolean;
  connectedFeatures: boolean;
  authenticate: boolean;
  modelDownloads: boolean;
  directProviders: boolean;
  externalMcp: boolean;
  gitRemotes: boolean;
}

export const LOCAL_FIRST_POLICY: Readonly<PlatformPolicySnapshot> = Object.freeze({
  synchronize: false,
  gatewayInference: false,
  connectedFeatures: false,
  authenticate: false,
  modelDownloads: false,
  directProviders: false,
  externalMcp: false,
  gitRemotes: false,
});

const PROPERTY: Readonly<Record<PlatformCapability, keyof PlatformPolicySnapshot>> = {
  synchronize: 'synchronize',
  'gateway-inference': 'gatewayInference',
  'connected-feature': 'connectedFeatures',
  authenticate: 'authenticate',
  'model-download': 'modelDownloads',
  'direct-provider': 'directProviders',
  'external-mcp': 'externalMcp',
  'git-remote': 'gitRemotes',
};

export class PlatformAccessDenied extends Error {
  readonly code = 'PLATFORM_ACCESS_DENIED';
  constructor(readonly capability: PlatformCapability) {
    super(`platform_${capability.replaceAll('-', '_')}_disabled`);
    this.name = 'PlatformAccessDenied';
  }
}

export interface PlatformPolicy {
  snapshot(): Readonly<PlatformPolicySnapshot>;
  allows(capability: PlatformCapability): boolean;
  assert(capability: PlatformCapability): void;
  subscribe(listener: (snapshot: Readonly<PlatformPolicySnapshot>) => void): () => void;
}

export interface MutablePlatformPolicy extends PlatformPolicy {
  set(patch: Partial<PlatformPolicySnapshot>): void;
}

export function createPlatformPolicy(initial: Partial<PlatformPolicySnapshot> = {}): MutablePlatformPolicy {
  let current: Readonly<PlatformPolicySnapshot> = Object.freeze({ ...LOCAL_FIRST_POLICY, ...initial });
  const listeners = new Set<(snapshot: Readonly<PlatformPolicySnapshot>) => void>();
  return {
    snapshot: () => current,
    allows: (capability) => capability === 'authenticate'
      ? current.authenticate || current.synchronize || current.connectedFeatures || current.gatewayInference
      : current[PROPERTY[capability]],
    assert(capability) {
      if (!this.allows(capability)) throw new PlatformAccessDenied(capability);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(patch) {
      const next = { ...current, ...patch };
      if (Object.entries(next).every(([key, value]) => current[key as keyof PlatformPolicySnapshot] === value)) return;
      current = Object.freeze(next);
      for (const listener of [...listeners]) listener(current);
    },
  };
}

/** Whether the person's mode reaches the platform at all (not Local only): gateway,
 *  connected features or sync is on. */
export function platformReachable(snapshot: Readonly<PlatformPolicySnapshot>): boolean {
  return snapshot.gatewayInference || snapshot.connectedFeatures || snapshot.synchronize;
}

/**
 * The administrative gate a host's durable platform outboxes wait on: open while the
 * person's mode reaches the platform at all (gateway, connected features or sync — i.e.
 * not Local only). It is NOT the `synchronize` switch: an outbox's activity beat, error
 * report or run outcome is not the sync transport, and gating them on sync held every
 * queue (and, in the editor, a Hybrid run's own writes — `platform_send_disabled`) while
 * sync was off. Each request that leaves is still decided by `platformRequestRefusal`.
 */
export function platformSendPermission(policy: PlatformPolicy): {
  isAllowed(): boolean;
  subscribe(listener: (allowed: boolean) => void): () => void;
} {
  return {
    isAllowed: () => platformReachable(policy.snapshot()),
    subscribe: (listener) => policy.subscribe((snapshot) => listener(platformReachable(snapshot))),
  };
}

export type PlatformRequestOutcome = 'attempted' | 'blocked';

export interface PlatformRequestRecord {
  capability: PlatformCapability;
  url: string;
  outcome: PlatformRequestOutcome;
  at: string;
}

export function createGuardedPlatformFetch(options: {
  policy: PlatformPolicy;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  onRequest?(record: PlatformRequestRecord): void;
  now?: () => Date;
  /**
   * The decision for a request, when it is not the bare capability check: the capability
   * that refuses it, or null. A host's GLOBAL guard passes the shared request gate
   * (`platformRequestRefusal`) here; an explicit capability call (`platformFetch(…,
   * 'synchronize')`) keeps the default, `policy.allows(capability)`.
   */
  decide?(capability: PlatformCapability, input: string, init: RequestInit | undefined): PlatformCapability | null;
}): (input: string, init: RequestInit | undefined, capability?: PlatformCapability) => Promise<Response> {
  const now = options.now ?? (() => new Date());
  const decide = options.decide ?? ((capability: PlatformCapability) => (options.policy.allows(capability) ? null : capability));
  return async (input, init, capability = 'connected-feature') => {
    const refused = decide(capability, input, init);
    if (refused) {
      options.onRequest?.({ capability: refused, url: input, outcome: 'blocked', at: now().toISOString() });
      throw new PlatformAccessDenied(refused);
    }
    options.onRequest?.({ capability, url: input, outcome: 'attempted', at: now().toISOString() });
    return options.fetch(input, { ...init, redirect: 'error' });
  };
}
