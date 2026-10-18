/**
 * The caller-metadata keys worth PERSISTING with a gateway call.
 *
 * `llm_usage_log.metadata` and `llm_traces.caller_metadata` used to store the caller's
 * whole `metadata` bag verbatim — including a guest's raw prompt text
 * (`guestTurnInput`), which is both PII and the bulk of the table's size on the small
 * transactional database. The bag is still ECHOED back to the caller in the response
 * headers/body; only what is stored is narrowed to the keys something reads back:
 *   • `chatId`, `mode`  — promoted to the `chat_id` / `chat_mode` columns and kept for the
 *     SDK's billing trace-back contract.
 *   • `memory`          — the run loop's per-call compaction/recall figures
 *     (`readMemoryEffect`).
 *   • `taskId`, `projectId` — the work-attribution hints (`usageWorkHints`).
 *   • `premiumSurchargeMillicents` — stamped by the ledger itself.
 * One constant for both stores, so adding a read-back key is a one-line change here.
 */
export const PERSISTED_METADATA_KEYS: ReadonlySet<string> = new Set([
  'chatId',
  'mode',
  'memory',
  'taskId',
  'projectId',
  'premiumSurchargeMillicents',
]);

/** The allowlisted subset of `metadata`, or null when nothing survives. */
export function pickPersistedMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const out: Record<string, unknown> = {};
  for (const key of PERSISTED_METADATA_KEYS) {
    if (metadata[key] !== undefined) out[key] = metadata[key];
  }
  return Object.keys(out).length > 0 ? out : null;
}
