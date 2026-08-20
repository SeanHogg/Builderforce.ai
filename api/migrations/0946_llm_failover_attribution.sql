-- 0946 — attribution + correlation on `llm_failover_log`.
--
-- ── WHAT WAS MISSING AND WHY IT MATTERED ────────────────────────────────────
-- The table has carried only (model, error_code, created_at) since 0004. That is
-- enough for the per-model rollup the admin page draws and nothing else, and it is
-- why provider auth alerts had to be stored in KV instead of derived from history:
-- there was no tenant on the row, so "which workspace's account got rejected, and
-- when" was not a question the log could answer. A KV-only alert is also not
-- reconstructible — an eviction silently forgets that a tenant's credential is
-- broken, and the next request goes back to leading with the dead account.
--
-- Three columns close it:
--   tenant_id  — WHOSE cascade this was. Nullable: guest/unauthenticated gateway
--                traffic has no tenant, and back-filling one would be a lie.
--   kind       — the coarse failure CLASS the dispatcher already computed
--                (auth | rate_limit | timeout | server_error | embedded | …). The
--                `auth` class is the one alerts are derived from; without it, an
--                expired credential and a saturated free tier are the same row.
--   request_id — per-request correlation. Every attempt in one cascade shares it,
--                so "this request failed over four times" is a GROUP BY rather
--                than a guess from adjacent timestamps.
--
-- ── SCALAR IDS, NO FK ───────────────────────────────────────────────────────
-- `tenant_id` is a bare integer with no REFERENCES clause on purpose. This table
-- is written through `buildTransactionalDatabase`, which targets the separate
-- operational Neon account whenever NEON_TRANSACTIONAL_DATABASE_URL is bound, and
-- PostgreSQL cannot enforce a foreign key across two accounts. The operational
-- baseline (transactional-migrations/0001) already states that rule for every
-- cross-database reference; the primary-track copy matches it so the two schemas
-- stay identical and one Drizzle declaration can describe both.
--
-- TWO TRACKS, DELIBERATELY: the operational twin is
-- transactional-migrations/0006_llm_failover_attribution.sql. Both copies of this
-- table are live (the writer falls back to the primary database when the
-- operational secret is unbound), so a column added to only one of them is absent
-- exactly where the rows land.

ALTER TABLE llm_failover_log ADD COLUMN IF NOT EXISTS tenant_id  INTEGER;
ALTER TABLE llm_failover_log ADD COLUMN IF NOT EXISTS kind       VARCHAR(24);
ALTER TABLE llm_failover_log ADD COLUMN IF NOT EXISTS request_id VARCHAR(64);

-- The alert-derivation read: "recent AUTH-class failovers for this tenant".
-- Partial on `kind = 'auth'` because that is the only class alerts derive from and
-- it is a small fraction of rows — a full index here would be mostly dead weight.
CREATE INDEX IF NOT EXISTS idx_llm_failover_tenant_auth
  ON llm_failover_log (tenant_id, created_at DESC)
  WHERE kind = 'auth' AND tenant_id IS NOT NULL;

-- Cascade reconstruction: every attempt of one request shares a request_id.
CREATE INDEX IF NOT EXISTS idx_llm_failover_request
  ON llm_failover_log (request_id)
  WHERE request_id IS NOT NULL;
