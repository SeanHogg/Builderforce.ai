-- 0471 — A developer is a tenant. Only the tenant survives.
--
-- ── THE DECISION ────────────────────────────────────────────────────────────
-- 0467 introduced a PUBLISHER as a first-class party, deliberately distinct from
-- a tenant, on the argument that "the company that builds a payroll connector for
-- us is not necessarily a customer of ours". That argument was rejected by the
-- owner: a developer IS a tenant. Every party on this platform is a workspace, and
-- publishing is something a workspace DOES, not a second kind of party that has to
-- be registered, joined and kept in sync with the first.
--
-- The guards had already said as much and were being argued with rather than
-- listened to. `check-signature-duplication` scored `developer_api_keys` against
-- `tenant_api_keys` at 0.68 — one concept, two tables — and 0467's answer was to
-- REMOVE a column (`allowed_origins`) until the score dropped, which is dodging a
-- threshold, not resolving a duplicate. `check-shape-lint` said
-- `developer_org_members` was `memberships` with the tenant taken out. Both were
-- correct. This migration acts on them.
--
-- ── WHAT COLLAPSES ──────────────────────────────────────────────────────────
--   developer_orgs           → a PUBLISHER FACET on `tenants` (§1). One party.
--   developer_org_members    → `tenant_members`. One membership, one role ladder.
--   developer_api_keys       → `tenant_api_keys` (§4). One credential, one scope
--                              vocabulary, one resolver, one origin rule.
--   extension_packages.developer_org_id → `tenant_id` (§2).
--
-- Three tables and one column removed; nine nullable columns added to the party
-- that already existed. That is the trade, and it is the right way round: a
-- publisher profile is 1:1 with a workspace and every column is functionally
-- dependent on `tenants.id`, so it is 3NF as columns and was never a separate
-- entity. It also matches how this platform already says "this party is also an
-- X" — `users.available_for_hire`, `users.account_type`, `ide_agents.builtin_kind`,
-- `field_jobs.discipline`. A kind is a value; a facet is a column.
--
-- ── WHAT IS NOT LOST ────────────────────────────────────────────────────────
-- The thing 0467 was actually protecting — a vendor's key surviving the
-- offboarding of the engineer who minted it — is preserved and in fact improved.
-- `developer_api_keys.user_id` was `ON DELETE CASCADE`; `tenant_api_keys
-- .created_by_user_id` is `ON DELETE SET NULL`. The key now outlives its minter
-- because the WORKSPACE owns it, which is the same answer 0467 wanted and a
-- weaker one than a whole parallel party model had to be built for.
--
-- A publisher that genuinely has no customer relationship is still expressible:
-- it is a free workspace with `publisher_state <> 'none'`. Nothing about being a
-- tenant obliges anyone to buy anything.

-- ═══ 1 · The publisher facet on `tenants` ═══════════════════════════════════
--
-- `publisher_state` carries BOTH facts — whether this workspace publishes at all,
-- and how far it is verified — because they are one ordered scale and splitting
-- them would allow the fourth state nobody wants: `is_publisher = false` with
-- `verification_state = 'identity_verified'`. 'none' is the default, so every
-- existing workspace is correctly not a publisher without a backfill.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS publisher_state              varchar(32) NOT NULL DEFAULT 'none';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS publisher_website            text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS publisher_support_email      varchar(255);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS publisher_domain             varchar(255);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS publisher_verification_token varchar(64);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS publisher_verified_at        timestamptz;
-- Cross-domain id into `connections` (capability='payout'). No FK, for the reason
-- 0467 gave and this migration keeps: payouts are the commerce domain's.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS publisher_payout_connection_id uuid;
-- Standing a PUBLISHER down hides its listings. It does not suspend the WORKSPACE
-- — that is `tenants.status`, and conflating the two would mean a vendor whose
-- listing broke the rules loses access to their own board.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS publisher_suspended_at       timestamptz;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS publisher_suspended_reason   text;

-- Partial: the overwhelming majority of workspaces are 'none' and would only
-- bloat a full index. The queries that use this all ask for publishers.
CREATE INDEX IF NOT EXISTS idx_tenants_publisher_state
  ON tenants (publisher_state) WHERE publisher_state <> 'none';

-- ═══ 2 · Packages re-parent onto the tenant ═════════════════════════════════

ALTER TABLE extension_packages
  ADD COLUMN IF NOT EXISTS tenant_id integer REFERENCES tenants(id) ON DELETE CASCADE;

-- The workspace behind a publisher: its OWNER's, oldest membership first so the
-- choice is deterministic for somebody who belongs to two. The same subquery
-- appears again in §3 — repeated rather than factored into a temp table because a
-- migration runner may not guarantee one session per file, and a wrong answer here
-- is a package attributed to the wrong workspace.
UPDATE extension_packages p
SET tenant_id = m.tenant_id
FROM (
  SELECT o.id AS org_id,
         (SELECT tm.tenant_id
            FROM developer_org_members dm
            JOIN tenant_members tm ON tm.user_id = dm.user_id AND tm.is_active
           WHERE dm.developer_org_id = o.id
           ORDER BY (dm.role = 'owner') DESC, dm.created_at, tm.joined_at, tm.tenant_id
           LIMIT 1) AS tenant_id
    FROM developer_orgs o
) m
WHERE p.developer_org_id = m.org_id
  AND p.tenant_id IS NULL
  AND m.tenant_id IS NOT NULL;

-- A package whose publisher resolves to no workspace cannot exist in the new
-- model, and it could not be reached in the old one either: creating one requires
-- a signed-in member, so an org with no member holding an active workspace never
-- had a package. Deleting the impossible row is what lets the column be NOT NULL
-- rather than nullable forever — and a nullable tenant column on a table the
-- tenancy guard now owns is precisely the hole this migration exists to close.
DELETE FROM extension_packages WHERE tenant_id IS NULL;
ALTER TABLE extension_packages ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_extension_packages_tenant ON extension_packages (tenant_id);

-- ═══ 3 · The publisher profile moves onto the workspace ═════════════════════
--
-- `DISTINCT ON (tenant_id)` resolves the one collision this can produce: two
-- publisher orgs whose owners share a workspace. The most-verified wins, then the
-- oldest — never "whichever the planner emitted last", which would make the
-- outcome depend on the row order.

UPDATE tenants t
SET publisher_state              = o.verification_state,
    publisher_website            = o.website,
    publisher_support_email      = o.support_email,
    publisher_domain             = o.verification_domain,
    publisher_verification_token = o.verification_token,
    publisher_verified_at        = o.verified_at,
    publisher_payout_connection_id = o.payout_connection_id,
    publisher_suspended_at       = o.suspended_at,
    publisher_suspended_reason   = o.suspended_reason,
    updated_at                   = NOW()
FROM (
  SELECT DISTINCT ON (x.tenant_id) x.*
  FROM (
    SELECT o.*,
           (SELECT tm.tenant_id
              FROM developer_org_members dm
              JOIN tenant_members tm ON tm.user_id = dm.user_id AND tm.is_active
             WHERE dm.developer_org_id = o.id
             ORDER BY (dm.role = 'owner') DESC, dm.created_at, tm.joined_at, tm.tenant_id
             LIMIT 1) AS tenant_id
      FROM developer_orgs o
  ) x
  WHERE x.tenant_id IS NOT NULL
  ORDER BY x.tenant_id,
           CASE x.verification_state
             WHEN 'identity_verified' THEN 3
             WHEN 'domain_verified'   THEN 2
             WHEN 'unverified'        THEN 1
             ELSE 0
           END DESC,
           x.created_at
) o
WHERE t.id = o.tenant_id
  AND t.publisher_state = 'none';

-- ═══ 4 · Publisher API keys become tenant API keys ══════════════════════════
--
-- The hash carries over UNCHANGED — both tables store `hashSecret()`, which is a
-- SHA-256 hex digest, and resolution is by hash. So every `bfai_*` key already in
-- production keeps working after this runs; the prefix becomes cosmetic history
-- rather than a routing decision, and new keys are minted as `bfk_*`.
--
-- `allowed_origins` is set to the any-origin escape hatch rather than NULL, and
-- that is deliberate. NULL means SERVER-ONLY on a tenant key, and the endpoint
-- these keys authenticate (`/api/v1/agents`) is documented as the one external
-- SITES embed listings with — a browser call carrying an `Origin` header. Copying
-- them in as server-only would revoke, at deploy time, exactly the usage the
-- endpoint exists for. New keys still default to server-only; only the migrated
-- ones are grandfathered, and their owners can narrow the list in the portal.
--
-- `ON CONFLICT (key_hash)` makes the whole statement re-runnable.

INSERT INTO tenant_api_keys (
  tenant_id, name, key_hash, created_by_user_id, allowed_origins, scopes,
  last_used_at, revoked_at, created_at
)
SELECT tm.tenant_id,
       k.name,
       k.key_hash,
       k.user_id,
       '["*"]',
       k.scopes,
       k.last_used_at,
       k.revoked_at,
       k.created_at
FROM developer_api_keys k
JOIN LATERAL (
  SELECT tenant_id
    FROM tenant_members
   WHERE user_id = k.user_id AND is_active
   ORDER BY joined_at, tenant_id
   LIMIT 1
) tm ON true
ON CONFLICT (key_hash) DO NOTHING;

-- ═══ 5 · Drop the parallel party model ══════════════════════════════════════
--
-- Order matters: the FK on `developer_org_members` and the (now-dropped) one on
-- `extension_packages` both point at `developer_orgs`.

ALTER TABLE extension_packages DROP COLUMN IF EXISTS developer_org_id;

DROP TABLE IF EXISTS developer_api_keys;
DROP TABLE IF EXISTS developer_org_members;
DROP TABLE IF EXISTS developer_orgs;
