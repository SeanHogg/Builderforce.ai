-- Institutional SSO — and the decision about SAML, recorded where it is enforced.
--
-- Universities authenticate through an institutional IdP (Shibboleth/InCommon,
-- Microsoft Entra, Okta) and procurement does not begin without it. LTI 1.3 gets
-- the tool into the LMS; SSO is what gets it past the security review. The tool
-- half of SAML 2.0 is straightforward — SP metadata, an `AuthnRequest` over
-- HTTP-Redirect, an ACS endpoint. The part that is not is VERIFYING THE SIGNED
-- RESPONSE: exclusive XML canonicalisation plus reference-digest validation
-- before the RSA check, where a C14N or reference-resolution mistake is an XML
-- signature-wrapping authentication bypass — a defect that looks exactly like a
-- working login until somebody forges an assertion.
--
-- ── THE DECISION ────────────────────────────────────────────────────────────
-- SAML is TERMINATED AT AN IDENTITY PROVIDER THAT ALREADY SPEAKS IT, and only
-- OIDC runs in this process. The register offered this as one of two ways to
-- clear the blocker and it is the one taken, for a reason that does not weaken
-- with time: hand-rolling xmldsig on Workers means owning an
-- authentication-bypass surface forever, in exchange for removing one vendor from
-- a path that already has one at every other identity boundary the platform has.
--
-- What this buys the institution is unchanged: their Shibboleth/InCommon IdP
-- speaks SAML to the SSO gateway (WorkOS, Auth0, Okta, Entra — the choice is the
-- customer's, not ours), and the gateway speaks OIDC to us. What it buys us is
-- that every signature this codebase verifies is RS256 over a JWS, which is the
-- primitive WebCrypto implements natively and which `LtiService.ts` and
-- `githubOidc.ts` already verify the same way.
--
-- `protocol` is a column rather than an assumption so the decision is legible in
-- the data and a future direct-SAML connection is a value, not a schema change.
-- Only 'oidc' is accepted by the application today, and it says so when refused.
--
-- ── WHY DOMAINS ARE A TABLE AND `deployment_ids` IS NOT ────────────────────
-- Because this one is QUERIED ACROSS ROWS: "which connection owns
-- `physics.edu`" is the first thing the login page asks, on every sign-in
-- attempt. A jsonb array would make that a scan; a child table with a unique
-- index on the domain makes it a lookup AND makes "one domain belongs to exactly
-- one connection" a constraint instead of a convention nobody enforces.
CREATE TABLE IF NOT EXISTS sso_connections (
  id                 serial PRIMARY KEY,
  tenant_id          integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- What an administrator recognises: "University of Melbourne (Okta)".
  label              varchar(160) NOT NULL,
  -- 'oidc' only, today. See the note above — the column records the decision.
  protocol           varchar(16) NOT NULL DEFAULT 'oidc',
  issuer             varchar(255) NOT NULL,
  -- When set, the four endpoints below are read from the IdP's own discovery
  -- document instead of being typed. Typed values win, so a provider with a
  -- broken discovery document is still connectable.
  discovery_url      text,
  authorization_url  text,
  token_url          text,
  jwks_url           text,
  userinfo_url       text,
  client_id          varchar(255) NOT NULL,
  -- The credentialCrypto envelope, exactly as lti_registrations does it.
  client_secret_enc  text NOT NULL,
  client_secret_iv   varchar(32) NOT NULL,
  scopes             varchar(255) NOT NULL DEFAULT 'openid email profile',
  -- Whether an unknown person from a verified domain gets an account on first
  -- sign-in. Off means the IdP authenticates them and we still refuse, which is
  -- what an institution that provisions by hand asks for.
  jit_provisioning   boolean NOT NULL DEFAULT true,
  default_role       varchar(32) NOT NULL DEFAULT 'developer',
  status             varchar(16) NOT NULL DEFAULT 'active',
  created_by         varchar(64),
  created_at         timestamp NOT NULL DEFAULT now(),
  updated_at         timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sso_connections_issuer_client
  ON sso_connections (issuer, client_id);
CREATE INDEX IF NOT EXISTS idx_sso_connections_tenant
  ON sso_connections (tenant_id, status);

-- One email domain routes to exactly one connection. The unique index is the
-- rule: two workspaces both claiming `example.edu` would make "where do I send
-- this person" ambiguous, and an ambiguous answer at an auth boundary is chosen
-- arbitrarily rather than refused.
CREATE TABLE IF NOT EXISTS sso_domains (
  id            serial PRIMARY KEY,
  tenant_id     integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id integer NOT NULL REFERENCES sso_connections(id) ON DELETE CASCADE,
  domain        varchar(255) NOT NULL,
  -- Set when the workspace has proved it controls the domain. An UNVERIFIED
  -- domain never routes: otherwise anyone could claim `harvard.edu` and take
  -- over every sign-in from it.
  verified_at   timestamp,
  -- The DNS TXT value that proves it. Random per row, never derived from the
  -- domain, so it cannot be guessed from the name.
  verify_token  varchar(64) NOT NULL,
  created_at    timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sso_domains_domain ON sso_domains (domain);
CREATE INDEX IF NOT EXISTS idx_sso_domains_connection ON sso_domains (connection_id);

COMMENT ON TABLE sso_connections IS
  'Enterprise SSO connections. OIDC only, deliberately: SAML is terminated at an IdP gateway that already speaks it rather than verified in-process, because hand-rolled xmldsig is an XML signature-wrapping bypass waiting to happen. See migration 0482.';
COMMENT ON COLUMN sso_connections.protocol IS
  'oidc. The column exists so the SAML decision is legible in the data; the application refuses any other value and says why.';
COMMENT ON TABLE sso_domains IS
  'Email domain → SSO connection. Unique on domain platform-wide, and only a VERIFIED row routes — an unverified claim on a domain is a takeover of every sign-in from it.';
