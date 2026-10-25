-- 0022 · One usage row per synced client call — mirror of migrations/1275.
-- See that file for why. Expand-only; partial on the sync prefix, so no existing row collides.
CREATE UNIQUE INDEX IF NOT EXISTS uq_llm_usage_log_sync_idempotency
  ON llm_usage_log (tenant_id, idempotency_key)
  WHERE idempotency_key LIKE 'sync-usage:%';
