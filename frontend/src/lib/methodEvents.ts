/**
 * The method, measured on builderforce.ai itself (PRD 33 §5.3.6, dogfood).
 *
 * The four acts — read the idea, choose a proof, build it, grade it — are sent to
 * the page's own Insights recorder as `BFReplay.event(<act>)`, so "The method"
 * funnel (seeded by the operator on the Builderforce workspace's site) shows where
 * people drop out of it. Emitted ONLY from the `realizationApi` wrappers, and only
 * on success: one place an act is known to have happened, so the funnel cannot
 * double-count a retry or count a click that failed (`methodEvents.test.ts` pins
 * that no other module calls it).
 *
 * A no-op without the recorder (signed-out pages, tests, a visitor who declined);
 * never throws — a measurement must not break the act it measures.
 */

export const METHOD_EVENTS = ['idea.read', 'proof.choose', 'proof.build', 'proof.grade'] as const;
export type MethodEvent = (typeof METHOD_EVENTS)[number];

interface ReplayEventApi {
  event?: (name: string) => void;
}

export function emitMethodEvent(action: MethodEvent): void {
  if (typeof window === 'undefined') return;
  try {
    (window as Window & { BFReplay?: ReplayEventApi }).BFReplay?.event?.(action);
  } catch (error) {
    void error;
  }
}
