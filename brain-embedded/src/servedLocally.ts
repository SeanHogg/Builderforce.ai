/**
 * Was this model call served by a model ON THIS MACHINE (the hybrid local tier: Synapse native, Ollama, any
 * on-device model)? Decided from what the transport that actually served the turn reported - the
 * local-first runner's `served` attempt, or the resolved model - never from what was asked for, and by
 * `runsOnDevice` (the runtime registry's `onDevice`), NOT by the `local/` prefix: a hosted runtime dispatched
 * from here (`local/kimi-code`) is local in grammar but leaves the device and is paid. A turn that is not
 * on-device has an UNKNOWN cost, never 0.
 *
 * Not the usage ledger's route (`localChat/usageLedger.ts`): that names a dispatch route by grammar; this
 * decides whether the turn was free.
 */

import { runsOnDevice } from '@builderforce/local-inference';
import type { StreamChatResult } from './streamChatCompletion';

export function servedLocally(result: Pick<StreamChatResult, 'resolvedModel' | 'localFirst'>, requested?: string): boolean {
  if (result.localFirst?.some((attempt) => attempt.outcome === 'served' && runsOnDevice(attempt.target))) return true;
  return runsOnDevice(result.resolvedModel ?? requested ?? '');
}
