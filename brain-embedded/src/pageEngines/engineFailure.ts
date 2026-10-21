/**
 * Where a page engine's NON-fatal failure goes — the one reporter for the failures the
 * engines degrade around rather than throw: a probe that rejected (read as "nothing to
 * serve"), a cache lookup that failed (read as "not downloaded"), an unload or a
 * storage-persistence request that was refused, a malformed chunk dropped mid-stream,
 * an on-device store that failed to load (read as "tier off, fall through to the server"),
 * a stream or model-file read whose cancel was refused (the reader is dropped either way).
 *
 * Each of those keeps the turn working, which is exactly why it must not vanish: without
 * the reason, "my downloaded model never answers" has no answer. One line per failure,
 * in one format, so a host log or a bug report can name the engine and the stage.
 */

import type { LocalRuntimeId } from '@builderforce/local-inference';
import { errorMessage } from './types';

/** The step that failed. */
export type PageEngineFailureStage = 'probe' | 'cache_lookup' | 'support' | 'measure' | 'unload' | 'persist' | 'chunk' | 'load' | 'trap' | 'cancel';

export function reportPageEngineFailure(runtime: LocalRuntimeId, stage: PageEngineFailureStage, error: unknown): void {
  console.warn(`BuilderForce page engine: ${runtime} ${stage} failed (${errorMessage(error)})`);
}
