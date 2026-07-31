-- 0279_marketing_sessions.sql
-- Anonymous marketing sessions for the free Diagnostics & Tools suite.
--
-- Every logged-out visitor who runs a free tool is a marketing lead: we track the
-- session by a client-generated stable `visitor_id` (localStorage + cookie), keep
-- a running count of tool runs and first-touch attribution, and STORE the latest
-- result per (visitor, tool) so a returning visitor can see their diagnostics
-- again — and so we can target them with a sign-up. When they create an account
-- the session is stamped converted (attribution close-out).
--
-- Idempotent / re-runnable: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS marketing_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable, client-generated visitor id (not tied to any tenant — this is a lead).
  visitor_id         varchar(64) NOT NULL,
  tool_runs          integer NOT NULL DEFAULT 0,
  last_tool_id       varchar(64),
  -- First-touch attribution (captured once, on the first tracked event).
  landing_path       text,
  referrer           text,
  user_agent         text,
  utm                jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Funnel close-out: set when the visitor creates/links an account.
  converted          boolean NOT NULL DEFAULT false,
  converted_user_id  varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  converted_at       timestamp,
  first_seen_at      timestamp NOT NULL DEFAULT now(),
  last_seen_at       timestamp NOT NULL DEFAULT now(),
  CONSTRAINT uq_marketing_sessions_visitor UNIQUE (visitor_id)
);

CREATE INDEX IF NOT EXISTS idx_marketing_sessions_last_seen ON marketing_sessions (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_sessions_converted ON marketing_sessions (converted, last_seen_at DESC);

-- Latest result per (visitor, tool): upserted on every anonymous run so the store
-- stays bounded and a returning visitor sees their most-recent diagnostic.
CREATE TABLE IF NOT EXISTS marketing_tool_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id   varchar(64) NOT NULL,
  tool_id      varchar(64) NOT NULL,
  input        jsonb NOT NULL DEFAULT '{}'::jsonb,
  result       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamp NOT NULL DEFAULT now(),
  updated_at   timestamp NOT NULL DEFAULT now(),
  CONSTRAINT uq_marketing_tool_runs UNIQUE (visitor_id, tool_id)
);

CREATE INDEX IF NOT EXISTS idx_marketing_tool_runs_visitor ON marketing_tool_runs (visitor_id, updated_at DESC);
