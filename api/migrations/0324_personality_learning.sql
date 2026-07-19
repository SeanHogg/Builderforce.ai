-- 0324_personality_learning.sql
-- Personality LEARNING + TRACKING (Gaps 6 & 7).
--
-- Today only the limbic affect-DYNAMICS model trains; the STATIC psychometric trait
-- vector is recomputed from the human-authored DB every run and is never reinforced
-- from run outcomes, and personality USAGE is not tracked anywhere the user can see.
-- These two additive tables close both:
--
--   • personality_events   — one row each time a personality/persona is applied to a
--                            run (agent, tenant, run/session, profile source, a short
--                            directives summary, exec levers). The durable spine the
--                            /api/personality events endpoint + PersonalityUsagePanel
--                            read so a user can see WHICH personality was used, WHEN.
--
--   • trait_reinforcements — proposed + applied/dismissed reinforcement deltas with
--                            full provenance (the vector before/after, the sample of
--                            runs it was computed from, who decided). Reinforcement
--                            never auto-mutates the vector silently: proposeTraitReinf-
--                            orcement() PROPOSES, an approve (human/manager or an
--                            explicit auto-apply flag) commits by writing the new
--                            vector to ide_agents.psychometric — and this table keeps
--                            every step reversible + auditable.
--
-- Additive + idempotent (CREATE TABLE / INDEX IF NOT EXISTS), following 0197/0323.

-- ── personality_events: which personality was applied to a run ──────────────────
CREATE TABLE IF NOT EXISTS personality_events (
  id                 SERIAL PRIMARY KEY,
  tenant_id          INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  -- The agent whose personality was applied. Matches ide_agents.id (VARCHAR(64)),
  -- which is also what run_model_outcomes.cloud_agent_ref carries.
  agent_ref          VARCHAR(64)  NOT NULL,
  -- The run this scores. execution_id for cloud runs; run_id/session_key for the
  -- on-prem embedded runner (which has no cloud execution row). All nullable so any
  -- surface can record what it has.
  execution_id       INTEGER,
  run_id             VARCHAR(128),
  session_key        VARCHAR(255),
  -- Where the applied profile came from: 'agent' (ide_agents.psychometric), 'persona'
  -- (an assigned persona), 'blended' (several), or a raw profile source. Free-form
  -- VARCHAR so a new source never needs a migration.
  profile_source     VARCHAR(24)  NOT NULL DEFAULT 'agent',
  -- JSON string[] of the persona/agent names applied (for a multi-persona blend).
  persona_ids        TEXT,
  -- A short, human-readable summary of the compiled directives that were injected.
  directives_summary TEXT,
  directive_count    INTEGER      NOT NULL DEFAULT 0,
  -- The execution levers the personality resolved to (for the "what did it change?"
  -- readout). All nullable — a neutral profile moves none of them.
  think_level        VARCHAR(16),
  reasoning_level    VARCHAR(8),
  temperature        REAL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Panel read: the most-recent applications for one agent in a tenant.
CREATE INDEX IF NOT EXISTS personality_events_agent_idx
  ON personality_events (tenant_id, agent_ref, created_at DESC);

-- ── trait_reinforcements: proposed/applied outcome-driven nudges (reversible) ────
CREATE TABLE IF NOT EXISTS trait_reinforcements (
  id                 SERIAL PRIMARY KEY,
  tenant_id          INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  agent_ref          VARCHAR(64)  NOT NULL,
  -- 'proposed' (computed, awaiting a decision), 'applied' (committed to the vector),
  -- or 'dismissed' (rejected — kept for audit + to suppress re-proposing the same).
  status             VARCHAR(16)  NOT NULL DEFAULT 'proposed',
  -- JSON Record<dimensionId, number> — the bounded per-dimension nudges (±cap).
  deltas             TEXT         NOT NULL,
  -- JSON string[] — the human-readable reason for each nudge (observability).
  rationale          TEXT,
  -- Provenance: how many terminal runs (and over how many days) the proposal read.
  based_on_runs      INTEGER      NOT NULL DEFAULT 0,
  window_days        INTEGER      NOT NULL DEFAULT 0,
  -- Reversibility: the exact vector before the change, and after (null until applied).
  vector_before      TEXT,
  vector_after       TEXT,
  auto_applied       BOOLEAN      NOT NULL DEFAULT FALSE,
  proposed_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  decided_at         TIMESTAMPTZ,
  -- The user id who approved/dismissed (null for an auto-apply).
  decided_by         VARCHAR(128)
);

-- Suggestion read + weekly-cap accounting (sum of applied deltas in a window).
CREATE INDEX IF NOT EXISTS trait_reinforcements_agent_idx
  ON trait_reinforcements (tenant_id, agent_ref, status, proposed_at DESC);
