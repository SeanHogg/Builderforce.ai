/**
 * ONE classifier for whether the BuilderForce platform is usable, and the one place that state lives.
 *
 *   online      the API answered with anything that is not a gateway/availability failure (2xx/3xx/4xx)
 *   degraded    the API answered, but with 502/503/504 (503 `database_unavailable` is the API's own
 *               database-outage answer) — it is up, yet cannot serve the request
 *   unreachable no answer at all (fetch threw / timed out)
 *
 * The classification is by STATUS ALONE, so a response body is never read: the caller's body is
 * untouched. Any 2xx/3xx/4xx recovers to `online` immediately. Fed by `trackReachability`; read by the
 * outbox (pause unless online) and the status-bar item.
 */

export type PlatformHealthState = "online" | "degraded" | "unreachable";

/** Classify an HTTP answer. 5xx availability statuses are degraded; everything else is a healthy answer. */
export function classifyPlatformStatus(status: number): "online" | "degraded" {
  return status === 502 || status === 503 || status === 504 ? "degraded" : "online";
}

export interface PlatformHealthSignal {
  state(): PlatformHealthState;
  /** The server answered with `status`. Returns the resulting state. */
  reportResponse(status: number): PlatformHealthState;
  /** The request got no answer (threw / timed out). */
  reportUnreachable(): PlatformHealthState;
  /** Listeners hear only real transitions. Returns the unsubscribe. */
  subscribe(listener: (state: PlatformHealthState) => void): () => void;
}

export function createPlatformHealth(initial: PlatformHealthState = "online"): PlatformHealthSignal {
  let current = initial;
  const listeners = new Set<(state: PlatformHealthState) => void>();
  const set = (next: PlatformHealthState): PlatformHealthState => {
    if (next === current) return current;
    current = next;
    for (const l of [...listeners]) l(next);
    return current;
  };
  return {
    state: () => current,
    reportResponse: (status) => set(classifyPlatformStatus(status)),
    reportUnreachable: () => set("unreachable"),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The extension's one platform-health signal. */
export const platformHealth = createPlatformHealth();
