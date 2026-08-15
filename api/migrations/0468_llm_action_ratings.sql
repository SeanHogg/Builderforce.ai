-- 0468 — LLM action ratings: the user's verdict, joined to the model that earned it.
--
-- Renumbered from 0465, which had been taken twice in the same working tree (this
-- file and `0465_site_releases_and_site_users.sql`). Neither had been deployed, so
-- the newer of the pair moved into a free slot rather than being allowlisted.
--
-- ── WHAT WAS MISSING ────────────────────────────────────────────────────────
-- The Brain transcript has had thumbs up / down on every assistant reply for a
-- long time, and every press was written into `brain_chat_messages.metadata` as
-- `{"feedback":"up"}` — inside a JSON blob, on the message, with no model, no
-- tool, no action type and no index. It was readable only by opening that one
-- message. So the platform has been collecting the single most direct quality
-- signal it will ever get and has never been able to answer the question the
-- signal exists for: WHICH MODEL IS GOOD AT WHICH KIND OF WORK.
--
-- Meanwhile `run_model_outcomes` (0197/0283/0333) learns exactly that — but only
-- from CLOUD RUNS, scored from merges and CI. Chat and canvas turns, which are
-- the overwhelming majority of model calls and the only ones a human reads word
-- for word, taught it nothing.
--
-- ── WHY A TABLE AND NOT A COLUMN ────────────────────────────────────────────
-- A rating is a fact about (WHO rated, WHAT they rated) — one row per rater per
-- subject, which is precisely a relation and not an attribute of the message.
-- Two people in a shared chat may disagree about the same reply; the message can
-- hold one blob, so one of them was silently overwriting the other. The unique
-- index below makes a re-press an UPDATE of that person's own vote and nothing
-- else, and clearing a vote deletes the row rather than storing a third state.
--
-- ── WHY IT IS NOT `run_model_outcomes` ──────────────────────────────────────
-- That table's grain is a terminal RUN and its score is derived (merge + CI +
-- completion + efficiency). This grain is a HUMAN PRESS on one reply, with no
-- run behind it. Folding a thumb into a run's composite score would corrupt both
-- numbers. The two stay separate facts and are BLENDED at read time by the
-- routing table, weighted by how much evidence each side actually has.
--
-- ── THE CATEGORISATION ──────────────────────────────────────────────────────
-- `action_type` reuses the closed taxonomy the learned router already ranks on
-- (application/llm/actionTypes.ts), so a rating lands in the same bucket a cloud
-- run does and the two are directly comparable. `tool_name` is the finer axis
-- the taxonomy cannot express: WHICH MCP tool the rated turn actually executed
-- (`canvas_add_object`, `roadmap_create_ticket`, …). Nullable, because a turn
-- that only wrote prose executed none — and "it answered badly" is a real,
-- rateable outcome that must not be forced into a tool bucket.
--
-- Additive. No backfill: historical `metadata.feedback` blobs carry no model
-- attribution, so importing them would invent evidence for models that may never
-- have served those turns. Ratings start from the first press after this ships.

CREATE TABLE IF NOT EXISTS llm_action_ratings (
  id                serial PRIMARY KEY,
  tenant_id         integer REFERENCES tenants(id) ON DELETE CASCADE,
  -- WHO pressed it. Part of the uniqueness key so two members of a shared chat
  -- each keep their own vote instead of overwriting one another.
  user_id           varchar(64) NOT NULL,
  project_id        integer REFERENCES projects(id) ON DELETE SET NULL,

  -- WHERE the press happened: 'brain' | 'canvas' | 'vscode' | 'execution'.
  -- Analytics splits by surface because a canvas turn and a coding run are
  -- rated against very different expectations.
  surface           varchar(16) NOT NULL DEFAULT 'brain',
  -- WHAT was rated: 'turn' (an assistant reply) | 'tool' (one tool execution).
  subject_kind      varchar(16) NOT NULL DEFAULT 'turn',
  -- The rated thing's id in ITS OWN surface (a brain message id, a canvas
  -- client message id, a tool-call id). Opaque here on purpose: a foreign key
  -- would have to point at four different tables.
  subject_ref       varchar(128) NOT NULL,

  -- The two axes the summary groups by.
  action_type       varchar(32) NOT NULL DEFAULT 'other',
  tool_name         varchar(120),
  -- The model that actually served the rated turn (the gateway's resolved id,
  -- as persisted on the reply's provenance). This is the whole point: WE always
  -- know which model earned the verdict, even when the user was shown only
  -- "Builderforce Free".
  resolved_model    varchar(200) NOT NULL,
  plan              varchar(16) NOT NULL DEFAULT 'free',

  -- +1 thumbs up, -1 thumbs down. A cleared vote DELETEs the row: "no opinion"
  -- is the absence of a fact, not a third value to filter out of every query.
  rating            smallint NOT NULL,
  -- Optional free text the user attached to a thumbs-down.
  comment           text,
  created_at        timestamp NOT NULL DEFAULT NOW(),
  updated_at        timestamp NOT NULL DEFAULT NOW(),

  CONSTRAINT llm_action_ratings_rating_ck CHECK (rating IN (-1, 1))
);

-- One vote per rater per subject — the upsert target. `tenant_id` is nullable
-- (a rating can outlive its workspace), so NULLS NOT DISTINCT keeps the
-- constraint meaningful for those rows instead of silently allowing duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS uq_llm_action_ratings_subject
  ON llm_action_ratings (tenant_id, subject_kind, subject_ref, user_id) NULLS NOT DISTINCT;

-- The summary query: group by (model, action_type, tool_name) inside a window.
CREATE INDEX IF NOT EXISTS idx_llm_action_ratings_rollup
  ON llm_action_ratings (created_at DESC, resolved_model, action_type);
-- Scope precedence (project → tenant → global) reads the same way the routing
-- table reconcile does.
CREATE INDEX IF NOT EXISTS idx_llm_action_ratings_tenant
  ON llm_action_ratings (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_action_ratings_project
  ON llm_action_ratings (project_id, created_at DESC);
