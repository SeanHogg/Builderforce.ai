/**
 * Terms-acceptance gate signal.
 *
 * Three API middlewares (`webAuthMiddleware`, `authMiddleware`,
 * `superAdminMiddleware`) answer EVERY authenticated request with
 * `428 TERMS_ACCEPTANCE_REQUIRED` once the active terms version moves past the
 * one a user accepted. That is a GATE, not a fault: the app is meant to show the
 * acceptance screen, not a support-ticket toast.
 *
 * `useOnboardingState` resolves terms exactly once, when the web token appears.
 * A version bump mid-session therefore left the client convinced it was past the
 * gate while the server 428'd everything behind it — every background poll and
 * every best-effort flush raised a toast (the activity tracker, which flushes on
 * a 15s timer, produced one every 15 seconds), and nothing routed the user to
 * the one screen that unblocks them.
 *
 * So the transport now treats 428 the way it already treats 401 and 402:
 * recognised in ONE place, converted into an application signal, and kept off
 * the error surface. The onboarding gate listens and re-reads terms status,
 * flipping itself to `pending-terms` without a reload.
 */

export const TERMS_GATE_EVENT = 'builderforce:terms-required' as const;

/** The gate's status — RFC 6585 Precondition Required. */
const TERMS_GATE_STATUS = 428;

/**
 * The machine-readable code on the gate body. The status ALONE is not enough to
 * key on: the API also returns 428 for a missing `ROBLOX_API_KEY` on game
 * publish, which is a genuine fault the user has to see.
 */
const TERMS_GATE_CODE = 'TERMS_ACCEPTANCE_REQUIRED';

/**
 * The ONE decision of "is this response the terms gate?". Takes the already-parsed
 * envelope (`readErrorBody` clones the response, so all three transports have it,
 * streaming included). Dispatches the gate event and returns true when it is the
 * gate, so the caller can skip the global error surface.
 */
export function signalTermsGate(status: number, code: string | undefined): boolean {
  if (status !== TERMS_GATE_STATUS || code !== TERMS_GATE_CODE) return false;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(TERMS_GATE_EVENT));
  }
  return true;
}

/**
 * Subscribe to the gate. Returns the unsubscribe, so an effect can `return` it.
 *
 * The listener lives here rather than each consumer wiring `addEventListener`
 * with the event name, for the same reason the check does: one spelling of the
 * contract. A gate closing fires once per in-flight request — a page can have a
 * dozen — so handlers must be idempotent; `useOnboardingState` de-dupes with an
 * in-flight guard.
 */
export function onTermsGate(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(TERMS_GATE_EVENT, handler);
  return () => window.removeEventListener(TERMS_GATE_EVENT, handler);
}
