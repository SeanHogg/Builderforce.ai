-- 0360_demo_accounts.sql
-- Sales-cycle demo accounts: seeded persona tenants entered from the marketing
-- shell without signup, refreshed on every deploy (and nightly) so visitor
-- changes never persist. Three pieces:
--   1. tenants.is_demo / tenants.demo_persona — marks a tenant as a reseedable
--      demo workspace; demo_persona is the stable persona key ('ai-team',
--      'insights', 'pmo', 'talent', 'governance'), at most one tenant each.
--   2. demo_events — anonymous funnel telemetry from the marketing/demo shell
--      (demo_start → page views → convert prompt → conversion/exit), keyed by
--      the same visitor_id as marketing_sessions. The activity tracker only
--      fires for signed-in users, so demo funnel needs its own stream.
--   3. sales_leads — "book a demo with sales" capture (the /book-demo page and
--      the demo exit-intent prompt write here).

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS demo_persona varchar(32);

-- One demo tenant per persona; NULLs (every real tenant) are exempt.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_demo_persona
  ON tenants(demo_persona) WHERE demo_persona IS NOT NULL;

CREATE TABLE IF NOT EXISTS demo_events (
  id          bigserial PRIMARY KEY,
  visitor_id  varchar(64) NOT NULL,
  persona     varchar(32),
  kind        varchar(64) NOT NULL,
  path        varchar(300),
  metadata    jsonb,
  occurred_at timestamp NOT NULL DEFAULT now(),
  created_at  timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_demo_events_persona_time ON demo_events(persona, occurred_at);
CREATE INDEX IF NOT EXISTS idx_demo_events_visitor ON demo_events(visitor_id, occurred_at);

CREATE TABLE IF NOT EXISTS sales_leads (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       varchar(200) NOT NULL,
  email      varchar(320) NOT NULL,
  company    varchar(200),
  -- What they want to talk about — a demo persona key or free-form topic.
  interest   varchar(64),
  message    text,
  -- Where the lead came from: 'book-demo-page' | 'demo-exit' | 'demo-convert' | …
  source     varchar(64),
  locale     varchar(5),
  visitor_id varchar(64),
  status     varchar(16) NOT NULL DEFAULT 'new',  -- new | contacted | qualified | closed
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sales_leads_created ON sales_leads(created_at DESC);
