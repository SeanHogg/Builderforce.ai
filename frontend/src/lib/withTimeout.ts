/**
 * A promise that rejects after `ms` if `promise` has not settled by then.
 *
 * For work whose caller must stop WAITING — a first turn held for an app being created,
 * say — not for work that must stop: the original promise keeps running and its result,
 * if it lands late, is simply not this call's answer. The timer is cleared on settle, so
 * a promise that answers in time leaves nothing pending behind it.
 *
 * No 'use client' directive: a plain module.
 */
export class TimeoutError extends Error {
  constructor(readonly ms: number) {
    super(`Timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}
