-- 0953 — give a BYO credential an IDENTITY, so usage can name the key that paid.
--
-- ── WHAT COULD NOT BE ANSWERED ──────────────────────────────────────────────
-- `tenant_llm_provider_keys` is keyed `(tenant_id, provider)` and written with
-- `ON CONFLICT DO UPDATE`. A rotated key therefore overwrites its predecessor IN
-- PLACE: same row, same key, new ciphertext. And `llm_usage_log.byo_provider` is a
-- denormalized string with no reference to it at all. Between them, three questions
-- had no answer:
--   • WHICH key instance paid for this call? (rotation is invisible)
--   • Was this spend on a SUBSCRIPTION or a static API key? (`auth_type` lives on
--     the credential row, which nothing links to)
--   • What did the key I just rotated away from actually cost me?
-- The insights breakdown was consequently per-INTEGRATION, never per-key-instance.
--
-- ── TWO COLUMNS ─────────────────────────────────────────────────────────────
-- `tenant_llm_provider_keys.id` — a surrogate uuid. The composite primary key is
-- deliberately LEFT ALONE: it is what makes the upsert an upsert, and every reader
-- and writer in the service is built on it. The surrogate is an additional identity,
-- not a replacement. It is minted fresh whenever the stored key MATERIAL changes
-- (see `setTenantProviderKey`), which is what makes it identify a key INSTANCE
-- rather than a slot — a rotation retires one id and starts another, and historical
-- usage keeps pointing at the one that actually paid.
--
-- `llm_usage_log.byo_credential_id` — the usage-side reference. A BARE UUID with no
-- REFERENCES clause: the usage log is written through `resolveUsageDatabase`, which
-- targets a separate Neon account whenever NEON_TRANSACTIONAL_DATABASE_URL is bound,
-- and PostgreSQL cannot enforce a foreign key across accounts. Same rule the rest of
-- the operational ledger follows for `tenant_id`. It is also intentionally NOT
-- cascading: when a credential is deleted, its historical spend must stay attributed
-- to the id that incurred it, or deleting a key would rewrite last month's numbers.
--
-- `byo_provider` KEEPS its meaning (the integration a row belongs to) and is not
-- replaced. The two answer different questions — "which connected account" vs "which
-- instance of its credential" — and collapsing them would lose the first the moment
-- a key is rotated.
--
-- TWO TRACKS, DELIBERATELY: the operational twin is
-- transactional-migrations/0008_byo_credential_identity.sql. `llm_usage_log` exists
-- on both, `tenant_llm_provider_keys` only on the primary.

ALTER TABLE tenant_llm_provider_keys
  ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();

-- Unique, not primary: the composite PK stays the upsert target. This makes the
-- surrogate a real identity that a usage row can name without ambiguity.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_llm_provider_keys_id
  ON tenant_llm_provider_keys (id);

ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS byo_credential_id UUID;

-- The per-key consumption read: "this credential instance's usage over a window".
CREATE INDEX IF NOT EXISTS idx_llm_usage_byo_credential
  ON llm_usage_log (byo_credential_id, created_at DESC)
  WHERE byo_credential_id IS NOT NULL;
