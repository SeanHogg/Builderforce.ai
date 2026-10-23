/**
 * `promise`, or a rejection after `ms` — the timer never outlives the race. THE bound for
 * a browser call that can hang without ever settling (a WebGPU adapter request, a thread
 * pool start): every page-engine module reads it from here.
 */
/** The rejection {@link withTimeout} raises — typed, so a caller tells "too slow" apart. */
export class SettleTimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`${what} did not settle within ${ms} ms`);
    this.name = 'SettleTimeoutError';
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SettleTimeoutError(what, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
