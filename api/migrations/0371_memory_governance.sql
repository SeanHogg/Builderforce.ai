-- 0371 — Memory governance: scope, provenance and TTL on every remembered fact.
--
-- WHY THIS EXISTS
--
-- Agent memory was real but ungoverned. `agent_memory` is tenant-wide and
-- `project_facts` is project-wide, and `buildCloudMemoryCapability` picked between
-- them purely on whether the run had a projectId. Three invariants had no owner:
--
--   1. SCOPE / ISOLATION. A run with no project wrote to the tenant-wide store, and
--      every later run — on any project — recalled it. There was no way to record a
--      fact that is true only of ONE ticket, and no boundary that stopped a belief
--      formed in project A from being recalled during a run on project B. Contamination
--      was the default, not an accident.
--
--   2. PROVENANCE. `agent_memory` recorded no origin at all. A recalled line was
--      indistinguishable whether a human wrote it, an agent inferred it from a file it
--      misread, or it arrived through ingestion. `project_facts.source` was the only
--      half-measure, and it carried no run reference.
--
--   3. EXPIRY. Nothing lapsed. "We are mid-migration to X" stays in the context window
--      of every run forever, including the runs after the migration finished — an
--      accumulating, silently-wrong prompt prefix.
--
-- WHICH STORE HOLDS WHAT (unchanged where it matters):
--   `project_facts` REMAINS the shared per-project store that VS Code, the web Brain,
--   the cloud loop and on-prem all read — that cross-surface contract is load-bearing,
--   so project scope keeps living there and only gains provenance + TTL.
--   `agent_memory` becomes the general SCOPED store for everything else: tenant-wide
--   facts (as today) and the new ticket-local scope. One service
--   (application/memory/memoryService.ts) owns both and enforces one contract, so no
--   caller picks a table or invents its own rules again.
--
--   • scope_kind / scope_id — 'tenant' | 'project' | 'ticket' plus the concrete owner
--     (0 for tenant). Recall walks the chain from the run's own scope OUTWARD
--     (ticket → project → tenant) and never sideways, so one project's beliefs are
--     invisible to every other project by construction, not by remembering a predicate.
--   • origin / origin_execution_id — who formed the belief, and in which run.
--   • expires_at — NULL = durable. Recall filters expired rows out; the retention
--     sweep deletes them.
--
-- Backfill is conservative: every existing agent_memory row keeps tenant scope (that IS
-- what it was) and every project_facts row stays project-wide. No fact changes
-- visibility, and no existing reader changes behaviour.

-- ── agent_memory ────────────────────────────────────────────────────────────────
-- scope_id is NOT NULL DEFAULT 0 rather than nullable so the uniqueness index stays a
-- PLAIN column tuple: a partial/expression index (COALESCE(...)) cannot be named as an
-- upsert target by the query builder, and `remember` is an upsert.
ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS scope_kind VARCHAR(16) NOT NULL DEFAULT 'tenant';
ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS scope_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS origin VARCHAR(64) NOT NULL DEFAULT 'agent';
ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS origin_execution_id INTEGER;
ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;

-- The (tenant_id, key) uniqueness `remember` upserts on must widen to include the
-- scope: the SAME key may legitimately hold a different value for one ticket than for
-- the workspace, and merging them would let a ticket-local note silently overwrite a
-- workspace-wide convention. Created by 0200 as a unique INDEX.
DROP INDEX IF EXISTS agent_memory_tenant_key_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS agent_memory_scope_key_uq
  ON agent_memory (tenant_id, scope_kind, scope_id, key);

-- Recall reads by (tenant, scope) and orders by importance — cover it.
CREATE INDEX IF NOT EXISTS agent_memory_scope_idx
  ON agent_memory (tenant_id, scope_kind, scope_id, importance DESC);

-- The TTL sweep scans only rows that HAVE an expiry.
CREATE INDEX IF NOT EXISTS agent_memory_expiry_idx
  ON agent_memory (expires_at)
  WHERE expires_at IS NOT NULL;

-- ── project_facts ───────────────────────────────────────────────────────────────
-- `source` already carries a coarse origin; add the run reference and the TTL so the
-- shared project store honours the SAME contract as the scoped store. Its
-- `uq_project_facts (tenant_id, project_id, key)` constraint is unchanged — project
-- facts stay one-per-key-per-project, which is exactly what every existing surface
-- that reads them assumes.
ALTER TABLE project_facts ADD COLUMN IF NOT EXISTS origin_execution_id INTEGER;
ALTER TABLE project_facts ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS project_facts_expiry_idx
  ON project_facts (expires_at)
  WHERE expires_at IS NOT NULL;
