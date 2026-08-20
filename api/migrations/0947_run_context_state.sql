-- 0947 — `run_context_state`: what a run has already been TOLD.
--
-- ── THE PROBLEM ─────────────────────────────────────────────────────────────
-- Context was assembled three times (cloud `prepareCloudRun`, on-prem
-- `buildEmbeddedSystemPrompt`, VS Code `buildSystemMessages`) and, in all three,
-- assembled WHOLE every time. A PRD that had not changed between two runs was
-- re-sent verbatim and paid for again; a PRD that HAD changed arrived as a second
-- competing statement next to the first, with nothing to say which one held. That
-- is precisely the append-forever failure Evermind's Write-Through Cognition
-- exists to prevent — it just had no store on this path to prevent it in.
--
-- ── WHAT THIS TABLE IS ──────────────────────────────────────────────────────
-- The fact store behind `EvermindCognition` for run context. One row = the current
-- belief a run holds about ONE context block.
--
--   scope        the continuity key the delta is computed against:
--                `task:<id>`    — a cloud run (so a RE-RUN of the ticket reconciles
--                                 against what the previous run was told),
--                `session:<key>`— an on-prem embedded-runner session,
--                `chat:<id>`    — a VS Code conversation.
--   subject_key  the canonical Evermind subject key
--                (`runctx:<scope>:<kind>:<subject>`), already NFC + case-folded by
--                `canonicalizeSubjectKey` before it arrives.
--   content      the block body carrying the reconciler's provenance header
--                (`<!-- runctx tier=… -->`), which is what lets the evidence rule
--                refuse a LOWER-trust source overwriting a higher-trust belief.
--
-- ── WHY THE UNIQUE INDEX IS THE POINT ───────────────────────────────────────
-- Single-incumbent is the whole guarantee: two rows for one subject means two live
-- beliefs and the drift is back. Uniqueness on (tenant_id, scope, subject_key) is
-- also the upsert target, so "update == replace" is enforced by the database rather
-- than by every caller remembering to delete first.
--
-- ── SCALAR tenant_id, NO FK ─────────────────────────────────────────────────
-- Matches the convention the rest of `schema/agents.ts` uses for runtime tables
-- that may be written through the operational database: a foreign key cannot be
-- enforced across two Neon accounts, so the reference is a bare integer and tenant
-- scoping is enforced in the application's query layer (every read and write here
-- is `tenant_id`-filtered).

CREATE TABLE IF NOT EXISTS run_context_state (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   INTEGER      NOT NULL,
  scope       VARCHAR(160) NOT NULL,
  subject_key VARCHAR(512) NOT NULL,
  content     TEXT         NOT NULL,
  importance  REAL         NOT NULL DEFAULT 0.6,
  created_at  TIMESTAMP    NOT NULL DEFAULT now(),
  updated_at  TIMESTAMP    NOT NULL DEFAULT now()
);

-- The single-incumbent guarantee AND the upsert target.
CREATE UNIQUE INDEX IF NOT EXISTS uq_run_context_state_subject
  ON run_context_state (tenant_id, scope, subject_key);

-- Scope sweeps: "what does this run already know", and the age-out of finished scopes.
CREATE INDEX IF NOT EXISTS idx_run_context_state_scope
  ON run_context_state (tenant_id, scope, updated_at);
