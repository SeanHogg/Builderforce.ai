/**
 * LOCAL FIRST — the ordered attempts for one call: capable on-device model(s), then the
 * cloud gateway.
 *
 * "Capable" is decided from what the runtime REPORTED, conservatively:
 *  - a TOOL turn goes only to a model the runtime says can take tools; unknown is no.
 *    A model that ignores `tools` answers an agent turn with prose about calling one —
 *    that is not a failure the failover can see, so it must never be attempted;
 *  - a model whose reported context window cannot hold the prompt plus the expected
 *    completion is skipped. An UNREPORTED window is not disqualifying: an overflow there
 *    is an HTTP error from the runtime, which the failover does see and recovers from.
 *
 * Only `onDevice` runtimes take part, in the registry's `automaticRank` — our engines
 * first, a third-party server (Ollama, FreeToken) last. `kimi-code` is locally dispatched
 * but hosted, so it is reachable by an explicit pin and never by local-first. Pure.
 */

import { isServableLocalModel, type LocalModel, type LocalRuntimeProbe } from './probe.js';
import { LOCAL_RUNTIMES, type LocalEndpoint, type LocalRuntimeId } from './runtimes.js';

/**
 * The slice of `@builderforce/workload`'s `WorkloadProfile` this plan reads. Structural
 * on purpose: a `WorkloadProfile` is assignable to it, and the package stays free of
 * the workload package's own dependency graph — it is bundled into the editor's webview
 * and a browser extension, where that graph would have to be resolved too.
 */
export interface LocalFirstWorkload {
  /** The call carries tools (an agent turn). */
  agentic: boolean;
  inputTokens: number;
  outputTokens: number;
}

export type LocalFirstAttempt =
  | {
      kind: 'local';
      /** Full `local/<runtime>/<model>` ref — what a trace and a provenance chip show. */
      ref: string;
      provider: LocalRuntimeId;
      /** The bare id the runtime knows. */
      model: string;
      endpoint: LocalEndpoint;
    }
  | {
      kind: 'cloud';
      /** The host's cloud choice; undefined = let the gateway route. */
      model?: string;
    };

/**
 * A connected subscription this host calls ITSELF because its provider refuses our cloud
 * (Kimi Code — registry `accountProvider`). It takes its place IN the tenant's BYO
 * precedence rather than always leading: see {@link LocalFirstAccount.placement}.
 */
export type LocalFirstAccount = Omit<Extract<LocalFirstAttempt, { kind: 'local' }>, 'kind'> & {
  /**
   * Where the account sits relative to the gateway, from the tenant's precedence:
   *  - `lead` (absent = lead): its provider is the tenant's first HEALTHY account, so it is
   *    tried after this device and BEFORE the cloud;
   *  - `trail`: another account ranks ahead of it, which only the gateway can call — the
   *    cloud goes first (cascading over the tenant's server-reachable accounts in order),
   *    and this account is tried only when the cloud fails before any output.
   */
  placement?: 'lead' | 'trail';
};

export interface LocalFirstInput {
  probes: readonly LocalRuntimeProbe[];
  /** Connected accounts: each `lead` one after the device attempts and before the cloud,
   *  each `trail` one after the cloud (see {@link LocalFirstAccount.placement}). */
  accounts?: readonly LocalFirstAccount[];
  workload: LocalFirstWorkload;
  /** The cloud fallback, or null when there is none (signed out: local-only). */
  cloud: { model?: string } | null;
  /** A local ref to try before the registry order, when it is capable. */
  preferred?: string;
  /** How many local models to try before the cloud. Default 1 — each failed local
   *  attempt is latency the user waits through before the cloud answers. */
  maxLocalAttempts?: number;
}

/** Why a reported model may not serve this call, or null when it may. */
export function localModelUnfitReason(
  model: Pick<LocalModel, 'tools' | 'contextTokens'>,
  workload: LocalFirstWorkload,
): 'tools' | 'context' | null {
  if (workload.agentic && model.tools !== true) return 'tools';
  if (model.contextTokens !== undefined && model.contextTokens < workload.inputTokens + workload.outputTokens) {
    return 'context';
  }
  return null;
}

/** The ordered attempt list. Empty only when no local model fits AND there is no cloud. */
export function localFirstPlan(input: LocalFirstInput): LocalFirstAttempt[] {
  const onDevice = new Set(LOCAL_RUNTIMES.filter((r) => r.onDevice).map((r) => r.id));
  const rank = (id: LocalRuntimeId): number =>
    LOCAL_RUNTIMES.find((r) => r.id === id)?.automaticRank ?? Number.POSITIVE_INFINITY;
  const candidates = input.probes
    .filter((p) => p.reachable && onDevice.has(p.provider))
    .sort((a, b) => rank(a.provider) - rank(b.provider))
    .flatMap((p) =>
      p.models
        .filter((m) => isServableLocalModel(m) && localModelUnfitReason(m, input.workload) === null)
        .map((m): LocalFirstAttempt => ({
          kind: 'local',
          ref: m.ref,
          provider: p.provider,
          model: m.model,
          endpoint: p.endpoint,
        })),
    );
  const preferredIndex = input.preferred
    ? candidates.findIndex((c) => c.kind === 'local' && c.ref === input.preferred)
    : -1;
  if (preferredIndex > 0) candidates.unshift(...candidates.splice(preferredIndex, 1));
  const local = candidates.slice(0, Math.max(0, input.maxLocalAttempts ?? 1));
  // A connected account's runtime takes every call its registry row allows (`tools: 'all'`).
  // Placement is the account's only extra field; the attempt carries just the route.
  const attemptOf = ({ placement: _placement, ...account }: LocalFirstAccount): LocalFirstAttempt => ({ kind: 'local', ...account });
  const accounts = input.accounts ?? [];
  const lead = accounts.filter((a) => a.placement !== 'trail').map(attemptOf);
  const trail = accounts.filter((a) => a.placement === 'trail').map(attemptOf);
  const cloud: LocalFirstAttempt[] = input.cloud
    ? [{ kind: 'cloud', ...(input.cloud.model ? { model: input.cloud.model } : {}) }]
    : [];
  return [...local, ...lead, ...cloud, ...trail];
}
