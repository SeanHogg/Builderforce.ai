/**
 * Shared message protocol for the Mamba Web Worker.
 *
 * Kept in its own module (imported by BOTH the worker host and the client) so the
 * two sides can never drift, without either importing the other — the worker
 * imports the engine-heavy provider; the client imports the worker URL. A shared
 * types-only module avoids a bundling cycle.
 */

import type { MambaProviderConfig, ModelContext } from './model-provider';

export interface TrainRequestOptions {
  learningRate?: number;
  epochs?: number;
  wsla?: boolean;
}

export type WorkerRequest =
  | { id: number; type: 'init'; config?: MambaProviderConfig }
  | { id: number; type: 'generate'; input: string; context?: ModelContext }
  | { id: number; type: 'stream'; input: string; context?: ModelContext }
  | { id: number; type: 'train'; corpus: string; options?: TrainRequestOptions }
  | { id: number; type: 'export'; opts?: { fp16?: boolean } }
  | { id: number; type: 'dispose' };

export type WorkerResponse =
  | { id: number; type: 'result'; value: unknown }
  | { id: number; type: 'error'; message: string }
  | { id: number; type: 'token'; token: string }
  | { id: number; type: 'epoch'; epoch: number; loss: number };

/** Distributive Omit — `Omit<Union, K>` collapses a union to its common keys, so
 *  we map over each member to strip `id` while keeping each variant's own fields. */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A request the client is about to send, before the transport stamps its `id`. */
export type WorkerRequestBody = DistributiveOmit<WorkerRequest, 'id'>;

/** Shape of the value returned for an `init` request. */
export interface InitResult {
  ready: boolean;
  failureReason: string | null;
}
