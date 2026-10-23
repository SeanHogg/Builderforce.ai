-- 0020 · Deferred LLM work queue (PRD D6 — provider batch APIs). Mirror: migrations/1255.
--
-- WHY THIS TRACK. A deferred call is enqueued, submitted, polled and settled at the same
-- moments its usage row is written to `llm_usage_log`, which lives here. Tables are
-- grouped by WHEN they are written (see 0013), so the queue sits beside the ledger it is
-- metered into. The primary copy (1255) exists only for the unsplit fallback: when
-- NEON_TRANSACTIONAL_DATABASE_URL is unbound, `siblingDatabaseOf(core, 'operational')`
-- resolves to the core handle and the table must exist there too.
--
-- Core entities (tenant, project, task) are plain scalar ids — no foreign keys across
-- endpoints. `request` holds the prompt text only while the job is open; settling a job
-- clears it, so a finished row keeps its provenance and none of the content.

CREATE TABLE IF NOT EXISTS llm_batch_jobs (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL,
  project_id integer,
  task_id integer,
  use_case varchar(64) NOT NULL,
  callback_kind varchar(48) NOT NULL,
  callback_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  vendor varchar(32) NOT NULL,
  model varchar(200) NOT NULL,
  funding varchar(16) NOT NULL,
  request jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(16) NOT NULL DEFAULT 'queued',
  provider_batch_id varchar(128),
  attempts integer NOT NULL DEFAULT 0,
  fallback_reason varchar(64),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- The tick's two scans: open jobs oldest-first (claim + SLA), and one provider batch's jobs.
CREATE INDEX IF NOT EXISTS idx_llm_batch_jobs_open ON llm_batch_jobs (status, created_at)
  WHERE status IN ('queued', 'submitting', 'submitted');
CREATE INDEX IF NOT EXISTS idx_llm_batch_jobs_provider_batch ON llm_batch_jobs (provider_batch_id)
  WHERE provider_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_llm_batch_jobs_tenant ON llm_batch_jobs (tenant_id, created_at DESC);
