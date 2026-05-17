-- LLM vendor health probes — persists each run of the per-vendor health check
-- so the admin UI can render last-known status and the scheduled() cron handler
-- can diff against the prior run to decide whether to email superadmins.
--
-- One row per (vendor, run). Per-model breakdown lives in `models_json` so we
-- don't need a child table for a workload that's read-mostly and small.

CREATE TABLE IF NOT EXISTS llm_health_probes (
  id            SERIAL PRIMARY KEY,
  vendor        VARCHAR(32)  NOT NULL,
  status        VARCHAR(16)  NOT NULL,           -- 'ok' | 'degraded' | 'down' | 'unconfigured'
  probed_count  INTEGER      NOT NULL DEFAULT 0,
  ok_count      INTEGER      NOT NULL DEFAULT 0,
  failed_count  INTEGER      NOT NULL DEFAULT 0,
  latency_ms    INTEGER      NOT NULL DEFAULT 0, -- max across probed models
  models_json   JSONB        NOT NULL DEFAULT '[]'::jsonb,
  trigger       VARCHAR(16)  NOT NULL,           -- 'manual' | 'cron'
  created_at    TIMESTAMP    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_llm_health_probes_vendor_created
  ON llm_health_probes(vendor, created_at DESC);
