-- 0363 — Tiered manager autonomy: workspace-level defaults + merge authority as its
--        own control.
--
-- TWO problems, one migration.
--
-- (1) THE POLICY HAD ONLY ONE TIER. `project_manager_configs` is per-project, so an
--     operator who wanted "the AI Manager may groom but never merge" had to set it
--     project by project, and every NEW project silently started from the hardcoded
--     defaults in `application/manager/managerPolicy.ts`. There was nowhere to say
--     "this is how the manager behaves across this workspace". `tenant_manager_defaults`
--     is that missing tier: ONE row per tenant, sitting between the hardcoded default
--     and the per-project row.
--
--     Every column is NULLABLE on purpose. NULL means "this workspace expresses no
--     opinion — use the hardcoded default", which is what makes the fold a genuine
--     three-level override rather than a second copy of the defaults. See
--     `resolveTieredManagerPolicy`, the single pure resolver both tiers go through.
--
-- (2) MERGE AUTHORITY WAS IMPLIED, NEVER GRANTED. Whether the manager could merge was
--     read off `pr_merge_policy != 'queue'` — a field that answers "HOW should a merge
--     happen" (immediately / once CI is green) being overloaded to answer "MAY you merge
--     at all". The two are different questions and the default answer to the second one
--     was yes: a fresh project with no config row squash-merged agent PRs autonomously.
--     `allow_auto_merge` splits them apart and DEFAULTS TO NOT GRANTED at every tier:
--       • tenant column NULL      → no workspace-wide grant
--       • project column NULL     → inherit the workspace tier
--       • nothing set anywhere    → false (the hardcoded default)
--     This is a deliberate behaviour change. Write authority to someone else's default
--     branch is the most consequential thing the manager does, so it must be granted on
--     purpose and be visible in the config that granted it — not inherited by omission.
--     A blocked-but-otherwise-ready PR is journalled to `manager_actions`
--     ('merge_blocked'), so withheld authority reads as a decision, never a silent skip.
--
-- Pairs with 0362 (`require_signoff_to_complete`): sign-off asks "has the work been
-- reviewed", merge authority asks "may the manager act on that review unattended".
-- BOTH must pass before `coordinatePullRequests` merges anything.

-- ── (1) the workspace (tenant) tier ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_manager_defaults (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   integer     NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Every policy column is nullable: NULL = "not set at this tier", inherit downward.
  -- `enabled` and `allow_auto_merge` are CEILINGS (an explicit false cannot be
  -- re-granted by a project row); `require_signoff_to_complete` is a FLOOR (an explicit
  -- true cannot be relaxed by a project row). The rest are plain overrides that the
  -- project tier wins. The rule lives in ONE place: resolveTieredManagerPolicy().
  enabled                     boolean,
  pr_merge_policy             varchar(12),
  auto_assign                 boolean,
  auto_business_value         boolean,
  auto_prioritize             boolean,
  require_signoff_to_complete boolean,
  allow_auto_merge            boolean,
  -- Who last changed the workspace autonomy posture (governance question: "who granted
  -- the manager merge rights?"). Nullable — a system/migration write has no author.
  updated_by                  varchar(36),
  created_at                  timestamp   NOT NULL DEFAULT now(),
  updated_at                  timestamp   NOT NULL DEFAULT now()
);

-- One defaults row per tenant. Enforced as a unique index (not just the PK) because the
-- upsert targets tenant_id via ON CONFLICT and needs an index to conflict against.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_manager_defaults_tenant
  ON tenant_manager_defaults(tenant_id);

COMMENT ON TABLE tenant_manager_defaults IS
  'Workspace-wide AI Manager autonomy defaults — the tier between the hardcoded defaults in managerPolicy.ts and a per-project project_manager_configs row. NULL in any policy column means "not set at this tier", so the fold is a real three-level override.';

COMMENT ON COLUMN tenant_manager_defaults.enabled IS
  'Workspace kill-switch. NULL = no opinion; false = the manager is off across the workspace and a project row CANNOT re-enable it (a ceiling — otherwise the pre-existing project rows, whose enabled column is NOT NULL DEFAULT true, would silently defeat it).';

COMMENT ON COLUMN tenant_manager_defaults.allow_auto_merge IS
  'Workspace grant of autonomous merge authority. NULL = no grant; false = no project may merge autonomously (a ceiling); true = projects may, unless their own row says false.';

COMMENT ON COLUMN tenant_manager_defaults.require_signoff_to_complete IS
  'Workspace sign-off floor. NULL = no opinion; true = every project must have unanimous role sign-off before autonomous completion/merge and a project row cannot opt out.';

-- ── (2) merge authority on the per-project tier ─────────────────────────────
-- NULLABLE (unlike the 0265/0362 project columns, which are NOT NULL DEFAULT): null is
-- the meaningful "inherit the workspace tier" state. A project that has never had an
-- opinion about merge authority must not be pinned to one by the ADD COLUMN default.
ALTER TABLE project_manager_configs
  ADD COLUMN IF NOT EXISTS allow_auto_merge boolean;

COMMENT ON COLUMN project_manager_configs.allow_auto_merge IS
  'Whether the AI Manager may merge this project''s PRs unattended — separate from pr_merge_policy, which only says HOW a permitted merge happens. NULL = inherit tenant_manager_defaults, which itself falls back to the hardcoded default of false. Both this and require_signoff_to_complete must pass before coordinatePullRequests merges.';
