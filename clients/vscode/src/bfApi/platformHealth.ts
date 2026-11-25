/**
 * ONE classifier for whether the BuilderForce platform is usable, and the one place that state lives.
 *
 *   online      the API answered with anything that is not a gateway/availability failure (2xx/3xx/4xx)
 *   degraded    the API answered, but with 502/503/504 (503 `database_unavailable` is the API's own
 *               database-outage answer) — it is up, yet cannot serve the request
 *   unreachable no answer at all (fetch threw / timed out)
 *
 * The classification is by STATUS ALONE, so a response body is never read: the caller's body is
 * untouched. Fed by `trackReachability`; read by the outbox (pause unless online) and the status-bar item.
 *
 * Only calls to the platform's OWN API feed this (`trackReachability` wraps `fetchAuthed`, the session
 * exchange and the run-outcome POST). LLM completions never pass through it, so an upstream provider's
 * 502/503/504 relayed by the gateway cannot mark the platform degraded; the one route that tests a
 * provider key answers a handled 200.
 *
 * HYSTERESIS. A single answer must not flap the bar or the outbox, so {@link PlatformHealthSignal.state}
 * is the STABLE state, not the last response:
 *   - it leaves `online` once {@link BAD_ANSWERS_TO_TRIP} non-online answers land within
 *     {@link BAD_WINDOW_MS}, or one non-online answer has stood unanswered by an online one for
 *     {@link BAD_SUSTAINED_MS};
 *   - it returns to `online` only after {@link RECOVERY_MS} of CONTINUOUS online answers;
 *   - while non-online, degraded/unreachable follows the latest answer at once.
 * The per-response classification is {@link classifyPlatformStatus}; this machine only decides when it counts.
 */

export type PlatformHealthState = "online" | "degraded" | "unreachable";

export const BAD_ANSWERS_TO_TRIP = 2;
export const BAD_WINDOW_MS = 30_000;
export const BAD_SUSTAINED_MS = 5_000;
export const RECOVERY_MS = 30_000;

/** Classify an HTTP answer. 5xx availability statuses are degraded; everything else is a healthy answer. */
export function classifyPlatformStatus(status: number): "online" | "degraded" {
  return status === 502 || status === 503 || status === 504 ? "degraded" : "online";
}

export interface PlatformHealthSignal {
  /** The hysteresis-STABLE state (see the module comment), not the last response. */
  state(): PlatformHealthState;
  /** The server answered with `status`. Returns the resulting stable state. */
  reportResponse(status: number): PlatformHealthState;
  /** The request got no answer (threw / timed out). */
  reportUnreachable(): PlatformHealthState;
  /** Listeners hear only real transitions of the stable state. Returns the unsubscribe. */
  subscribe(listener: (state: PlatformHealthState) => void): () => void;
}

export function createPlatformHealth(initial: PlatformHealthState = "online"): PlatformHealthSignal {
  let stable = initial;
  /** The latest per-response answer — what the stable state is eventually reconciled with. */
  let latest: PlatformHealthState = initial;
  /** Times of recent non-online answers (pruned to the trip window). */
  let badAt: number[] = [];
  /** Start of the current unbroken run of non-online answers. */
  let badSince: number | undefined;
  /** Start of the current unbroken run of online answers while the stable state is not online. */
  let onlineSince: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<(state: PlatformHealthState) => void>();

  const clearTimer = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const setStable = (next: PlatformHealthState): void => {
    if (next === stable) return;
    stable = next;
    if (next === "online") badAt = [];
    for (const l of [...listeners]) l(next);
  };

  /** Apply whatever the clock alone now decides (sustained failure, completed recovery). */
  const settle = (now: number): void => {
    if (stable === "online" && latest !== "online" && badSince !== undefined && now - badSince >= BAD_SUSTAINED_MS) {
      setStable(latest);
    } else if (stable !== "online" && latest === "online" && onlineSince !== undefined && now - onlineSince >= RECOVERY_MS) {
      setStable("online");
    }
  };
  /** Wake up when the clock next decides something, so a quiet period still resolves. */
  const schedule = (now: number): void => {
    clearTimer();
    let due: number | undefined;
    if (stable === "online" && latest !== "online" && badSince !== undefined) due = badSince + BAD_SUSTAINED_MS;
    else if (stable !== "online" && latest === "online" && onlineSince !== undefined) due = onlineSince + RECOVERY_MS;
    if (due === undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      settle(Date.now());
      schedule(Date.now());
    }, Math.max(0, due - now));
    (timer as { unref?: () => void }).unref?.();
  };

  const report = (answer: PlatformHealthState): PlatformHealthState => {
    const now = Date.now();
    latest = answer;
    if (answer === "online") {
      badSince = undefined;
      if (stable !== "online") onlineSince ??= now;
    } else {
      onlineSince = undefined;
      badSince ??= now;
      badAt = [...badAt.filter((at) => now - at <= BAD_WINDOW_MS), now];
      if (stable !== "online") setStable(answer); // already tripped: degraded <-> unreachable follows at once
      else if (badAt.length >= BAD_ANSWERS_TO_TRIP) setStable(answer);
    }
    settle(now);
    schedule(now);
    return stable;
  };

  return {
    state: () => stable,
    reportResponse: (status) => report(classifyPlatformStatus(status)),
    reportUnreachable: () => report("unreachable"),
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
