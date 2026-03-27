-- Migration: Granular permissions, custom roles, modules, and user permission overrides
-- Phase 3 & 4 of PRD: Permission Schema, Custom Roles, Modules

-- ---------------------------------------------------------------------------
-- 1. role_permission_overrides
--    Stores deviations from the hardcoded default permission matrix.
--    granted=true means explicitly added; granted=false means explicitly removed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS role_permission_overrides (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  role        varchar(32)  NOT NULL,
  permission  varchar(128) NOT NULL,
  granted     boolean      NOT NULL,
  reason      text,
  created_by  varchar(36)  NOT NULL REFERENCES users(id),
  created_at  timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (role, permission)
);

CREATE INDEX IF NOT EXISTS idx_rpo_role ON role_permission_overrides(role);

-- ---------------------------------------------------------------------------
-- 2. tenant_custom_roles (TEAMS plan only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_custom_roles (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   integer      NOT NULL REFERENCES tenants(id),
  name        varchar(64)  NOT NULL,
  description text,
  base_role   varchar(32)  NOT NULL,
  permissions jsonb        NOT NULL DEFAULT '[]',
  created_by  varchar(36)  NOT NULL REFERENCES users(id),
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_tcr_tenant ON tenant_custom_roles(tenant_id);

-- ---------------------------------------------------------------------------
-- 3. platform_modules — platform-wide module definitions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_modules (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  name        varchar(128) NOT NULL UNIQUE,
  slug        varchar(128) NOT NULL UNIQUE,
  description text,
  base_role   varchar(64),
  permissions jsonb        NOT NULL DEFAULT '[]',
  is_builtin  boolean      NOT NULL DEFAULT false,
  created_by  varchar(36)  REFERENCES users(id),
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 4. tenant_member_modules — per-user module assignments within a tenant
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_member_modules (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   integer      NOT NULL REFERENCES tenants(id),
  user_id     varchar(36)  NOT NULL REFERENCES users(id),
  module_id   uuid         NOT NULL REFERENCES platform_modules(id),
  granted_by  varchar(36)  NOT NULL REFERENCES users(id),
  granted_at  timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, module_id)
);

CREATE INDEX IF NOT EXISTS idx_tmm_tenant_user ON tenant_member_modules(tenant_id, user_id);

-- ---------------------------------------------------------------------------
-- 5. user_permission_overrides — per-user per-tenant permission grants/revocations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_permission_overrides (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   integer      NOT NULL REFERENCES tenants(id),
  user_id     varchar(36)  NOT NULL REFERENCES users(id),
  permission  varchar(128) NOT NULL,
  granted     boolean      NOT NULL,  -- true = grant, false = revoke
  expires_at  timestamptz,
  created_by  varchar(36)  NOT NULL REFERENCES users(id),
  created_at  timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, permission)
);

CREATE INDEX IF NOT EXISTS idx_upo_tenant_user ON user_permission_overrides(tenant_id, user_id);

-- ---------------------------------------------------------------------------
-- 6. Seed built-in platform modules
-- ---------------------------------------------------------------------------
INSERT INTO platform_modules (name, slug, description, base_role, permissions, is_builtin)
VALUES
  ('Reporting Access',    'reporting-access',    'Read and export reports and audit logs',       'viewer',    '["report:read","report:export","audit:read"]',                           true),
  ('Workflow Editor',     'workflow-editor',     'Create and execute advanced workflows',        'developer', '["workflow:write","workflow:execute","workflow:delete"]',                true),
  ('Billing Viewer',      'billing-viewer',      'View billing and subscription details',        'developer', '["billing:read"]',                                                      true),
  ('Marketplace Manager', 'marketplace-manager', 'Purchase and publish marketplace assets',     'manager',   '["marketplace:purchase","marketplace:publish"]',                        true),
  ('Fleet Manager',       'fleet-manager',       'Register, configure, and delete CoderClaws',  'manager',   '["claw:register","claw:configure","claw:delete"]',                     true)
ON CONFLICT (slug) DO NOTHING;
