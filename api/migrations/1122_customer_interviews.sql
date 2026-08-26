-- Customer Discovery — a conversation with a real person, captured against the
-- idea it is evidence for. Distinct from hiring's `interviews` (candidate
-- recruiting, a different bounded context wearing the same word) and from
-- Knowledge's SOP/doc table (versioning + read-ack semantics a raw transcript
-- does not want). See schema/discovery.ts.

CREATE TABLE IF NOT EXISTS customer_interviews (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id       uuid REFERENCES segments(id) ON DELETE CASCADE,
  project_id       integer REFERENCES projects(id) ON DELETE SET NULL,
  title            varchar(255) NOT NULL,
  participant_name varchar(255),
  notes            text,
  created_by       varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamp NOT NULL DEFAULT now(),
  updated_at       timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_interviews_scope
  ON customer_interviews (tenant_id, segment_id, project_id);
