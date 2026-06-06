/**
 * Canonical "is this agentHost online?" rule — the single source of truth shared
 * by every route and service that reports liveness (list, fleet, fleet/route,
 * nodes, status).
 *
 * Why this is not simply `connectedAt !== null`:
 * `connectedAt` is set when the relay WebSocket opens and cleared by the socket's
 * `close` handler — but that handler is best-effort. A host that is killed,
 * crashes, or is deleted from its machine never cleanly closes the socket, so
 * `connectedAt` can stay set forever and the host shows ONLINE indefinitely.
 *
 * `lastSeenAt` is refreshed by a periodic HTTP heartbeat (every 5 minutes; see
 * RelayHeartbeat in the agent-runtime). It is the liveness signal that catches
 * dead hosts: if no heartbeat has landed within the staleness window we treat the
 * host as offline regardless of a stuck `connectedAt`.
 */

/** Heartbeat cadence is 5 min; allow 3 missed beats before declaring a host dead. */
export const AGENT_HOST_STALE_MS = 15 * 60 * 1000;

type AgentHostLiveness = {
  connectedAt: Date | string | null;
  lastSeenAt: Date | string | null;
};

export function isAgentHostOnline(host: AgentHostLiveness, now: number = Date.now()): boolean {
  if (host.connectedAt == null) return false;
  if (host.lastSeenAt == null) return false;
  const seen = host.lastSeenAt instanceof Date ? host.lastSeenAt.getTime() : new Date(host.lastSeenAt).getTime();
  if (Number.isNaN(seen)) return false;
  return now - seen <= AGENT_HOST_STALE_MS;
}
