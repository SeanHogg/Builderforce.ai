-- 1191 · `brain_chat_trace.tenant_id`, for the move of agent-run telemetry to the
-- operational endpoint (transactional-migrations/0013).
--
-- On core the trace inherits its tenant through `chat_id → brain_chats`. On the
-- operational endpoint that key cannot exist (Postgres does not enforce one across Neon
-- projects), so the row carries its tenant itself: the tenant-erasure cascade in
-- `infrastructure/database/siblingCascade.ts` finds it by this column, and the tenancy
-- guard sees a scoped table rather than an orphan.
--
-- Added here as well because both tracks must declare every Drizzle column, and so the
-- core copy carries the value into `scripts/copy-run-telemetry.mjs`. Backfilled from the
-- chat; the core table keeps its foreign keys, since locally (no operational URL bound)
-- core is still the database these tables live in.

ALTER TABLE brain_chat_trace ADD COLUMN IF NOT EXISTS tenant_id integer;

UPDATE brain_chat_trace t
   SET tenant_id = c.tenant_id
  FROM brain_chats c
 WHERE c.id = t.chat_id
   AND t.tenant_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_brain_chat_trace_tenant ON brain_chat_trace (tenant_id);
