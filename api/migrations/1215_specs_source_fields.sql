-- 1215 · Specs: provenance of an imported GitHub / Linear / Jira ticket.
--
-- Spec import (v1) upserts a spec from an external issue using the project's
-- board_connections credentials. source_* columns record origin; the unique
-- index makes re-import of the same ticket idempotent. Partial so hand-written
-- specs (NULL source) stay unconstrained.

ALTER TABLE specs ADD COLUMN IF NOT EXISTS source_provider VARCHAR(24);
ALTER TABLE specs ADD COLUMN IF NOT EXISTS source_external_id VARCHAR(255);
ALTER TABLE specs ADD COLUMN IF NOT EXISTS source_url VARCHAR(500);

CREATE UNIQUE INDEX IF NOT EXISTS uq_specs_source
  ON specs (tenant_id, source_provider, source_external_id)
  WHERE source_provider IS NOT NULL AND source_external_id IS NOT NULL;
