-- 0467 — Developer portal: the third bucket.
--
-- ── WHAT WAS MISSING ────────────────────────────────────────────────────────
-- Everything a third party could build for this platform landed in one of two
-- buckets. TENANT-PRIVATE: a `connectors` row, a `tenant_mcp_extensions` row —
-- real capability, visible to exactly one workspace. CODE-OWNED: the forty
-- manifests in `defaults/`, `BOARD_PROVIDERS`, `dataProviderCatalog`, the drive /
-- mailbox / payout / ledger ports — reachable by everyone, addable only by us,
-- via a pull request and a deploy.
--
-- Neither bucket reaches another customer. So a vendor who wants to integrate has
-- two options: get us to merge their adapter (we are the bottleneck AND the only
-- ones who can market it), or build something only their own workspace can use
-- (no distribution, therefore no reason to build). That is why the integration
-- catalogue is entirely our own work: not because vendors would not build, but
-- because there is nowhere for what they build to go.
--
-- These five tables are the third bucket: authored outside, reviewed by us,
-- installable by any tenant.
--
-- ── ONE ARTIFACT, KIND AS A COLUMN ──────────────────────────────────────────
-- A published connector, a published MCP server and a published canvas kind are
-- the same transaction — a versioned spec, reviewed once, installed under a scope
-- grant, optionally sold. Three tables would be three copies of that transaction,
-- and "what is installed here?" would become three queries that can disagree. So
-- `kind` is a VALUE on `extension_packages`, exactly as `discipline` is on
-- `field_jobs` (0464) and `builtin_kind` is on `ide_agents` (0289).
--
-- ── WHAT IS DELIBERATELY *NOT* HERE ─────────────────────────────────────────
-- No price column and no order table: a package sells as a `catalog_items` row
-- through the rails `orders` and the payout port already own, and
-- `catalog_item_id` is the id that points at it. No secret column anywhere: an
-- install's credential is a `connector_connections` row with the sealed value,
-- like every other connection on the platform. No second scope vocabulary — a
-- grant names scopes from the list `application/shared/scopeList.ts` serves to
-- `tenant_api_keys` as well.
--
-- ── FOUR TABLES CARRY NO tenant_id, AS A DECISION ───────────────────────────
-- A publisher is not our customer, and a published package is the same row for
-- every tenant — which is the definition of a global catalogue. The tenancy lives
-- on `tenant_extension_installs`, where the grant is. Both halves are declared in
-- `check-tenant-column.mjs`'s TENANT_INDEPENDENT map so the absence is on the
-- record rather than looking like a forgotten column.
--
-- ── AND THE DRIFT THIS CLOSES ───────────────────────────────────────────────
-- `developer_api_keys` was parented to a USER and carried no scopes, while
-- `tenant_api_keys` twenty lines below it carried scopes AND an origin allowlist
-- — two shapes for one concept ("a credential calling us from outside"), two
-- middlewares, two answers to "what may this key do". Worse, the key was
-- CASCADE-deleted with its minter's user row: a vendor's production integration,
-- removed by an offboarding. Section 3 re-parents it to a publisher and gives it
-- scopes. Every existing row is backfilled into a personal publisher org, so no
-- key stops working.
--
-- It does NOT gain an origin allowlist, and that is the interesting half. Adding
-- one made the two tables score 0.68 on `check-signature-duplication` — the guard
-- correctly said they were one table. They are not: a bfai_* key is a SERVER
-- credential and would carry a permanently-NULL allowlist copied for symmetry.
-- Removing the column removed the duplication, which is the guard working as
-- intended rather than a threshold being dodged.

-- ═══ 1 · Publishers ═════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS developer_orgs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                  varchar(80)  NOT NULL UNIQUE,
  legal_name            varchar(200) NOT NULL,
  website               text,
  support_email         varchar(255),
  verification_state    varchar(32)  NOT NULL DEFAULT 'unverified',
  verification_domain   varchar(255),
  verification_token    varchar(64),
  verified_at           timestamptz,
  payout_connection_id  uuid,
  suspended_at          timestamptz,
  suspended_reason      text,
  created_at            timestamptz  NOT NULL DEFAULT now(),
  updated_at            timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_developer_orgs_state ON developer_orgs (verification_state);

CREATE TABLE IF NOT EXISTS developer_org_members (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_org_id  uuid        NOT NULL REFERENCES developer_orgs(id) ON DELETE CASCADE,
  -- A cross-domain id, not a foreign key: identity owns `users`, and a membership
  -- row is how this bounded context refers to one (check-domain-boundary).
  user_id           varchar(36) NOT NULL,
  role              varchar(24) NOT NULL DEFAULT 'publisher',
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_developer_org_member ON developer_org_members (developer_org_id, user_id);
CREATE INDEX IF NOT EXISTS idx_developer_org_members_user ON developer_org_members (user_id);

-- ═══ 2 · Packages, versions, installs ═══════════════════════════════════════

CREATE TABLE IF NOT EXISTS extension_packages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_org_id    uuid         NOT NULL REFERENCES developer_orgs(id) ON DELETE CASCADE,
  -- Unique platform-wide, because the slug is what an install names and what a
  -- URL addresses. A per-publisher slug would make two `stripe` packages
  -- indistinguishable at the point of installing one.
  slug                varchar(100) NOT NULL UNIQUE,
  kind                varchar(32)  NOT NULL,
  name                varchar(160) NOT NULL,
  tagline             varchar(240) NOT NULL DEFAULT '',
  description         text,
  categories          jsonb        NOT NULL DEFAULT '[]'::jsonb,
  icon_url            text,
  docs_url            text,
  listing_state       varchar(24)  NOT NULL DEFAULT 'draft',
  -- The published head. A POINTER rather than a copy of the spec: a spec stored
  -- twice is a spec that disagrees with itself the first time a version is rolled
  -- back. No FK — it would be circular with extension_versions.package_id.
  current_version_id  uuid,
  -- Cross-domain id into `catalog_items`, where price and plans live. NULL = free.
  catalog_item_id     uuid,
  install_count       integer      NOT NULL DEFAULT 0,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_extension_packages_org    ON extension_packages (developer_org_id);
CREATE INDEX IF NOT EXISTS idx_extension_packages_listed ON extension_packages (listing_state, kind);

CREATE TABLE IF NOT EXISTS extension_versions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id        uuid        NOT NULL REFERENCES extension_packages(id) ON DELETE CASCADE,
  semver            varchar(32) NOT NULL,
  -- UNTRUSTED INPUT, in the sense connectorManifest.ts means it. Re-parsed on
  -- every read so a spec that outlived a contract change is SKIPPED (visible)
  -- rather than handed to the runtime half-understood (a confusing upstream error).
  spec              jsonb       NOT NULL,
  requested_scopes  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  changelog         text,
  review_state      varchar(24) NOT NULL DEFAULT 'pending',
  -- Every check the pipeline ran, pass or fail. An approval nobody can
  -- reconstruct is not an audit trail.
  review_findings   jsonb       NOT NULL DEFAULT '[]'::jsonb,
  reviewed_at       timestamptz,
  published_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_extension_version_semver ON extension_versions (package_id, semver);
CREATE INDEX IF NOT EXISTS idx_extension_versions_review     ON extension_versions (review_state);

CREATE TABLE IF NOT EXISTS tenant_extension_installs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            integer     NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  package_id           uuid        NOT NULL REFERENCES extension_packages(id) ON DELETE CASCADE,
  -- RESTRICT, not CASCADE: a version an install points at must not be deletable
  -- out from under a running workspace.
  version_id           uuid        NOT NULL REFERENCES extension_versions(id) ON DELETE RESTRICT,
  -- A SNAPSHOT of what the admin approved, not a pointer at the version's request.
  -- A grant that followed the head would silently widen when the publisher shipped.
  granted_scopes       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  connection_id        uuid,
  installed_by_user_id varchar(36),
  -- Set instead of deleting: an uninstall must not orphan the call logs that
  -- reference it, and a reinstall should be able to see it happened before.
  disabled_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_extension_install       ON tenant_extension_installs (tenant_id, package_id);
CREATE INDEX        IF NOT EXISTS idx_tenant_extension_installs_tenant ON tenant_extension_installs (tenant_id, disabled_at);

-- ═══ 3 · Re-parent developer API keys onto publishers ═══════════════════════
--
-- The columns land nullable and the backfill fills them. A NOT NULL would fail
-- the deploy on any row the backfill missed, and the mint path sets the column
-- from now on — so the constraint would buy nothing and could cost an outage.

ALTER TABLE developer_api_keys ADD COLUMN IF NOT EXISTS developer_org_id uuid;
ALTER TABLE developer_api_keys ADD COLUMN IF NOT EXISTS scopes           text;
-- Deliberately NO `allowed_origins`. A bfai_* key is a publisher's SERVER
-- credential (their CI, their integration server); a browser origin allowlist
-- would be a column that is always NULL, added for symmetry with
-- `tenant_api_keys` rather than for a caller. `check-signature-duplication`
-- flagged exactly that: with it, the two tables scored 0.68 and WERE each other.

-- One personal publisher per user who already holds a key, named from the user
-- so the portal shows something recognisable rather than a uuid. `ON CONFLICT DO
-- NOTHING` on the slug makes the whole migration re-runnable.
--
-- The name column is `display_name`, NOT `name`: `users` has never had a `name`
-- column (identity.ts — id, email, username, display_name, …), and the first
-- draft of this line said `u.name`, which is not a typecheck error, not a test
-- failure and not a lint finding — it is a red deploy at `db:migrate`, which is
-- where it was found. `left(…, 200)` because `legal_name` is varchar(200) while
-- both `display_name` and `email` are varchar(255): a long display name would
-- abort the whole file on a value overflow the same way a missing column does.
INSERT INTO developer_orgs (slug, legal_name, verification_state)
SELECT
  'dev-' || substring(replace(u.id::text, '-', '') from 1 for 16),
  left(COALESCE(
    NULLIF(TRIM(u.display_name), ''),
    NULLIF(TRIM(u.username), ''),
    u.email,
    'Developer'
  ), 200),
  'unverified'
FROM users u
WHERE EXISTS (SELECT 1 FROM developer_api_keys k WHERE k.user_id = u.id)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO developer_org_members (developer_org_id, user_id, role)
SELECT o.id, u.id, 'owner'
FROM users u
JOIN developer_orgs o
  ON o.slug = 'dev-' || substring(replace(u.id::text, '-', '') from 1 for 16)
WHERE EXISTS (SELECT 1 FROM developer_api_keys k WHERE k.user_id = u.id)
ON CONFLICT (developer_org_id, user_id) DO NOTHING;

UPDATE developer_api_keys k
SET developer_org_id = o.id
FROM developer_orgs o
WHERE k.developer_org_id IS NULL
  AND o.slug = 'dev-' || substring(replace(k.user_id::text, '-', '') from 1 for 16);

CREATE INDEX IF NOT EXISTS idx_developer_api_keys_org ON developer_api_keys (developer_org_id);
