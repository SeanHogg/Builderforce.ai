-- 0465 — Rollback for a published site, and end users for a generated app.
--
-- TWO GAPS, ONE MIGRATION, because they are the same shape of omission: a
-- published site could neither go BACK to a working version nor have anyone sign
-- in to it, so the only app a tenant could actually ship end-to-end was a
-- brochure with a form.
--
-- ── site_releases ───────────────────────────────────────────────────────────
-- `publishStaticSite` deleted every object under the subdomain prefix before
-- writing the new build, so the previous release was gone the moment a worse one
-- shipped. Builds now land under `sites/<sub>/<versionToken>/` and this table is
-- the register of them; `project_sites.r2_prefix` / `version_token` remain the
-- POINTER to the current one (a deliberate denormalisation with a single writer:
-- the serving path must resolve a site in one read, and a join per asset request
-- would be a query on the hot path).
CREATE TABLE IF NOT EXISTS site_releases (
  id             SERIAL PRIMARY KEY,
  site_id        INTEGER NOT NULL REFERENCES project_sites(id) ON DELETE CASCADE,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version_token  VARCHAR(32) NOT NULL,
  r2_prefix      TEXT NOT NULL,
  -- 'browser' (built in the workspace) | 'github' (built by the tenant's Action).
  source         VARCHAR(16) NOT NULL DEFAULT 'browser',
  asset_count    INTEGER NOT NULL DEFAULT 0,
  total_bytes    BIGINT NOT NULL DEFAULT 0,
  published_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT site_releases_site_version_unique UNIQUE (site_id, version_token)
);
CREATE INDEX IF NOT EXISTS site_releases_site_published_idx ON site_releases (site_id, published_at DESC);
CREATE INDEX IF NOT EXISTS site_releases_tenant_idx ON site_releases (tenant_id);

-- ── site_users / site_user_sessions ─────────────────────────────────────────
-- The END USERS of a generated app — the visitors who sign up to the thing a
-- tenant built, NOT Builderforce users. Deliberately a separate identity space
-- from `users`: a person who signs into someone's recipe app has no Builderforce
-- account, no tenant membership and no platform permissions, and conflating the
-- two would make every generated app a door into the platform's own identity.
--
-- Passwordless by construction. There is no password column and no hash: a
-- generated app is authored by a language model, and the one credential mistake
-- that cannot be undone is a badly-stored password. Sign-in is a one-time code
-- delivered to the address, so the app never holds a reusable secret.
CREATE TABLE IF NOT EXISTS site_users (
  id           SERIAL PRIMARY KEY,
  site_id      INTEGER NOT NULL REFERENCES project_sites(id) ON DELETE CASCADE,
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email        VARCHAR(320) NOT NULL,
  display_name VARCHAR(120),
  status       VARCHAR(16) NOT NULL DEFAULT 'active',
  last_seen_at TIMESTAMP,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT site_users_site_email_unique UNIQUE (site_id, email)
);
CREATE INDEX IF NOT EXISTS site_users_tenant_idx ON site_users (tenant_id);

-- One row per sign-in attempt AND per live session: `code_hash` is set while the
-- code is outstanding and cleared once redeemed, so an unredeemed request cannot
-- be replayed into a session and a live session carries no credential at all.
CREATE TABLE IF NOT EXISTS site_user_sessions (
  id           SERIAL PRIMARY KEY,
  site_user_id INTEGER NOT NULL REFERENCES site_users(id) ON DELETE CASCADE,
  site_id      INTEGER NOT NULL REFERENCES project_sites(id) ON DELETE CASCADE,
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token_hash   VARCHAR(64) NOT NULL,
  code_hash    VARCHAR(64),
  code_expires_at TIMESTAMP,
  attempts     INTEGER NOT NULL DEFAULT 0,
  expires_at   TIMESTAMP NOT NULL,
  redeemed_at  TIMESTAMP,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT site_user_sessions_token_unique UNIQUE (token_hash)
);
CREATE INDEX IF NOT EXISTS site_user_sessions_user_idx ON site_user_sessions (site_user_id);
CREATE INDEX IF NOT EXISTS site_user_sessions_site_idx ON site_user_sessions (site_id);

-- Records written by a signed-in end user are OWNED by them, which is what makes
-- an owner-scoped read possible at all. Nullable because the anonymous form post
-- that `site_collections` was built for stays exactly as it was.
ALTER TABLE site_records ADD COLUMN IF NOT EXISTS site_user_id INTEGER REFERENCES site_users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS site_records_owner_idx ON site_records (collection_id, site_user_id);

-- Per-collection read policy. 'none' keeps today's write-only behaviour (the
-- default, so nothing existing changes); 'owner' lets a signed-in end user read
-- back the rows they themselves wrote. There is deliberately no 'all': a public
-- read of every submission is the failure mode `siteData.ts` was written to
-- prevent, and it must not become one option among three.
ALTER TABLE site_collections ADD COLUMN IF NOT EXISTS read_policy VARCHAR(16) NOT NULL DEFAULT 'none';
