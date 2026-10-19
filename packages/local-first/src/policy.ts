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

export function platformSendPermission(policy: PlatformPolicy): {
  isAllowed(): boolean;
  subscribe(listener: (allowed: boolean) => void): () => void;
} {
  return {
    isAllowed: () => policy.allows('synchronize'),
    subscribe: (listener) => policy.subscribe((snapshot) => listener(snapshot.synchronize)),
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
}): (input: string, init: RequestInit | undefined, capability?: PlatformCapability) => Promise<Response> {
  const now = options.now ?? (() => new Date());
  return async (input, init, capability = 'connected-feature') => {
    if (!options.policy.allows(capability)) {
      options.onRequest?.({ capability, url: input, outcome: 'blocked', at: now().toISOString() });
      throw new PlatformAccessDenied(capability);
    }
    options.onRequest?.({ capability, url: input, outcome: 'attempted', at: now().toISOString() });
    return options.fetch(input, { ...init, redirect: 'error' });
  };
}
