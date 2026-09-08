/**
 * A card's RESOURCE REF — `"<type>:<id>"`, the string that says which real record a
 * board card stands for (`ceremony:9f2…`, `task:4021`, `chat:88`).
 *
 * ── WHY IT IS A MODULE ──────────────────────────────────────────────────────
 * The split was written out by hand wherever it was needed, and the hand-written
 * versions did not agree. The persistence writer took everything after the FIRST colon
 * as the id and treated a bare string with no colon as "no resource"; the stand-up
 * roster took everything after the first colon too but fell back to the node's own id;
 * a third caller would have written a third one. They are readings of the same
 * two-part string, and the parts have to mean the same thing everywhere, because one of
 * those readings decides what is written to `creation_session_objects.resource_id` —
 * the column the unique index resolves a card back to its record by.
 *
 * The rules, in one place:
 *   • a ref is a type and an id separated by the FIRST colon,
 *   • the id may itself contain colons and keeps them,
 *   • both halves must be non-empty, so `"ceremony:"`, `":9f2"` and a bare `"9f2"` are
 *     all "not a ref" rather than half of one.
 *
 * ── WHY IT IS SHARED RATHER THAN A FRONTEND MODULE ──────────────────────────
 * It began in `frontend/src/domains/canvas/domain/`, which left the API writing the
 * same string by hand in four places (session merge, template application, object
 * placement) — the very drift the module exists to end, reintroduced across the
 * package boundary. The board WRITES `creation_session_objects.resource_type` /
 * `resource_id` from one side and RESOLVES cards back from the other, so the format
 * is a contract between them and belongs with the rest of the shared canvas contract.
 */

export interface CanvasResourceRef {
  /** The record's kind — `ceremony`, `task`, `chat`. Never empty. */
  type: string;
  /** The record's own id, colons and all. Never empty. */
  id: string;
}

/** Read a ref, or null when the value is not one. Never throws on a non-string. */
export function parseResourceRef(value: unknown): CanvasResourceRef | null {
  if (typeof value !== 'string') return null;
  const at = value.indexOf(':');
  if (at <= 0) return null;
  const type = value.slice(0, at);
  const id = value.slice(at + 1);
  return id ? { type, id } : null;
}

/**
 * The id this ref carries IF it is of the expected type, else null.
 *
 * The type check is the point: a card whose `resourceId` is `task:4021` must not be read
 * as a ceremony because it happens to hold a ref, and a caller that only wanted the id
 * would otherwise have to remember to check — which is the check that gets forgotten.
 */
export function resourceIdOfType(value: unknown, type: string): string | null {
  const ref = parseResourceRef(value);
  return ref && ref.type === type ? ref.id : null;
}

/**
 * Write a ref, or null when the two halves do not make one.
 *
 * The null case is the point, and it is why this is not an inline template string: a
 * card with no resource has `null` for both halves, and `` `${null}:${null}` `` is the
 * perfectly valid-looking key `"null:null"` — which every card without a resource
 * would then share. That is a set collapsing to one entry, and it is exactly the bug
 * a hand-written `${type}:${id}` invites at each of the sites that used to write one.
 */
export function formatResourceRef(type: unknown, id: unknown): string | null {
  if (typeof type !== 'string' || !type) return null;
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  const value = String(id);
  return value ? `${type}:${value}` : null;
}
