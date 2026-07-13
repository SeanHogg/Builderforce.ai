/**
 * Node / server / compiled-code entrypoint — same canonical contract as the
 * browser SDK, without the DOM hooks. Use in API servers, workers, or CLIs to
 * report caught errors to your Quality ingest endpoint.
 *
 *   import { createServerCapture } from '@seanhogg/builderforce-quality/server';
 *   const quality = createServerCapture({ key, endpoint, environment: 'production' });
 *   try { … } catch (e) { await quality.captureException(e); }
 */

import type { CaptureContext, QualityClientOptions } from './types';
import { toEvent, postEvents } from './core';

export type { CaptureContext, NormalizedErrorEvent, QualityClientOptions, ErrorLevel, StackFrame } from './types';

export interface ServerCapture {
  /** Report one error immediately (awaitable). Resolves false on transport failure. */
  captureException(err: unknown, ctx?: CaptureContext): Promise<boolean>;
  captureMessage(message: string, ctx?: CaptureContext): Promise<boolean>;
}

/** Create a thin server-side capturer (no batching — server callers await each send). */
export function createServerCapture(options: QualityClientOptions): ServerCapture {
  if (!options.key) throw new Error('builderforce-quality: `key` is required');
  if (!options.endpoint) throw new Error('builderforce-quality: `endpoint` is required');
  return {
    captureException: (err, ctx) => postEvents(options, [toEvent(err, options, ctx)]),
    captureMessage: (message, ctx) => postEvents(options, [toEvent(new Error(message), options, { level: 'info', ...ctx })]),
  };
}
