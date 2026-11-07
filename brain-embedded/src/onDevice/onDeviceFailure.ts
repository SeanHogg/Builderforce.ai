/**
 * Where an on-device task's NON-fatal failure goes (PRD 42): an observer that threw, a
 * token measurement that was refused, a readiness probe that rejected. Each keeps the call
 * working (the observer never fails a request; a failed probe reads as "not available"), which
 * is exactly why the reason must not vanish. One line per failure, in one format.
 */

export type OnDeviceFailureStage = 'observe' | 'measure' | 'contextTokens' | 'available' | 'ready';

export function reportOnDeviceFailure(stage: OnDeviceFailureStage, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  console.warn(`BuilderForce on-device: ${stage} failed (${reason})`);
}

/** A `.catch` handler that records why, then settles the promise with `value`. */
export function fallbackAfterFailure<T>(stage: OnDeviceFailureStage, value: T): (error: unknown) => T {
  return (error) => {
    reportOnDeviceFailure(stage, error);
    return value;
  };
}
