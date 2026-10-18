/**
 * Which caller-metadata is PERSISTED with a gateway call.
 *
 * `llm_usage_log.metadata` and `llm_traces.caller_metadata` used to store the caller's
 * whole `metadata` bag verbatim — including a guest's raw prompt text
 * (`guestTurnInput`), which is both PII and the bulk of the table's size on the small
 * transactional database. The public gateway DOCUMENTS the caller's own trace-back keys
 * (e.g. `agentRef`, `cloudAgentRef`, `step`, order/job ids) as persisted and returned by
 * `/llm/v1/usage?detail=true` and per-key usage, so this is a DENYLIST with a size cap
 * rather than an allowlist:
 *   • every key starting with `guest` (guestTurnInput, guestTurnId, …) is dropped — those
 *     carry prompt text or session handles, never trace-back ids;
 *   • scalar strings are cut to {@link MAX_SCALAR_CHARS};
 *   • objects/arrays are kept only when their JSON fits {@link MAX_STRUCTURED_CHARS}
 *     (the run loop's `memory` figures do) and dropped otherwise;
 *   • at most {@link MAX_KEYS} keys survive.
 * The bag is still ECHOED back to the caller in the response; only what is stored is
 * narrowed. One function for both stores.
 */

const MAX_KEYS = 32;
const MAX_SCALAR_CHARS = 256;
const MAX_STRUCTURED_CHARS = 1024;

/** Keys never persisted: guest prompt text and turn handles. */
const isDeniedKey = (key: string): boolean => key.startsWith('guest');

/** The bounded, non-denied subset of `metadata`, or null when nothing survives. */
export function pickPersistedMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const out: Record<string, unknown> = {};
  let kept = 0;
  for (const [key, value] of Object.entries(metadata)) {
    if (kept >= MAX_KEYS) break;
    if (value === undefined || value === null || isDeniedKey(key)) continue;
    if (typeof value === 'string') {
      out[key] = value.length > MAX_SCALAR_CHARS ? value.slice(0, MAX_SCALAR_CHARS) : value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    } else if (typeof value === 'object') {
      let json: string | undefined;
      try { json = JSON.stringify(value); } catch { json = undefined; }
      if (json === undefined || json.length > MAX_STRUCTURED_CHARS) continue;
      out[key] = value;
    } else {
      continue;
    }
    kept += 1;
  }
  return kept > 0 ? out : null;
}
