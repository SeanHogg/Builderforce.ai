import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * THE per-request (or per-event) scope: what the current Worker invocation is,
 * and how to keep work alive after its response is sent.
 *
 * One AsyncLocalStorage for the isolate, entered once by each entry point in
 * `index.ts` (fetch, scheduled, queue). Anything that needs request identity
 * (error reporting) or needs to outlive the response (a cache write-back, a
 * durable error report) reads it from here instead of having a context threaded
 * through every signature between the entry point and itself.
 */
export interface RequestScope {
  env: unknown;
  method?: string;
  path?: string;
  tenantId?: number;
  userId?: string;
  /** The invocation's `ctx.waitUntil` — absent in tests and non-Worker callers. */
  waitUntil?: (task: Promise<unknown>) => void;
  /** Version-token keys already bumped in this scope, with the time (see `bumpVersion`). */
  bumpedAt?: Map<string, number>;
}

const storage = new AsyncLocalStorage<RequestScope>();

/** Run one request/event inside its own scope. */
export function runInRequestScope<T>(scope: RequestScope, work: () => T): T {
  return storage.run(scope, work);
}

/** The scope of the invocation currently running, if any. */
export function currentRequestScope(): RequestScope | undefined {
  return storage.getStore();
}

/** Add identity discovered later (by the auth middleware) to the current scope. */
export function updateRequestScope(update: Pick<RequestScope, 'tenantId' | 'userId'>): void {
  const current = storage.getStore();
  if (current) Object.assign(current, update);
}

/**
 * Let `task` finish after the response is sent. Returns false when there is no
 * invocation to attach it to (or the runtime refused it) — the caller then decides
 * whether to await it instead, because an unattached promise in a Worker can be
 * cancelled the moment the response goes out.
 */
export function deferPastResponse(task: Promise<unknown>, scope: RequestScope | undefined = storage.getStore()): boolean {
  if (!scope?.waitUntil) return false;
  try {
    scope.waitUntil(task);
    return true;
  } catch {
    // Not swallowed: `false` hands the task back, and the caller awaits it itself.
    return false;
  }
}

/**
 * Enter a scope for a Durable Object entry point (fetch / alarm). A DO is not reached
 * through `index.ts`, so without this its writes see no ambient env and every
 * scope-driven cache bump (chat versions, unread) is silently skipped.
 */
export function runInDurableObjectScope<T>(
  className: string,
  env: unknown,
  state: { waitUntil(task: Promise<unknown>): void },
  work: () => T,
): T {
  return runInRequestScope({ env, method: 'DO', path: className, waitUntil: (task) => state.waitUntil(task) }, work);
}
