-- Agentic Workforce Kanban — role taxonomy + kanban templates + per-lane requirements.
--
-- The vision: let a small team punch above its weight by staffing a deep role
-- roster with a MIX of humans and AI agents, on a best-practice kanban whose lanes
-- declare which ROLES are responsible and which DIAGNOSTICS/REVIEWS must have run
-- before a ticket advances. One primitive — a KanbanTemplate that binds
-- {roles, required checks, gate} to each lane — powers: the built-in Standard SWE
-- board, custom autonomous kanbans, the onboarding "recommended roster" (= the
-- union of roles the template references), per-ticket role/diagnostic auditing, and
-- swimlane round-trip gating. Templates are also marketplace-listable/sellable.
--
-- Built-in job roles and built-in templates live as TS constants (the source of
-- truth — mirrors BUILTIN_PERSONAS / DEFAULT_SWIMLANES / tenant_id=0 deck builtins).
-- These tables store ONLY tenant-created custom roles and tenant-created / forked /
-- published templates. The services merge builtins + DB rows on read.

-- 1) Custom job-function roles (Architect / Developer / QA / …). Canonical set is
--    in code; this table is the tenant-extensible tail. `key` is a slug unique per
--    tenant; it never collides with a built-in key (validated in the service).
CREATE TABLE IF NOT EXISTS job_roles (
  id            varchar(36) PRIMARY KEY,
  tenant_id     integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key           varchar(60)  NOT NULL,            -- slug, e.g. 'release-manager'
  name          varchar(120) NOT NULL,
  description   text,
  discipline    varchar(60)  NOT NULL DEFAULT 'engineering', -- engineering|product|design|qa|devops|data|security|other
  color         varchar(24),                      -- theme-token name or hex for the chip
  icon          varchar(16),                      -- emoji glyph
  position      integer NOT NULL DEFAULT 0,
  created_at    timestamp NOT NULL DEFAULT now(),
  updated_at    timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_roles_tenant_key ON job_roles(tenant_id, key);

-- 2) Kanban templates: a reusable, shareable, sellable board definition. tenant_id
--    is set for tenant-owned templates; built-ins are served from code (not stored).
--    Marketplace columns mirror the established publish/visibility/price pattern
--    (marketplace_personas / marketplace_knowledge / ide_agents).
CREATE TABLE IF NOT EXISTS kanban_templates (
  id             varchar(36) PRIMARY KEY,
  tenant_id      integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug           varchar(120) NOT NULL,
  name           varchar(160) NOT NULL,
  description    text,
  category       varchar(60)  NOT NULL DEFAULT 'software',  -- team-type: software|design|marketing|support|ops|custom
  team_type      varchar(80),                               -- freeform e.g. "Platform squad"
  -- Fork lineage: the built-in slug or template id this was cloned from (null = authored fresh).
  parent_template_id varchar(120),
  author_id      varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  -- Marketplace / sharing
  published      boolean     NOT NULL DEFAULT false,
  visibility     varchar(10) NOT NULL DEFAULT 'private',     -- private | tenant | public
  price_cents    integer,
  pricing_model  varchar(20),                                -- flat_fee | consumption | null(free)
  price_unit     varchar(40),
  install_count  integer NOT NULL DEFAULT 0,
  version        integer NOT NULL DEFAULT 1,
  created_at     timestamp NOT NULL DEFAULT now(),
  updated_at     timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_kanban_templates_tenant_slug ON kanban_templates(tenant_id, slug);
-- Globally-unique public slug (mirrors marketplace_personas partial unique index).
CREATE UNIQUE INDEX IF NOT EXISTS uq_kanban_templates_public_slug
  ON kanban_templates(slug) WHERE visibility = 'public';
CREATE INDEX IF NOT EXISTS idx_kanban_templates_public
  ON kanban_templates(published) WHERE published = true AND visibility = 'public';

-- 3) Lanes within a template.
CREATE TABLE IF NOT EXISTS kanban_template_lanes (
  id                varchar(36) PRIMARY KEY,
  template_id       varchar(36) NOT NULL REFERENCES kanban_templates(id) ON DELETE CASCADE,
  key               varchar(120) NOT NULL,   -- maps to tasks.status when applied
  name              varchar(255) NOT NULL,
  position          integer NOT NULL DEFAULT 0,
  is_terminal       boolean NOT NULL DEFAULT false,
  gate              varchar(16) NOT NULL DEFAULT 'auto',   -- auto | human
  -- How strictly the lane's required checks gate entry (migration-of-vision pillar 2):
  --   off  = record coverage only (audit), never block or round-trip
  --   soft = allow the move but FLAG + dispatch the responsible reviewer (default)
  --   hard = block the auto-advance until required checks are satisfied
  requirement_gate  varchar(8) NOT NULL DEFAULT 'soft',
  created_at        timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_template_lane_key ON kanban_template_lanes(template_id, key);

-- 4) Per-lane requirements: the roles responsible AND the checks (role sign-off /
--    diagnostic) that must have run on a ticket for this lane. One flexible row per
--    requirement (DRY — a single kind-discriminated shape covers roles+checks).
CREATE TABLE IF NOT EXISTS kanban_template_lane_requirements (
  id             varchar(36) PRIMARY KEY,
  lane_id        varchar(36) NOT NULL REFERENCES kanban_template_lanes(id) ON DELETE CASCADE,
  kind           varchar(16) NOT NULL,     -- 'role' | 'diagnostic' | 'review'
  ref            varchar(120) NOT NULL,    -- role key (role/review) | diagnostic tool id (diagnostic)
  responsibility varchar(16),              -- for kind='role'/'review': owner | reviewer | contributor
  is_required    boolean NOT NULL DEFAULT true,
  description    text,
  position       integer NOT NULL DEFAULT 0,
  created_at     timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_template_lane_reqs_lane ON kanban_template_lane_requirements(lane_id);

-- 5) LIVE per-lane requirements, materialised onto a project's board swimlanes when
--    a template is applied (and directly editable in the board config panel). This
--    keeps the running board self-describing for audit + gating regardless of which
--    template (or none) it came from.
CREATE TABLE IF NOT EXISTS swimlane_requirements (
  id             varchar(36) PRIMARY KEY,
  tenant_id      integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  swimlane_id    uuid NOT NULL REFERENCES swimlanes(id) ON DELETE CASCADE,
  kind           varchar(16) NOT NULL,     -- 'role' | 'diagnostic' | 'review'
  ref            varchar(120) NOT NULL,
  responsibility varchar(16),
  is_required    boolean NOT NULL DEFAULT true,
  description    text,
  position       integer NOT NULL DEFAULT 0,
  created_at     timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_swimlane_reqs_lane ON swimlane_requirements(swimlane_id);

-- 6) Per-lane gate strictness on the LIVE board (mirrors template.requirement_gate).
ALTER TABLE swimlanes ADD COLUMN IF NOT EXISTS requirement_gate varchar(8) NOT NULL DEFAULT 'soft';

-- 7) Which template a project's board was provisioned from, and the project setting
--    that selects it (built-in slug like 'standard-swe' OR a kanban_templates.id).
ALTER TABLE boards   ADD COLUMN IF NOT EXISTS template_id varchar(120);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS kanban_template_id varchar(120);
