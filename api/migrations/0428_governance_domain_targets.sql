-- 0428_governance_domain_targets.sql
--
-- Governance domain targets
--
-- GENERATED from src/infrastructure/database/schema/governance.ts by
-- scripts/gen-consolidation-migration.mjs (PRD 20 §5 step 2). Edit the Drizzle
-- module and regenerate; do not hand-edit the DDL, or the two sources of truth
-- this file exists to collapse come straight back.
--
-- 2 table(s). Idempotent: replayable against an environment at any
-- point in the sequence.

CREATE TABLE IF NOT EXISTS legal_document_acceptances (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  document_kind VARCHAR(32) NOT NULL,
  document_version VARCHAR(32) NOT NULL,
  document_hash VARCHAR(64),
  party_kind VARCHAR(16) NOT NULL DEFAULT 'user',
  party_ref VARCHAR(64) NOT NULL,
  email VARCHAR(320),
  accepted_at TIMESTAMP NOT NULL DEFAULT NOW(),
  ip_address VARCHAR(45),
  user_agent VARCHAR(500),
  superseded_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_document_acceptances_party ON legal_document_acceptances (party_kind, party_ref, document_kind, document_version);
CREATE INDEX IF NOT EXISTS idx_legal_document_acceptances_tenant ON legal_document_acceptances (tenant_id, document_kind, accepted_at);

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  user_ref VARCHAR(64),
  purpose VARCHAR(16) NOT NULL,
  challenge VARCHAR(255) NOT NULL,
  rp_id VARCHAR(255),
  consumed_at TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  ip_address VARCHAR(45),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_webauthn_challenges_challenge ON webauthn_challenges (challenge);
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expiry ON webauthn_challenges (expires_at);

-- Tenancy foreign keys (PRD 20 §4 — every table carries tenant_id).
ALTER TABLE legal_document_acceptances DROP CONSTRAINT IF EXISTS fk_legal_document_acceptances_tenant;
ALTER TABLE legal_document_acceptances ADD CONSTRAINT fk_legal_document_acceptances_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE webauthn_challenges DROP CONSTRAINT IF EXISTS fk_webauthn_challenges_tenant;
ALTER TABLE webauthn_challenges ADD CONSTRAINT fk_webauthn_challenges_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
