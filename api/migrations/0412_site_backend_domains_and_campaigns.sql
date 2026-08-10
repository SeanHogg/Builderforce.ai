-- 0412_site_backend_domains_and_campaigns.sql
--
-- Closes the "idea → delivered outcome" tail: a published site can now own a
-- domain, collect data, be measured, and be marketed. Five previously-missing
-- capabilities, one migration because they are one user journey:
--
--   A. integration_provider  — the enum admitted only SCM/PM/ITSM providers, so
--      a database connection string or a marketing API key had NOWHERE to live.
--      The workflow builder advertised 24 such integrations against a backend
--      that could not store any of them.
--   B. project_sites         — `custom_domain` shipped in 0193 and was never
--      read or written. The verification state it needs to be usable is added
--      here (status / token / verified_at / cf hostname id).
--   C. site_traffic_daily    — a published site produced zero telemetry, so the
--      outcome ledger measured *shipping*, not *outcome*.
--   D. site_collections/records — the site had no backend at all, so a form on
--      a published page had nowhere to post.
--   E. marketing_*           — `sales_campaigns` (0401) is the referral team's
--      own hand-typed CRM. A TENANT marketing their OWN product had no audience,
--      no sending identity, no suppression list and no send ledger.
--
-- Idempotent / re-runnable throughout. NON-transactional (lives in migrations/,
-- not transactional-migrations/) because `ALTER TYPE … ADD VALUE` cannot have its
-- new label used in the same transaction; nothing below references the new enum
-- labels, so the ordering is safe either way.

-- ---------------------------------------------------------------------------
-- A · integration_provider — data + marketing families
-- ---------------------------------------------------------------------------
-- Mirrors DATA_PROVIDERS / MARKETING_PROVIDERS in
-- application/integrations/dataProviderCatalog.ts. That catalog is the single
-- source of truth for auth shape, transport and connectivity testing; this enum
-- is only the storage constraint. A provider present here but absent there is
-- caught by dataProviderCatalog.test.ts.

-- Databases & data platforms
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'postgres';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'mysql';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'mongodb';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'supabase';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'snowflake';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'bigquery';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'redis';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'elasticsearch';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'clickhouse';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'neon';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'planetscale';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'google_cloud_sql';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'airtable';

-- Marketing & CRM
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'hubspot';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'salesforce';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'klaviyo';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'customerio';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'activecampaign';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'attio';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'zoho_crm';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'marketo';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'mailchimp';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'brevo';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'pipedrive';

-- ---------------------------------------------------------------------------
-- B · project_sites — custom domain lifecycle
-- ---------------------------------------------------------------------------
-- `custom_domain` (0193) is the hostname the tenant owns. It only becomes
-- routable once DNS proves ownership AND a certificate exists, so the column
-- alone was unusable. Lifecycle:
--   unset → pending_dns → pending_certificate → active   (or `failed`)
-- `custom_domain_token` is the value the tenant publishes at
-- `_builderforce-challenge.<domain>` as a TXT record; the verifier resolves it
-- over DNS-over-HTTPS, so no zone access is needed to prove ownership.
ALTER TABLE project_sites ADD COLUMN IF NOT EXISTS custom_domain_status       VARCHAR(24) NOT NULL DEFAULT 'unset';
ALTER TABLE project_sites ADD COLUMN IF NOT EXISTS custom_domain_token        VARCHAR(64);
ALTER TABLE project_sites ADD COLUMN IF NOT EXISTS custom_domain_verified_at  TIMESTAMP;
ALTER TABLE project_sites ADD COLUMN IF NOT EXISTS custom_domain_hostname_id  VARCHAR(64);
ALTER TABLE project_sites ADD COLUMN IF NOT EXISTS custom_domain_error        TEXT;

-- A hostname can only be claimed once across the whole platform (the routing
-- table is global), enforced in the DB rather than by a read-then-write race.
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_sites_custom_domain
  ON project_sites(custom_domain) WHERE custom_domain IS NOT NULL;

-- ---------------------------------------------------------------------------
-- C · site_traffic_daily — per-site, per-day request rollup
-- ---------------------------------------------------------------------------
-- Deliberately a ROLLUP, not a request log: the hosting path is the hottest in
-- the worker and a row per request would both dominate Neon cost and add a
-- write to every asset fetch. The middleware buffers in-isolate and flushes an
-- additive UPSERT (see application/ide/siteTraffic.ts).
CREATE TABLE IF NOT EXISTS site_traffic_daily (
  id            SERIAL PRIMARY KEY,
  site_id       INTEGER NOT NULL REFERENCES project_sites(id) ON DELETE CASCADE,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- UTC calendar day the counts belong to
  day           DATE NOT NULL,
  -- document requests (HTML / SPA entry) — the closest thing to a "visit"
  page_views    INTEGER NOT NULL DEFAULT 0,
  -- every served request including assets, for bandwidth//load context
  asset_hits    INTEGER NOT NULL DEFAULT 0,
  -- distinct-ish visitors: count of distinct daily visitor hashes seen by this
  -- isolate set. Approximate by construction; documented as such in the UI.
  visitors      INTEGER NOT NULL DEFAULT 0,
  bytes_served  BIGINT  NOT NULL DEFAULT 0,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_site_traffic_daily_site_day ON site_traffic_daily(site_id, day);
CREATE INDEX IF NOT EXISTS idx_site_traffic_daily_tenant_day ON site_traffic_daily(tenant_id, day DESC);
CREATE INDEX IF NOT EXISTS idx_site_traffic_daily_project_day ON site_traffic_daily(project_id, day DESC);

-- ---------------------------------------------------------------------------
-- D · site_collections / site_records — the published site's backend
-- ---------------------------------------------------------------------------
-- A static site could not store anything, so a contact form on a published page
-- had nowhere to post. A collection is a named, public-writable endpoint served
-- at `https://<site-host>/__api/collections/<name>`; records are its rows.
-- Reads are NEVER public (that would expose everyone's submissions) — the owner
-- reads them back through the authenticated project API.
CREATE TABLE IF NOT EXISTS site_collections (
  id                   SERIAL PRIMARY KEY,
  site_id              INTEGER NOT NULL REFERENCES project_sites(id) ON DELETE CASCADE,
  tenant_id            INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id           INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- URL segment: lowercase a-z0-9 and hyphen
  name                 VARCHAR(64) NOT NULL,
  -- public POST allowed? A collection can be switched read-only without deleting it.
  accepts_public_writes BOOLEAN NOT NULL DEFAULT TRUE,
  -- when set, submissions with an `email` field are also added to this audience
  audience_id          INTEGER,
  -- per-collection daily write ceiling (abuse bound; 0 = use the platform default)
  daily_write_cap      INTEGER NOT NULL DEFAULT 0,
  record_count         INTEGER NOT NULL DEFAULT 0,
  created_at           TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_site_collections_site_name ON site_collections(site_id, name);
CREATE INDEX IF NOT EXISTS idx_site_collections_tenant ON site_collections(tenant_id);
CREATE INDEX IF NOT EXISTS idx_site_collections_project ON site_collections(project_id);

CREATE TABLE IF NOT EXISTS site_records (
  id            BIGSERIAL PRIMARY KEY,
  collection_id INTEGER NOT NULL REFERENCES site_collections(id) ON DELETE CASCADE,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- the submitted body, already size-capped and stripped of reserved keys
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- normalized email lifted out of the payload when present (audience join key)
  email         VARCHAR(320),
  -- salted hash of the submitter IP — rate limiting + dedupe without storing a PII IP
  ip_hash       VARCHAR(64),
  user_agent    VARCHAR(500),
  referrer      VARCHAR(1000),
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_site_records_collection_time ON site_records(collection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_records_tenant_time ON site_records(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_records_email ON site_records(email) WHERE email IS NOT NULL;

-- ---------------------------------------------------------------------------
-- E · marketing_* — a tenant marketing their OWN product
-- ---------------------------------------------------------------------------
-- Distinct from `sales_campaigns` (0401), which is the Builderforce referral
-- team's hand-maintained CRM and is scoped to a user, not a tenant.

-- A verified From: identity. Until `status='verified'` a campaign cannot send,
-- so a tenant can never send as a domain they do not control.
CREATE TABLE IF NOT EXISTS marketing_sender_identities (
  id             SERIAL PRIMARY KEY,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_email     VARCHAR(320) NOT NULL,
  from_name      VARCHAR(255) NOT NULL DEFAULT '',
  reply_to       VARCHAR(320),
  -- 'pending' → 'verified' | 'failed'. Ownership is proven with a TXT record at
  -- `_builderforce-sender.<domain>` resolved over DNS-over-HTTPS (same mechanism
  -- as the custom-domain verifier — one shared verifier, see dnsVerification.ts).
  status         VARCHAR(16) NOT NULL DEFAULT 'pending',
  verify_token   VARCHAR(64) NOT NULL,
  verified_at    TIMESTAMP,
  last_error     TEXT,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_marketing_sender_tenant_email ON marketing_sender_identities(tenant_id, from_email);

CREATE TABLE IF NOT EXISTS marketing_audiences (
  id           SERIAL PRIMARY KEY,
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id   INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  name         VARCHAR(255) NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  -- denormalized subscribed count (kept by the engine; cheap to maintain)
  member_count INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_marketing_audiences_tenant ON marketing_audiences(tenant_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS marketing_audience_members (
  id           BIGSERIAL PRIMARY KEY,
  audience_id  INTEGER NOT NULL REFERENCES marketing_audiences(id) ON DELETE CASCADE,
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email        VARCHAR(320) NOT NULL,
  name         VARCHAR(255) NOT NULL DEFAULT '',
  -- 'subscribed' | 'unsubscribed' | 'bounced'. Never deleted on unsubscribe:
  -- the row IS the record of consent withdrawal.
  status       VARCHAR(16) NOT NULL DEFAULT 'subscribed',
  -- where they came from: 'site-form' | 'import' | 'manual' | 'api'
  source       VARCHAR(32) NOT NULL DEFAULT 'manual',
  attributes   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_marketing_audience_member ON marketing_audience_members(audience_id, email);
CREATE INDEX IF NOT EXISTS idx_marketing_audience_members_tenant ON marketing_audience_members(tenant_id);

-- Tenant-wide do-not-contact. Checked at send time REGARDLESS of audience, so
-- unsubscribing once cannot be undone by re-importing a list.
CREATE TABLE IF NOT EXISTS marketing_suppressions (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email       VARCHAR(320) NOT NULL,
  reason      VARCHAR(32) NOT NULL DEFAULT 'unsubscribed',  -- unsubscribed | bounced | complaint | manual
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_marketing_suppressions_tenant_email ON marketing_suppressions(tenant_id, email);

CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id                  SERIAL PRIMARY KEY,
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id          INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  audience_id         INTEGER NOT NULL REFERENCES marketing_audiences(id) ON DELETE CASCADE,
  sender_identity_id  INTEGER REFERENCES marketing_sender_identities(id) ON DELETE SET NULL,
  name                VARCHAR(255) NOT NULL,
  subject             VARCHAR(500) NOT NULL DEFAULT '',
  body_html           TEXT NOT NULL DEFAULT '',
  -- draft → sending → sent | failed | cancelled
  status              VARCHAR(16) NOT NULL DEFAULT 'draft',
  scheduled_at        TIMESTAMP,
  started_at          TIMESTAMP,
  completed_at        TIMESTAMP,
  -- counters maintained by the send engine (never hand-typed, unlike 0401)
  recipients          INTEGER NOT NULL DEFAULT 0,
  sent                INTEGER NOT NULL DEFAULT 0,
  failed              INTEGER NOT NULL DEFAULT 0,
  suppressed          INTEGER NOT NULL DEFAULT 0,
  opened              INTEGER NOT NULL DEFAULT 0,
  clicked             INTEGER NOT NULL DEFAULT 0,
  -- creation session this campaign was launched from, so delivery rolls up into
  -- the same outcome ledger as the site it markets
  session_id          UUID REFERENCES creation_sessions(id) ON DELETE SET NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_tenant_status ON marketing_campaigns(tenant_id, status, updated_at DESC);

-- One row per (campaign, recipient). The unique index is what makes a resumed /
-- retried send idempotent: a second pass cannot email the same person twice.
CREATE TABLE IF NOT EXISTS marketing_campaign_sends (
  id           BIGSERIAL PRIMARY KEY,
  campaign_id  INTEGER NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email        VARCHAR(320) NOT NULL,
  -- queued | sent | failed | suppressed
  status       VARCHAR(16) NOT NULL DEFAULT 'queued',
  error        TEXT,
  -- opaque per-recipient token used by the open pixel / click + unsubscribe links
  track_token  VARCHAR(64) NOT NULL,
  opened_at    TIMESTAMP,
  clicked_at   TIMESTAMP,
  sent_at      TIMESTAMP,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_marketing_sends_campaign_email ON marketing_campaign_sends(campaign_id, email);
CREATE UNIQUE INDEX IF NOT EXISTS uq_marketing_sends_token ON marketing_campaign_sends(track_token);
CREATE INDEX IF NOT EXISTS idx_marketing_sends_campaign_status ON marketing_campaign_sends(campaign_id, status);

-- site_collections.audience_id closes the loop: a form submission becomes an
-- audience member. Added after marketing_audiences exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_site_collections_audience'
  ) THEN
    ALTER TABLE site_collections
      ADD CONSTRAINT fk_site_collections_audience
      FOREIGN KEY (audience_id) REFERENCES marketing_audiences(id) ON DELETE SET NULL;
  END IF;
END $$;
