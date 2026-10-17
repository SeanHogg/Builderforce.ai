/**
 * Agent-host heartbeat write throttle.
 *
 * Every connected host PATCHes `/api/agent-hosts/:id/heartbeat` on a short cadence
 * (RelayHeartbeat in agent-runtime). Writing `agent_hosts` on every beat was a
 * steady UPDATE stream per host for a column whose only reader asks "within the
 * last `AGENT_HOST_STALE_MS` (domain/agentHost/onlineStatus)?". So a beat writes
 * only when it would change something a reader can see:
 *   - `last_seen_at` is older than {@link HEARTBEAT_WRITE_THROTTLE_MS}, or
 *   - the reported capabilities / machine profile differ from the last ones written.
 *
 * The throttle is bound to the online threshold, not picked freely: with the
 * runtime's {@link HEARTBEAT_EXPECTED_CADENCE_MS} cadence, the first beat at or past
 * the throttle writes, and one dropped beat adds another cadence. Both
 * together must stay inside the staleness window, or a live host would flicker
 * offline (and stage dispatch would skip it) on a single lost request. The
 * test pins that relation so neither constant can drift past it.
 */
import type { CacheEnv } from '../../infrastructure/cache/readThroughCache';
import { peekCached, setCached } from '../../infrastructure/cache/readThroughCache';

/** The runtime's heartbeat cadence (agent-runtime RelayHeartbeat). Older runtimes beat
 *  every 5 min; at that cadence the throttle below writes every second beat. */
export const HEARTBEAT_EXPECTED_CADENCE_MS = 4 * 60_000;

/** Skip the row write while `last_seen_at` is younger than this. */
export const HEARTBEAT_WRITE_THROTTLE_MS = 7 * 60_000;

/** Worst-case `last_seen_at` age for a live host: the first beat at or past the
 *  throttle is the one that writes, plus one dropped beat. Must stay below
 *  `AGENT_HOST_STALE_MS` (domain/agentHost/onlineStatus) — asserted in
 *  heartbeatThrottle.test.ts. 4-min cadence: writes every 8 min, worst case 12. */
export function heartbeatWorstCaseAgeMs(cadenceMs: number = HEARTBEAT_EXPECTED_CADENCE_MS): number {
  return Math.ceil(HEARTBEAT_WRITE_THROTTLE_MS / cadenceMs) * cadenceMs + cadenceMs;
}

/** How long the last-written payload fingerprint is remembered. Long, because it is only
 *  rewritten when the payload CHANGES — a miss just costs one extra row write. */
const FINGERPRINT_KV_TTL_SECONDS = 24 * 60 * 60;

export const heartbeatFingerprintCacheKey = (agentHostId: number): string =>
  `agent-host:heartbeat:fp:${agentHostId}`;

/** A stable fingerprint of what a beat would write besides `last_seen_at`, or null when
 *  the beat carries nothing but liveness (an empty body). */
export function heartbeatPayloadFingerprint(
  capabilitiesJson: string | undefined,
  machineProfile: object | null,
): string | null {
  if (capabilitiesJson === undefined && !machineProfile) return null;
  return JSON.stringify({ c: capabilitiesJson ?? null, m: machineProfile ?? null });
}

/**
 * THE throttled-liveness rule, shared by every heartbeat writer (this agent-host beat
 * and the cloud execution beat in runtime/cloudAgent/runContext): write when nothing
 * is known to have been written, when the last write is at least `throttleMs` old, or
 * when the beat carries a change a reader can see. Each caller binds `throttleMs` to
 * ITS reader's staleness window; the rule itself is the same.
 */
export function throttledWriteDue(args: {
  /** When the row was last written (ms epoch); null = unknown. */
  lastWrittenAtMs: number | null;
  throttleMs: number;
  /** The beat carries something besides liveness that differs from the last write. */
  changed?: boolean;
  now?: number;
}): boolean {
  const now = args.now ?? Date.now();
  if (args.lastWrittenAtMs == null || now - args.lastWrittenAtMs >= args.throttleMs) return true;
  return args.changed === true;
}

/** Pure decision: must this beat write the row? */
export function heartbeatWriteDue(args: {
  lastSeenAt: Date | null;
  /** This beat's payload fingerprint; null = liveness only. */
  fingerprint: string | null;
  /** The fingerprint last written; null = unknown (cache miss). */
  lastFingerprint: string | null;
  now?: number;
}): boolean {
  return throttledWriteDue({
    lastWrittenAtMs: args.lastSeenAt ? args.lastSeenAt.getTime() : null,
    throttleMs: HEARTBEAT_WRITE_THROTTLE_MS,
    // A liveness-only beat has nothing else to write; an unknown last payload cannot
    // be claimed "unchanged", so it writes.
    changed: args.fingerprint !== null && args.fingerprint !== args.lastFingerprint,
    ...(args.now != null ? { now: args.now } : {}),
  });
}

/** Read the fingerprint last written for a host (L1, then KV). */
export function readHeartbeatFingerprint(env: CacheEnv, agentHostId: number): Promise<string | null> {
  return peekCached<string>(env, heartbeatFingerprintCacheKey(agentHostId));
}

/** Remember the fingerprint just written — only when it changed, so steady-state beats
 *  cost no KV writes. */
export async function rememberHeartbeatFingerprint(
  env: CacheEnv,
  agentHostId: number,
  fingerprint: string | null,
  previous: string | null,
): Promise<void> {
  if (fingerprint === null || fingerprint === previous) return;
  await setCached(env, heartbeatFingerprintCacheKey(agentHostId), fingerprint, {
    kvTtlSeconds: FINGERPRINT_KV_TTL_SECONDS,
    l1TtlMs: HEARTBEAT_WRITE_THROTTLE_MS,
  });
}
