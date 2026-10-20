/**
 * G26 remainder: a secret must never enter the sync queue.
 *
 * Copies the queue shape (id, kind, occurredAt, destinationKey, body) into a
 * new object and omits any field whose name matches a secret pattern, including
 * fields nested inside body. A dropped field is absent — not a placeholder
 * that still carries the value. This module does not enqueue.
 */

const QUEUE_FIELDS = ['id', 'kind', 'occurredAt', 'destinationKey', 'body'] as const;

/** Unanchored, so accessToken, sessionCookie, and APIKEY are secrets too. */
const SECRET_FIELD = /token|secret|password|authorization|cookie|apiKey/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Drop secret-named keys at every depth. Non-objects are copied by value. */
function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (SECRET_FIELD.test(key)) continue;
    out[key] = redactValue(value[key]);
  }
  return out;
}

/**
 * Queue-safe copy of `record`. Allowed fields only; secret-named fields,
 * including nested body fields, are omitted entirely. The input is not mutated.
 * An empty record returns a new empty object.
 */
export function redactForQueue(record: unknown): Record<string, unknown> {
  if (!isPlainObject(record)) return {};
  const out: Record<string, unknown> = {};
  for (const key of QUEUE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    if (SECRET_FIELD.test(key)) continue;
    out[key] = redactValue(record[key]);
  }
  return out;
}
