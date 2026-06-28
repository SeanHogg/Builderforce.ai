-- 0254_finops_soc_controls_rename.sql
-- Fix a TABLE-NAME COLLISION between two unrelated subsystems.
--
-- Migration 0057 (Governance & Security, doc 07) created `soc_controls` for the
-- SOC 2 Common-Criteria control tracker (UUID id, name/requirement/owner_id,
-- segment-scoped) and it has been live since. Migration 0233 (DevFinOps) then
-- tried to `CREATE TABLE IF NOT EXISTS soc_controls` for a SEPARATE SOC 1 Type II
-- register (serial id, objective/note/last_reviewed). Because the table already
-- existed, 0233's CREATE was a NO-OP — the SOC 1 columns (objective, owner, note,
-- last_reviewed) were never created. Every finops query then failed with
-- `column "objective" does not exist`, 500-ing GET /api/finops/audit-report and
-- the whole /insights/finance audit surface.
--
-- 0233 ALSO partially applied: its `CREATE [UNIQUE] INDEX IF NOT EXISTS` for
-- idx_soc_controls_tenant / uq_soc_controls_ref DID run (the governance table has
-- tenant_id + control_ref), leaving two stray indexes on the governance table.
--
-- Fix: give the DevFinOps SOC 1 register its own table, `finops_soc_controls`,
-- and remove the stray indexes 0233 added to the governance table. The finops
-- register had no real data (every write also 500'd), so nothing to migrate.
-- Idempotent.

-- ── DevFinOps SOC 1 Type II register (own table, no collision) ────────────────
CREATE TABLE IF NOT EXISTS finops_soc_controls (
  id            SERIAL PRIMARY KEY,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  control_ref   VARCHAR(32)  NOT NULL,
  objective     VARCHAR(240) NOT NULL,
  category      VARCHAR(48)  NOT NULL DEFAULT 'general',
  status        VARCHAR(16)  NOT NULL DEFAULT 'gap',  -- implemented | partial | gap
  owner         VARCHAR(120),
  note          TEXT DEFAULT '',
  last_reviewed TIMESTAMP,
  created_at    TIMESTAMP NOT NULL DEFAULT now(),
  updated_at    TIMESTAMP NOT NULL DEFAULT now()
);
-- New index names: Postgres index names are schema-global, and the originals were
-- consumed by 0233's partial apply against the governance table.
CREATE INDEX IF NOT EXISTS idx_finops_soc_controls_tenant ON finops_soc_controls(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_finops_soc_controls_ref ON finops_soc_controls(tenant_id, control_ref);

-- ── Undo 0233's drift on the governance `soc_controls` table ──────────────────
-- These indexes were never intended for the SOC 2 governance table; the unique
-- one would also impose an unintended (tenant_id, control_ref) constraint there.
DROP INDEX IF EXISTS uq_soc_controls_ref;
DROP INDEX IF EXISTS idx_soc_controls_tenant;
