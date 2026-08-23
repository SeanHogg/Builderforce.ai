-- 1116 · The external MCP client becomes a REAL MCP client: spec transport,
--        per-tool consent, and a three-legged OAuth grant per server.
--
-- `tenant_mcp_extensions` was written against a Builderforce-shaped contract —
-- `GET {server_url}/tools`, `POST {server_url}/call`, one static bearer — which no
-- third-party MCP server implements. So "register an MCP server" only ever worked
-- for a server somebody wrote for us, and the roadmap entry that called this "not
-- real MCP" was right. Three columns' worth of state was missing before the real
-- protocol could be spoken.
--
-- ── 1 · WHICH TRANSPORT THIS SERVER SPEAKS ─────────────────────────────────
-- `auto` probes JSON-RPC (`initialize` → `tools/list`) and falls back to the legacy
-- REST shape, then REMEMBERS what answered, so the probe is paid once per server
-- rather than on every catalog load. Existing rows start at `auto` and settle
-- themselves on first use; nothing has to be migrated by hand.
ALTER TABLE tenant_mcp_extensions
  ADD COLUMN IF NOT EXISTS protocol varchar(16) NOT NULL DEFAULT 'auto';

-- ── 2 · PER-TOOL CONSENT ───────────────────────────────────────────────────
-- Registering a server meant granting EVERY tool it advertises, for ever — and an
-- external server can add a tool after the fact, so consent granted on Monday was
-- silently broader on Tuesday. A JSON array of the tool names the tenant approved
-- narrows that; NULL keeps today's meaning (all tools), so no row changes behaviour
-- until an owner chooses. Enforced on BOTH the advertise and the call side, because
-- a filter only the catalog respects is a suggestion.
ALTER TABLE tenant_mcp_extensions
  ADD COLUMN IF NOT EXISTS allowed_tools jsonb;

-- ── 3 · THE OAUTH GRANT ────────────────────────────────────────────────────
-- MCP's authorization spec is three-legged: the server points at an authorization
-- server, we register as a client (RFC 7591 dynamic client registration) and the
-- HUMAN consents in their browser. Two sealed blobs, because they have two
-- lifetimes and two meanings:
--
--   oauth_enc/oauth_iv — the client REGISTRATION: discovered endpoints, the
--     client id/secret this deployment registered, and the in-flight PKCE
--     verifier. Written when a connect starts; survives every token refresh.
--   token_enc/token_iv — the GRANT itself (access + refresh token), sealed by
--     `application/integrations/oauthTokenVault`, exactly as mailbox, drive and
--     calendar connections store theirs. Rewritten on every refresh.
--
-- Both are sealed with the tenant's derived key (AES-GCM, `credentialCrypto`), so
-- a refresh token — the long-lived half — is never at rest in plaintext. The
-- static `secret_enc` bearer stays: a server that wants a fixed token still works,
-- and a row uses whichever it has (grant wins).
ALTER TABLE tenant_mcp_extensions ADD COLUMN IF NOT EXISTS oauth_enc text;
ALTER TABLE tenant_mcp_extensions ADD COLUMN IF NOT EXISTS oauth_iv  text;
ALTER TABLE tenant_mcp_extensions ADD COLUMN IF NOT EXISTS token_enc text;
ALTER TABLE tenant_mcp_extensions ADD COLUMN IF NOT EXISTS token_iv  text;

-- When a human completed the consent. Also the honest answer to "is this server
-- connected?" on the portal — a row can hold a stale registration with no grant.
ALTER TABLE tenant_mcp_extensions
  ADD COLUMN IF NOT EXISTS oauth_connected_at timestamptz;
