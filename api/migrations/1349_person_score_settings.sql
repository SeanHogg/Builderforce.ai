-- 1349 — PRD 41 WS22 (§D14.6): the tenant human-scoring switch.
--
-- One row per tenant. No row = the plan default: ON for `free`, OFF for every paid
-- tier (the plan enum is free/pro/teams; the paid tiers are the enterprise equivalent
-- the PRD's "enterprise default-off" done-check names). AGENT scoring cannot be
-- disabled — this gates human contributors only, enforced in the person-score route.
-- A tenant admin flips it; `updated_by` records who decided (DPIA accountability).

CREATE TABLE IF NOT EXISTS person_score_settings (
  tenant_id               INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  human_scoring_enabled   BOOLEAN NOT NULL,
  updated_by              VARCHAR(128),
  updated_at              TIMESTAMP NOT NULL DEFAULT NOW()
);
