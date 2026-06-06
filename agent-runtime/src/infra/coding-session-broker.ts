/**
 * CodingSessionBroker — bridges the event-driven agent completion signal into an
 * awaitable promise for a coding dispatch.
 *
 * A coding dispatch sends the task to the local gateway agent on a dedicated
 * session key, then must wait for the agent to FINISH editing before it commits,
 * pushes, and opens the PR. The gateway reports completion as a `final` / `error`
 * chat event keyed by session — the relay calls resolveCodingSession() from that
 * event handler to unblock the waiting dispatch. Mirrors remote-result-broker.
 */

export interface CodingSessionOutcome {
  ok: boolean;
  /** Final assistant text (success) or error message (failure). */
  text: string;
}

type Pending = {
  resolve: (outcome: CodingSessionOutcome) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
};

const pending = new Map<string, Pending>();

/**
 * Wait up to timeoutMs for the agent session `sessionKey` to reach a terminal
 * state. Resolves (never rejects) — a timeout resolves as a failure outcome so
 * the dispatch always reports a terminal result rather than hanging.
 */
export function awaitCodingSession(sessionKey: string, timeoutMs = 1_800_000): Promise<CodingSessionOutcome> {
  return new Promise<CodingSessionOutcome>((resolve) => {
    const timeoutHandle = setTimeout(() => {
      pending.delete(sessionKey);
      resolve({ ok: false, text: `Agent session timed out after ${Math.round(timeoutMs / 1000)}s` });
    }, timeoutMs);
    pending.set(sessionKey, { resolve, timeoutHandle });
  });
}

/**
 * Resolve a pending coding session. Called by the relay's gateway-event handler
 * when a `final` (ok=true) or `error` (ok=false) chat event arrives. Returns
 * true if a dispatch was waiting on this session (so the relay can suppress the
 * generic execution-state report for coding sessions).
 */
export function resolveCodingSession(sessionKey: string, outcome: CodingSessionOutcome): boolean {
  const cb = pending.get(sessionKey);
  if (!cb) return false;
  clearTimeout(cb.timeoutHandle);
  pending.delete(sessionKey);
  cb.resolve(outcome);
  return true;
}

/** True if a coding dispatch is awaiting this session key. */
export function hasPendingCodingSession(sessionKey: string): boolean {
  return pending.has(sessionKey);
}
