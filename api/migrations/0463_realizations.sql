-- 0463 — One act of making an idea REAL, in one particular way.
--
-- ── WHAT WAS MISSING ────────────────────────────────────────────────────────
-- The challenge pipeline could turn a pasted brief into exactly ONE thing: a
-- working webhook system with a live ingress. That is the most expensive proof
-- there is, and for most of the questions a business actually has to answer it
-- is the wrong one. "Can you show me?" does not need a running system, and
-- "does anyone want this?" is answered by a landing page and a number — while
-- answering it with a built system is how six weeks get spent on something
-- nobody asked for.
--
-- `application/realization/` introduces eight targets (demo video, clickable
-- prototype, smoke test, wizard-of-oz, proof of concept, pilot, phone line,
-- live system). This table records each act.
--
-- ── WHY A TABLE AND NOT A COLUMN ON `challenges` ────────────────────────────
-- An idea has MANY proofs over its life, in sequence, each with its own outcome.
-- A `realization_key` column on `challenges` could hold exactly one, which makes
-- the question the whole feature exists to answer — "what have we already tried,
-- and what did it tell us?" — unanswerable. This is a genuine one-to-many, not a
-- per-feature copy of an existing shape: PRD 20 §3.1 asks that a new KIND be a
-- column value, and `target_key` is exactly that. A ninth proof form is a new
-- adapter and a new value here, never a new table.
--
-- ── WHY challenge_id IS NULLABLE ────────────────────────────────────────────
-- A realization does not require a pasted brief. An idea typed straight into the
-- Realize page has a spec and no challenge row, and refusing to record its proof
-- would be the tail wagging the dog. ON DELETE SET NULL rather than CASCADE for
-- the same reason the challenge pipeline leaves its project alone: tidying away
-- a brief must not delete the record of the proofs that were run against it.
--
-- ── WHY project_id IS NULLABLE ──────────────────────────────────────────────
-- A realization is planned before it is built, and planning writes nothing but
-- this row. The project appears at build time.

CREATE TABLE IF NOT EXISTS realizations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  challenge_id       uuid REFERENCES challenges(id) ON DELETE SET NULL,
  project_id         integer REFERENCES projects(id) ON DELETE SET NULL,
  target_key         varchar(48) NOT NULL,
  title              varchar(255) NOT NULL,
  strategy           varchar(32) NOT NULL DEFAULT 'declarative',
  spec               jsonb NOT NULL DEFAULT '{}'::jsonb,
  plan               jsonb NOT NULL DEFAULT '{}'::jsonb,
  result             jsonb NOT NULL DEFAULT '{}'::jsonb,
  live_url           varchar(500),
  status             varchar(16) NOT NULL DEFAULT 'planned',
  error              text,
  created_by_user_id varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamp NOT NULL DEFAULT NOW(),
  updated_at         timestamp NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN realizations.target_key IS
  'A RealizationKey from application/realization/realizationTarget.ts — demo-video, clickable-prototype, smoke-test, wizard-of-oz, poc, pilot, phone-line, live-system. No CHECK constraint, deliberately: a ninth proof form should land as an adapter, not as a migration.';
COMMENT ON COLUMN realizations.strategy IS
  'Where the backend runs (BackendStrategyKey). Only the live-system target may be anything other than its own default — a smoke test that asked which cloud to deploy into would have missed the point of a smoke test.';
COMMENT ON COLUMN realizations.live_url IS
  'The address a person can open. Null until the proof has been built and its site published.';

-- The three questions asked of this table: what has this workspace tried, what
-- has this idea tried, and what is running in this project.
CREATE INDEX IF NOT EXISTS idx_realizations_tenant_time ON realizations (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_realizations_challenge   ON realizations (challenge_id);
CREATE INDEX IF NOT EXISTS idx_realizations_project     ON realizations (project_id);
