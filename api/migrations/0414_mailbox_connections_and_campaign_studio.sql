-- 0414_mailbox_connections_and_campaign_studio.sql
--
-- Closes the gap between "a tenant has a mailbox" and "a tenant can market from
-- it". Before this, marketing could only send through the PLATFORM's provider
-- (Resend/SendPulse) from a DNS-verified domain — a tenant whose whole mail life
-- already lives in Microsoft 365 or Gmail had to publish a TXT record and send
-- from a second, unfamiliar pipe, and could not read their own inbox at all.
--
-- Four things, one migration because they are one journey (connect → read →
-- compose → send):
--
--   A. mailbox_connections  — an OAuth grant on a real mailbox (Microsoft Graph
--      or Gmail). Tokens are SEALED with the shared per-tenant AES-256-GCM
--      credential crypto, unlike calendar_connections (0292), which stores them
--      in plaintext columns. That is the outlier; this is the standard.
--   B. marketing_templates  — reusable subject + HTML. A campaign body was a
--      free-text blob retyped per send, so nothing could be reused or imported.
--   C. marketing_assets     — logos and images, stored in R2 and addressed by an
--      unguessable PUBLIC token. An email is read outside any session, so an
--      authenticated asset URL renders as a broken image in every inbox.
--   D. marketing_campaigns  — a `transport` discriminator plus the three columns
--      that make each transport resolvable. The engine previously hard-bound to
--      the platform sender; the column is what lets one campaign go out through
--      a tenant's own mailbox or their Twilio SendGrid key instead.
--
-- Idempotent / re-runnable throughout. NON-transactional for consistency with the
-- rest of migrations/ (no `ALTER TYPE … ADD VALUE` here, so ordering is moot).

-- ---------------------------------------------------------------------------
-- A · mailbox_connections — an OAuth grant on a real mailbox
-- ---------------------------------------------------------------------------
-- Scoped to (tenant, user, provider, account) rather than to the tenant alone:
-- a mailbox is a PERSON's, and two colleagues connecting the same workspace must
-- not overwrite each other's grant. `account_email` is part of the uniqueness key
-- so one user may connect several mailboxes of the same provider.
--
-- `token_enc` / `token_iv` hold the sealed `{accessToken, refreshToken, expiresAt,
-- scope}` blob (application/integrations/credentialCrypto.ts, v2 per-tenant salt).
-- Nothing readable is stored: `expires_at` is duplicated OUTSIDE the blob only so
-- the refresh sweep can find stale rows without decrypting every one of them.
CREATE TABLE IF NOT EXISTS mailbox_connections (
  id              SERIAL PRIMARY KEY,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- The connecting user. VARCHAR to match users.id across this schema.
  user_id         VARCHAR(64) NOT NULL,
  -- 'microsoft' | 'google'
  provider        VARCHAR(24) NOT NULL,
  account_email   VARCHAR(320) NOT NULL,
  display_name    VARCHAR(255) NOT NULL DEFAULT '',
  -- sealed { accessToken, refreshToken, expiresAt, scope } — never a bare token
  token_enc       TEXT NOT NULL,
  token_iv        VARCHAR(64) NOT NULL,
  -- mirror of the sealed expiry, so the refresher can select without decrypting
  expires_at      TIMESTAMP,
  scope           TEXT NOT NULL DEFAULT '',
  -- 'connected' | 'expired' | 'revoked'. Set to 'revoked' when the provider
  -- rejects the refresh token, so the UI can say "reconnect" instead of failing
  -- every send with an opaque 401.
  status          VARCHAR(16) NOT NULL DEFAULT 'connected',
  last_error      TEXT,
  last_synced_at  TIMESTAMP,
  -- FALSE hides the mailbox from campaign sending while leaving it readable —
  -- a shared inbox you want on the canvas but must never blast a campaign from.
  allow_sending   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mailbox_connections_account
  ON mailbox_connections(tenant_id, user_id, provider, account_email);
CREATE INDEX IF NOT EXISTS idx_mailbox_connections_tenant ON mailbox_connections(tenant_id, status);
-- The refresh sweep's access path: soonest-expiring live rows first.
CREATE INDEX IF NOT EXISTS idx_mailbox_connections_expiry
  ON mailbox_connections(expires_at) WHERE status = 'connected';

-- ---------------------------------------------------------------------------
-- B · marketing_templates — reusable subject + HTML
-- ---------------------------------------------------------------------------
-- `source` records provenance because it changes how the body is treated:
--   'builtin'  — shipped starter, seeded per tenant on first read, editable
--   'custom'   — authored in the app
--   'imported' — pasted/uploaded HTML from outside, so it is SANITIZED on write
--                (script/iframe/on* handlers stripped) rather than trusted
--   'generated'— authored by an agent
CREATE TABLE IF NOT EXISTS marketing_templates (
  id           SERIAL PRIMARY KEY,
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         VARCHAR(255) NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  subject      VARCHAR(500) NOT NULL DEFAULT '',
  body_html    TEXT NOT NULL DEFAULT '',
  source       VARCHAR(16) NOT NULL DEFAULT 'custom',
  -- logo/hero asset this template renders through {{logo}}; SET NULL so deleting
  -- an asset degrades the template to "no logo" rather than deleting the template.
  asset_id     INTEGER,
  -- merge fields the body actually references, computed on write. The composer
  -- uses it to tell an author which columns their audience must carry.
  merge_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by   VARCHAR(64),
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_marketing_templates_tenant_name ON marketing_templates(tenant_id, name);
CREATE INDEX IF NOT EXISTS idx_marketing_templates_tenant ON marketing_templates(tenant_id, updated_at DESC);

-- ---------------------------------------------------------------------------
-- C · marketing_assets — logos and images an email can actually load
-- ---------------------------------------------------------------------------
-- The bytes live in R2 (the existing UPLOADS bucket) under the tenant-prefixed
-- key convention; only the pointer is a row. `public_token` is the whole access
-- model: a recipient's mail client has no session, so the asset is served by an
-- unguessable token at a public route and by NOTHING else. Rotating the token
-- (not deleting the row) is how an asset is un-published.
CREATE TABLE IF NOT EXISTS marketing_assets (
  id            SERIAL PRIMARY KEY,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          VARCHAR(255) NOT NULL,
  -- 'logo' | 'image'. A tenant's logo is singled out because templates reference
  -- it by role ({{logo}}), not by id — swapping the logo must not edit N templates.
  kind          VARCHAR(16) NOT NULL DEFAULT 'image',
  -- R2 object key under the UPLOADS bucket, `${tenant_id}/marketing/...`
  r2_key        VARCHAR(512) NOT NULL,
  mime_type     VARCHAR(128) NOT NULL DEFAULT 'image/png',
  byte_size     INTEGER NOT NULL DEFAULT 0,
  width         INTEGER,
  height        INTEGER,
  -- 'uploaded' | 'generated' — a generated logo keeps the prompt for re-rolls
  source        VARCHAR(16) NOT NULL DEFAULT 'uploaded',
  prompt        TEXT,
  -- unguessable; the ONLY thing that authorizes a public read
  public_token  VARCHAR(64) NOT NULL,
  created_by    VARCHAR(64),
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_marketing_assets_token ON marketing_assets(public_token);
CREATE INDEX IF NOT EXISTS idx_marketing_assets_tenant ON marketing_assets(tenant_id, kind, updated_at DESC);

-- marketing_templates.asset_id closes the loop, added after the table exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_marketing_templates_asset'
  ) THEN
    ALTER TABLE marketing_templates
      ADD CONSTRAINT fk_marketing_templates_asset
      FOREIGN KEY (asset_id) REFERENCES marketing_assets(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- D · marketing_campaigns — how this campaign leaves the building
-- ---------------------------------------------------------------------------
-- One discriminator plus one nullable pointer per transport, rather than a
-- polymorphic id column: each transport has a different owning table and a
-- different precondition, and a single untyped `sender_ref` would make the
-- "is this campaign sendable?" check unwriteable in SQL.
--
--   'platform' (default, existing behaviour) → sender_identity_id, DNS-verified
--   'mailbox'                                → mailbox_connection_id, OAuth grant
--   'sendgrid'                               → connector_connection_id, the
--                                              tenant's Twilio SendGrid key
--
-- Existing rows keep sending exactly as before: the DEFAULT is 'platform' and
-- every current campaign already carries a sender_identity_id.
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS transport              VARCHAR(16) NOT NULL DEFAULT 'platform';
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS mailbox_connection_id  INTEGER;
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS connector_connection_id UUID;
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS template_id            INTEGER;
-- The From: shown to a recipient when the transport is not the platform sender.
-- Denormalized on purpose: it is a HISTORICAL fact about what was delivered, and
-- must not change if the mailbox is later renamed or disconnected.
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS from_name              VARCHAR(255) NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_marketing_campaigns_mailbox'
  ) THEN
    ALTER TABLE marketing_campaigns
      ADD CONSTRAINT fk_marketing_campaigns_mailbox
      FOREIGN KEY (mailbox_connection_id) REFERENCES mailbox_connections(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_marketing_campaigns_template'
  ) THEN
    ALTER TABLE marketing_campaigns
      ADD CONSTRAINT fk_marketing_campaigns_template
      FOREIGN KEY (template_id) REFERENCES marketing_templates(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_marketing_campaigns_connector_connection'
  ) THEN
    ALTER TABLE marketing_campaigns
      ADD CONSTRAINT fk_marketing_campaigns_connector_connection
      FOREIGN KEY (connector_connection_id) REFERENCES connector_connections(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_transport
  ON marketing_campaigns(tenant_id, transport, status);

-- ---------------------------------------------------------------------------
-- E · marketing_campaign_sends.attempts — the bound on retrying
-- ---------------------------------------------------------------------------
-- With one transport there was nothing to retry: a send either worked or the row
-- was `failed` forever. A tenant's own mailbox and a third-party API BOTH answer
-- 429 under load, and burning a recipient on a rate limit means the campaign
-- silently under-delivers — so a retryable failure now returns the row to
-- `queued` for the next sweep.
--
-- Which makes this column load-bearing rather than telemetry: without a counter,
-- an error we merely MISCLASSIFIED as retryable would requeue forever and the
-- campaign would never reach `sent`. The engine gives up at
-- CAMPAIGN_SEND_MAX_ATTEMPTS (campaignEngine.ts) and writes a `failed` row.
ALTER TABLE marketing_campaign_sends ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
