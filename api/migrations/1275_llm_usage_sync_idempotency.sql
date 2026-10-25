-- 1275 · One usage row per synced client call (PRD 36.4). Mirror: transactional-migrations/0022.
--
-- A device's offline usage reaches the ledger through the sync push, keyed
-- `sync-usage:<clientEventId>`. The push's unit of work commits to a different database
-- from this table (`resolveUsageDatabase`), so a retried push after a rolled-back receipt
-- re-sends a row that is already written. This index makes the second write a no-op
-- (`ON CONFLICT DO NOTHING` restating the predicate) instead of a duplicate charge.
--
-- Expand-only. Partial on the sync prefix, so no existing row can collide: the prefix is
-- reserved — the one usage writer stores it only for the sync importer and drops it from a
-- gateway caller's client-chosen key (`usageLedger.ts` `storedIdempotencyKey`), and both
-- ship with this migration. Not CONCURRENTLY (the runner's convention): the build takes a
-- SHARE lock on `llm_usage_log` for one scan, so usage writes wait for it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_llm_usage_log_sync_idempotency
  ON llm_usage_log (tenant_id, idempotency_key)
  WHERE idempotency_key LIKE 'sync-usage:%';
