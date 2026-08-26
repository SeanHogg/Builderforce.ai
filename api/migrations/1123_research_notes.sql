-- Customer Discovery — a note toward answering the idea's own question: a
-- competitor teardown, a market stat, a forum thread worth citing. Structurally
-- identical to customer_interviews (1122) and deliberately its own table rather
-- than a `kind` column on it — an interview names a person, a research note
-- names a source; forcing one shape onto both would nullable-column the fields
-- that make each one legible. See schema/discovery.ts.

CREATE TABLE IF NOT EXISTS research_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id  uuid REFERENCES segments(id) ON DELETE CASCADE,
  project_id  integer REFERENCES projects(id) ON DELETE SET NULL,
  title       varchar(255) NOT NULL,
  source_url  varchar(500),
  body        text,
  created_by  varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamp NOT NULL DEFAULT now(),
  updated_at  timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_research_notes_scope
  ON research_notes (tenant_id, segment_id, project_id);
