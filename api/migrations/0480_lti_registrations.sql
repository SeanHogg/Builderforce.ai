-- Adding a university was `wrangler secret put`. Now it is a screen.
--
-- LTI 1.3 platform registrations lived in the `LTI_REGISTRATIONS` JSON secret,
-- and the reason given was a real one: a registration holds an RSA PRIVATE KEY,
-- and the generic entity layer serves every table it knows through one reader
-- whose redaction is column-name-pattern based. Betting a signing key on a regex
-- matching `tool_private_key_jwk` is a bet that subsystem should not make.
--
-- ── WHY THAT REASON DOES NOT APPLY ANY MORE ────────────────────────────────
-- Because the key does not go in a column the reader could serve. It goes in the
-- SAME envelope every other secret on the platform already uses —
-- `credentialCrypto.ts`, AES-256-GCM under a PBKDF2 key derived per TENANT — so
-- what this table stores is ciphertext plus an IV, and a generic projection that
-- forgot to redact `tool_private_key_enc` would emit a base64 blob that is
-- useless without `CREDENTIAL_ENCRYPTION_SECRET`. The property the secret store
-- gave (a signing key that a read path cannot hand out) is preserved by
-- encryption instead of by absence, which is the same trade
-- `integration_credentials` and `oauth_token_vault` already make.
--
-- The consequences of the secret were not free: adding an institution required a
-- deploy-time operation by whoever holds Cloudflare credentials, key rotation was
-- manual, and nothing recorded WHO added a registration or when. Those are the
-- three things procurement asks about.
--
-- ── WHY (issuer, client_id) IS THE KEY ─────────────────────────────────────
-- One platform (one issuer — `https://canvas.instructure.com` is shared by every
-- Canvas Cloud institution) hosts many tools and many deployments. `issuer` alone
-- would let one institution's LMS launch into another's boards. `deployment_ids`
-- rides as jsonb rather than a child table because it is a closed list read in
-- full on every launch and never queried across rows — a `lti_deployments` table
-- would be a join for a membership test.
CREATE TABLE IF NOT EXISTS lti_registrations (
  id                    serial PRIMARY KEY,
  tenant_id             integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- What an administrator recognises. Never used for matching.
  label                 varchar(160) NOT NULL,
  issuer                varchar(255) NOT NULL,
  client_id             varchar(255) NOT NULL,
  deployment_ids        jsonb NOT NULL DEFAULT '[]'::jsonb,
  auth_login_url        text NOT NULL,
  access_token_url      text NOT NULL,
  key_set_url           text NOT NULL,
  -- Our own signing key. `tool_key_id` is published on /api/lti/jwks; the private
  -- half is the `credentialCrypto` envelope and nothing else.
  tool_key_id           varchar(64) NOT NULL,
  -- The PUBLIC half, in the clear and on purpose: /api/lti/jwks serves it to the
  -- world, and storing it beside the sealed private half is what keeps the
  -- decrypted key out of every read path that only needs to publish or match.
  -- It is DERIVED from the private key at write time rather than supplied, so the
  -- two cannot drift into an `invalid_client` nobody can debug.
  tool_public_jwk       jsonb NOT NULL,
  tool_private_key_enc  text NOT NULL,
  tool_private_key_iv   varchar(32) NOT NULL,
  -- 'active' | 'disabled'. Disabling is how a registration is retired without
  -- destroying the audit of the launches it authorised.
  status                varchar(16) NOT NULL DEFAULT 'active',
  created_by            varchar(64),
  created_at            timestamp NOT NULL DEFAULT now(),
  updated_at            timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lti_registrations_issuer_client
  ON lti_registrations (issuer, client_id);
CREATE INDEX IF NOT EXISTS idx_lti_registrations_tenant
  ON lti_registrations (tenant_id, status);

COMMENT ON TABLE lti_registrations IS
  'LTI 1.3 platform registrations. The tool private key is sealed in the credentialCrypto envelope (AES-256-GCM, per-tenant PBKDF2 key) — never plaintext, never served by the generic entity reader.';
COMMENT ON COLUMN lti_registrations.tool_private_key_enc IS
  'Ciphertext of {"jwk": <PKCS#8 JWK>} under credentialSecret(env) + tenant salt. Decryptable only by application/lti/LtiService.ts.';
COMMENT ON COLUMN lti_registrations.tool_public_jwk IS
  'The public half, derived from the private key at write time. Public by design — /api/lti/jwks is how the platform verifies our client assertion — and separate so no read path has to decrypt anything to publish or to match a launch.';
COMMENT ON COLUMN lti_registrations.deployment_ids IS
  'The deployment ids this registration authorises, as a JSON array of strings. A launch whose deployment is not listed is refused — one issuer hosts many institutions.';
