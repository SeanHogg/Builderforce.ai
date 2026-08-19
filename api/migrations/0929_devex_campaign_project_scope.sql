-- 0929 — A DevEx campaign can belong to a PROJECT, so SPACE Satisfaction can stop
-- being a proxy at project grain (ROADMAP AIIMP-2).
--
-- ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
-- `spaceMetrics.ts` scored the S of SPACE — Satisfaction & well-being — from
-- `member_metrics_period.engagement_score`, and its own header admitted the
-- substitution: "DevEx survey data, when present, would override this". It never
-- did. The survey framework (0229) shipped, tenants answered real questions
-- about how the work feels, and the one lens whose whole point is that dimension
-- kept reading a throughput-derived engagement number instead. A team could
-- report falling satisfaction in a survey while SPACE showed it rising, because
-- the two were measuring unrelated things under one name.
--
-- ── WHY A COLUMN AND NOT JUST A LOOKUP ──────────────────────────────────────
-- Wiring the survey in at TENANT grain needed no schema change. Project grain
-- did: `devex_campaigns` was tenant-wide, so a project-scoped SPACE read had no
-- honest answer and `computeSpaceMetrics` left Satisfaction null with a comment
-- saying "until project-grained survey data exists". This is that data. NULL
-- keeps the existing meaning — a workspace-wide campaign — so every existing row
-- and every existing caller is unchanged; a non-null `project_id` narrows a
-- campaign to one project's team, and the project-grained lens reads only those.
--
-- Deliberately NOT inherited by responses: a response belongs to its campaign, so
-- the campaign is the single place the scope is stated (3NF — one fact, one place).

ALTER TABLE devex_campaigns
  ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE;

-- The project-grained lens filters (tenant_id, project_id) and orders by
-- opened_at; the existing tenant index cannot serve the narrowed predicate.
CREATE INDEX IF NOT EXISTS idx_devex_campaigns_project
  ON devex_campaigns (tenant_id, project_id)
  WHERE project_id IS NOT NULL;
