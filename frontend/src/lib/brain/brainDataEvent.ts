/**
 * Decoupled "Brain changed some data" event bus.
 *
 * When the Brain runs a mutating platform capability (create/update/delete a
 * task, project, spec, …) the write hits the typed API client but the page that
 * is *showing* that data (e.g. the Tasks board in `TaskMgmtContent`) holds its
 * own React state and has no idea a change happened elsewhere in the tree. The
 * board then looks stale until a manual reload — exactly the "approved the task
 * but the board didn't update" symptom.
 *
 * The platform-action layer announces every successful write here; data views
 * subscribe (filtered to the domains they render) and refetch. Neither side
 * imports the other — they communicate via a window CustomEvent, mirroring the
 * existing {@link ../errors/apiErrorEvent} bus.
 */

export interface BrainDataChangedEvent {
  /** Capability domain that changed, e.g. "tasks", "projects", "specs". */
  domain: string;
  /** Capability method, e.g. "create", "update", "delete". */
  method: string;
}

export const BRAIN_DATA_CHANGED_EVENT = 'builderforce:brain-data-changed' as const;

/** Announce that a Brain-driven write to `domain` succeeded. No-op on the server. */
export function dispatchBrainDataChanged(detail: BrainDataChangedEvent): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<BrainDataChangedEvent>(BRAIN_DATA_CHANGED_EVENT, { detail }));
}

/**
 * Subscribe to Brain data changes, filtered to the `domains` the caller renders
 * (pass an empty array to receive every change). Returns an unsubscribe fn so
 * consumers can wire it straight into a `useEffect` cleanup. No-op on the server.
 */
export function onBrainDataChanged(
  domains: string[],
  handler: (event: BrainDataChangedEvent) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const want = new Set(domains);
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<BrainDataChangedEvent>).detail;
    if (!detail) return;
    if (want.size > 0 && !want.has(detail.domain)) return;
    handler(detail);
  };
  window.addEventListener(BRAIN_DATA_CHANGED_EVENT, listener);
  return () => window.removeEventListener(BRAIN_DATA_CHANGED_EVENT, listener);
}
