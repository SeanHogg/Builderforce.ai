/**
 * The completion-handler port. A deferred call site exports one handler beside the
 * synchronous code it replaces, so the write it does on settle is the write that code
 * does — the handler is the tail of the old synchronous function, not a copy of it.
 * `batchCallbackRegistry.ts` maps each `BatchCallbackKind` to its handler.
 */
import type { Env } from '../../../env';
import type { Db } from '../../../infrastructure/database/connection';
import type { BatchJob } from './batchTypes';

export interface BatchSettleContext {
  env: Env;
  /** The core handle (the handler's own tables live there, not on the queue's endpoint). */
  db: Db;
}

/** What the provider answered for one job. */
export interface BatchCompletion {
  /** The model's text (OpenAI-shape `choices[0].message.content`). */
  content: string;
  /** The model that answered. */
  model: string;
}

export interface BatchCallbackHandler {
  /** Apply the answer. A throw marks the job failed with the error; it is not retried —
   *  the provider call already succeeded and was billed. */
  settle(ctx: BatchSettleContext, job: BatchJob, completion: BatchCompletion): Promise<void>;
  /** The job failed for good with no answer (the batch AND the synchronous fallback
   *  could not get one). Optional: for a caller whose synchronous path had a fallback of
   *  its own on a failed call — the distillation teacher learns the raw run text. */
  abandon?(ctx: BatchSettleContext, job: BatchJob, error: string): Promise<void>;
}
