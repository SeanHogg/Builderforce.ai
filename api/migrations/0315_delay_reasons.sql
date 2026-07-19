-- 0315_delay_reasons.sql
-- EMP-9 — Delay root-cause taxonomy.
-- task_status_transitions (0117) records WHEN work stalled (dwell per status) but
-- never WHY. This lookup+attribution table lets a PM tag WHY a task was late from a
-- fixed reason taxonomy, and lets the delayTaxonomy lens blend those manual tags
-- with reasons auto-inferred from long dwell in a blocked/review status.
--
--   reason_code ∈ blocked_dependency | awaiting_review | scope_change |
--                 unclear_requirements | external | capacity | other
--
-- One task can carry at most one manual reason at a time (unique per task); a
-- re-tag upserts. Idempotent / re-runnable.

CREATE TABLE IF NOT EXISTS delay_reasons (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id  UUID REFERENCES segments(id) ON DELETE CASCADE,
  task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  reason_code VARCHAR(24) NOT NULL,                  -- fixed taxonomy (see above)
  notes       TEXT,
  created_by  VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT now(),
  updated_at  TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_delay_reasons_tenant ON delay_reasons(tenant_id, reason_code);
CREATE UNIQUE INDEX IF NOT EXISTS uq_delay_reasons_task ON delay_reasons(task_id);

DROP TRIGGER IF EXISTS trg_delay_reasons_segment ON delay_reasons;
CREATE TRIGGER trg_delay_reasons_segment
  BEFORE INSERT ON delay_reasons
  FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
