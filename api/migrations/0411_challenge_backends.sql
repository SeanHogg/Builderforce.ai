-- Challenge pipeline + server-side backends for canvas-authored systems.
--
-- WHY: the platform could take a project from brief to a PUBLISHED SITE, but a
-- published site is static assets in R2. Every interesting system a customer is
-- asked to build — the Twilio contest brief that prompted this is the canonical
-- example — is WEBHOOK-DRIVEN: an inbound SMS, an IVR leg on a live call, a
-- WhatsApp reply, a delivery-status callback. There was nowhere for a request
-- handler to run, no per-project place to keep the credentials it needs, and no
-- front door that turns a pasted brief into a plan the platform can execute.
--
-- Three tables, one per missing piece:
--   • project_secrets  — the credentials a project's own backend runs with.
--   • project_backends — WHERE that backend runs (the hosting-strategy binding)
--                        and the public ingress token webhooks are delivered to.
--   • challenges       — the pasted brief, its extracted requirements, the plan
--                        the platform derived, and what it built from it.

-- ---------------------------------------------------------------------------
-- project_secrets — a project's own credential vault
-- ---------------------------------------------------------------------------
-- Deliberately SEPARATE from connector_connections. A connection is "the tenant's
-- production Slack, callable by agents"; a project secret is "the value THIS
-- project's deployed backend runs with" (a Twilio auth token the webhook verifier
-- needs, a signing key, a partner API key). They have different lifetimes,
-- different blast radius and different readers, and collapsing them would mean a
-- deployed project backend could read every credential the tenant owns.
--
-- Values are AES-256-GCM sealed with the per-tenant derived key
-- (application/integrations/credentialCrypto) — the SAME sealing every other
-- credential store uses, so there is one key-derivation contract in the platform.
CREATE TABLE IF NOT EXISTS project_secrets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Env-var style key: [A-Z0-9_]. Enforced in the application so the constraint
  -- can be tightened without a migration.
  name           VARCHAR(128) NOT NULL,
  value_enc      TEXT NOT NULL,
  iv             VARCHAR(64) NOT NULL,
  -- Free-text note shown in the UI next to the masked value.
  description    TEXT,
  -- The last 4 characters of the plaintext, so the UI can render `••••1a2b` and
  -- a human can tell WHICH token is stored without the value ever being read back.
  hint           VARCHAR(8),
  created_by_user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_project_secrets_project_name UNIQUE (project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_project_secrets_project ON project_secrets (project_id);

-- ---------------------------------------------------------------------------
-- project_backends — where a project's server-side half runs
-- ---------------------------------------------------------------------------
-- One row per project. `strategy` names a BackendHostingStrategy
-- (application/backend/hostingStrategy.ts):
--   'declarative'   — handlers/*.json in the canvas, executed by THIS worker at
--                     /hooks/<ingress_token>/<route>. Zero setup, no user cloud
--                     account, safe (no arbitrary code is evaluated).
--   'github-worker' — a real Cloudflare Worker generated into the user's repo and
--                     deployed by a generated Action to the USER's account.
-- The port exists so the ingress, the secret vault and the Twilio verification
-- are written once and neither adapter is throwaway.
--
-- `ingress_token` is the unguessable public path segment webhooks are delivered
-- to. It is NOT a bearer secret — provider signature verification (per handler
-- `verify`) is the real authentication; the token only stops enumeration of other
-- tenants' projects.
CREATE TABLE IF NOT EXISTS project_backends (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  strategy       VARCHAR(32) NOT NULL DEFAULT 'declarative',
  status         VARCHAR(16) NOT NULL DEFAULT 'active',
  ingress_token  VARCHAR(48) NOT NULL UNIQUE,
  -- Where the running backend lives once deployed (the user's workers.dev URL for
  -- 'github-worker'; null for 'declarative', whose URL is derived from the token).
  deployed_url   VARCHAR(500),
  last_deployed_at TIMESTAMP,
  -- Denormalised count of handler files last materialised, for the UI.
  handler_count  INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_backends_tenant ON project_backends (tenant_id);

-- One row per inbound webhook delivery. This is the "did Twilio actually reach
-- us, and what did we say back?" trail — without it, debugging an IVR that hangs
-- up means reading the provider's console. Bodies are NOT stored (they carry
-- customer PII and message content); the shape, verdict and timing are.
CREATE TABLE IF NOT EXISTS project_backend_requests (
  id             BIGSERIAL PRIMARY KEY,
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  route          VARCHAR(255) NOT NULL,
  method         VARCHAR(8) NOT NULL,
  status_code    INTEGER NOT NULL,
  -- 'ok' | 'unverified' | 'no-handler' | 'error'
  verdict        VARCHAR(24) NOT NULL,
  duration_ms    INTEGER,
  error          TEXT,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_backend_requests_project_time
  ON project_backend_requests (project_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- challenges — a pasted brief, and everything the platform derived from it
-- ---------------------------------------------------------------------------
-- The generic front door: a customer pastes a contest/RFP/brief (the Twilio trial
-- email, a hackathon prompt, a partner's integration challenge) and the platform
-- extracts what winning REQUIRES, matches it to a blueprint, and builds it.
--
-- `spec` is the extracted, structured requirement set; `plan` is what the platform
-- decided to build (files, handlers, tasks, readiness gaps). Both are stored so a
-- challenge is re-openable and auditable — "why did it build that?" is answerable
-- without re-running the model.
CREATE TABLE IF NOT EXISTS challenges (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Set once the challenge is BUILT; null while it is only parsed + planned.
  project_id     INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  title          VARCHAR(255) NOT NULL,
  -- Who set the challenge (Twilio, a hackathon, an RFP issuer). Display only.
  sponsor        VARCHAR(255),
  brief          TEXT NOT NULL,
  spec           JSONB NOT NULL DEFAULT '{}'::jsonb,
  plan           JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Blueprint the plan was derived from ('twilio-omnichannel', 'generic', …).
  blueprint_key  VARCHAR(64),
  -- 'parsed' → 'planned' → 'building' → 'built' → 'failed'
  status         VARCHAR(16) NOT NULL DEFAULT 'parsed',
  error          TEXT,
  created_by_user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_challenges_tenant_time ON challenges (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_challenges_project ON challenges (project_id);
