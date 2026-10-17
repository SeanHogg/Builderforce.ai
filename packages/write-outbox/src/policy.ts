/**
 * Defaults and the retry rule the outbox applies when a host does not set its own.
 */

export const OUTBOX_MAX_ITEMS = 25;
export const OUTBOX_MAX_WAIT_MS = 5_000;
export const OUTBOX_MAX_ENTRIES = 1_000;
export const OUTBOX_RETRY_BASE_MS = 1_000;
export const OUTBOX_RETRY_MAX_MS = 5 * 60_000;

/**
 * The default {@link OutboxRetryPolicy.isPermanent}: the server read the request and
 * refused it, so repeating it verbatim changes nothing. 401 (credential may be renewed),
 * 408, 409 (a concurrent duplicate), 425 and 429 are worth another try; so is any failure
 * without a numeric `status` (the request never got an answer).
 */
export function isPermanentHttpFailure(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status !== "number") return false;
  return status >= 400 && status < 500 && ![401, 408, 409, 425, 429].includes(status);
}
