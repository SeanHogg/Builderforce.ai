/**
 * Test double for `rrweb` (aliased in vitest.config.ts). The production IIFE
 * bundles the real package. Records every `record()` call so tests can read
 * the options and drive `emit`.
 */

export interface RecordCall {
  options: Record<string, unknown> & { emit: (event: unknown, isCheckout?: boolean) => void };
  stopped: boolean;
}

export const recordCalls: RecordCall[] = [];

export function record(options: RecordCall['options']): () => void {
  const call: RecordCall = { options, stopped: false };
  recordCalls.push(call);
  return () => {
    call.stopped = true;
  };
}
