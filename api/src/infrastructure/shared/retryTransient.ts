/**
 * Bounded retry for TRANSIENT platform rate limits.
 *
 * Cloudflare's storage services reject bursts against the same key rather than
 * queueing them — R2 with `10058 Reduce your concurrent request rate for the
 * same object`, KV with `429 Too Many Requests` on its one-write-per-second
 * per-key ceiling. Neither is a bad request: the correct response is to wait a
 * moment and try again.
 *
 * The predicate is the caller's, because only the caller knows which of its
 * failures are contention and which are real. Everything the predicate rejects
 * propagates on the FIRST attempt — retrying a genuine fault only delays the
 * error the caller needs to see.
 */

export interface RetryTransientOptions {
  /** Total attempts including the first. */
  attempts?: number;
  /** Base delay; each retry waits `base * 2 ** attempt` plus jitter. */
  baseDelayMs?: number;
}

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 120;

export async function retryTransient<T>(
  operation: () => Promise<T>,
  isTransient: (error: unknown) => boolean,
  opts?: RetryTransientOptions,
): Promise<T> {
  const attempts = Math.max(1, opts?.attempts ?? DEFAULT_ATTEMPTS);
  const base = opts?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;

  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= attempts - 1 || !isTransient(error)) throw error;
      // Exponential backoff with jitter so two racing writers do not re-collide
      // in lockstep on the retry.
      const delay = base * 2 ** attempt + Math.floor(Math.random() * base);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/** R2 rejects rapid successive writes to the SAME key with error 10058. */
export function isR2SameObjectRateLimit(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('10058') || /concurrent request rate/i.test(message);
}

/** Workers KV rejects >1 write/second to the same key with a 429. */
export function isKvRateLimit(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('429') || /too many requests|rate limit/i.test(message);
}
