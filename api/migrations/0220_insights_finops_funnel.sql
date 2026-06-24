-- 0220_insights_finops_funnel.sql
--
-- The role-insight lens layer's two NEW object tiers (everything else the lenses
-- need — run_model_outcomes, deployment_events, llm_usage_log, tool_audit_events —
-- is already collected; the lenses are rollups over them):
--
--   1. budgets        — the FinOps object (LENS #3 / CFO). A spend ceiling per
--                       scope (tenant | project | initiative) per month, so the
--                       finance lens can show budget-vs-actual + burn + overspend
--                       over the already-attributed llm_usage_log ledger.
--   2. innovation_ideas — the innovation-funnel object (LENS #5 / CEO). A tracked
--                       idea→validated→in_build→shipped→measured pipeline so the
--                       funnel lens can show stage conversion + time-to-value, and
--                       links an idea to the project that builds it (cost/outcome).
--
-- Both are tenant + segment scoped (uuid PKs) like the planning trackers, so the
-- generic segmentTrackerRoutes factory drives their CRUD with no bespoke router.
-- Idempotent / re-runnable.

-- ── Budgets (FinOps ceiling) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS budgets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id     UUID REFERENCES segments(id) ON DELETE CASCADE,
  scope_kind     VARCHAR(16) NOT NULL DEFAULT 'tenant',   -- tenant | project | initiative
  project_id     INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  initiative_id  UUID REFERENCES initiatives(id) ON DELETE CASCADE,
  period_month   VARCHAR(7) NOT NULL,                     -- 'YYYY-MM'
  limit_usd      REAL NOT NULL DEFAULT 0,
  notes          TEXT,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_budgets_scope ON budgets(tenant_id, segment_id, period_month);

DROP TRIGGER IF EXISTS trg_budgets_segment ON budgets;
CREATE TRIGGER trg_budgets_segment
  BEFORE INSERT ON budgets
  FOR EACH ROW
  EXECUTE FUNCTION set_default_segment_id();

-- ── Innovation ideas (the funnel pipeline) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS innovation_ideas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id        UUID REFERENCES segments(id) ON DELETE CASCADE,
  initiative_id     UUID REFERENCES initiatives(id) ON DELETE SET NULL,
  title             VARCHAR(255) NOT NULL,
  description       TEXT,
  -- Linear funnel: idea → validated → in_build → shipped → measured; killed = off-ramp.
  stage             VARCHAR(16) NOT NULL DEFAULT 'idea',
  -- The project that builds this idea (set when it enters in_build) — bridges the
  -- funnel to delivery + cost (llm_usage_log.project_id) + outcomes.
  linked_project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  -- RICE-ish scoring inputs (optional) for prioritisation in the funnel UI.
  impact            REAL,
  effort            REAL,
  confidence        REAL,
  -- The "measured" result once shipped (narrative + a metric value).
  outcome           TEXT,
  outcome_value     REAL,
  killed_reason     TEXT,
  -- When the idea ENTERED its current stage — drives funnel aging + time-in-stage.
  -- Maintained by the trigger below so the generic tracker PATCH needn't know it.
  stage_entered_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  notes             TEXT,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_innovation_ideas_scope ON innovation_ideas(tenant_id, segment_id, stage);
CREATE INDEX IF NOT EXISTS idx_innovation_ideas_initiative
  ON innovation_ideas(initiative_id) WHERE initiative_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_innovation_ideas_segment ON innovation_ideas;
CREATE TRIGGER trg_innovation_ideas_segment
  BEFORE INSERT ON innovation_ideas
  FOR EACH ROW
  EXECUTE FUNCTION set_default_segment_id();

-- Stamp stage_entered_at whenever the stage actually changes, so the funnel's
-- time-in-stage / aging is correct without the generic tracker PATCH knowing about it.
CREATE OR REPLACE FUNCTION set_idea_stage_entered_at()
  RETURNS TRIGGER AS $$
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    NEW.stage_entered_at := NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_innovation_ideas_stage ON innovation_ideas;
CREATE TRIGGER trg_innovation_ideas_stage
  BEFORE UPDATE ON innovation_ideas
  FOR EACH ROW
  EXECUTE FUNCTION set_idea_stage_entered_at();
