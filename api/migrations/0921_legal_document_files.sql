-- Secure legal documents — storage, sharing, and signing (ROADMAP FO-G, the
-- residual of 0469: the legal seat had tables and no way to hold a FILE).
--
-- `legal_document_files` is named to avoid the platform's existing
-- `legal_documents` (migration 0012 — Terms of Use / Privacy Policy versioning,
-- an unrelated, non-tenant-scoped concept). It holds no bytes itself:
-- `current_artifact_id` points at a `kernel.artifacts` row, sealed at rest by
-- `api/src/application/security/fileCrypto.ts` (AES-256-GCM, per-tenant key).
--
-- No `status` / `signed_at` column, deliberately — both are derived at read
-- time from `legal_document_shares` and the `signature_requests` row
-- `signature_request_id` points at, the same way `contract.signatureState` is
-- written FROM that join rather than stored as a second, driftable copy.

CREATE TABLE IF NOT EXISTS legal_document_files (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  object_id            uuid REFERENCES objects(id) ON DELETE SET NULL,
  entity_id            integer REFERENCES legal_entities(id) ON DELETE SET NULL,
  matter_id            integer REFERENCES legal_matters(id) ON DELETE SET NULL,
  ip_id                integer REFERENCES intellectual_property(id) ON DELETE SET NULL,
  title                varchar(255) NOT NULL,
  -- 'nda' | 'msa' | 'sow' | 'offer_letter' | 'ip_assignment' | 'formation' |
  -- 'registration' | 'other'.
  category             varchar(32) NOT NULL DEFAULT 'other',
  -- The sealed file. Re-uploading points this at a NEW artifacts row rather
  -- than overwriting one in place, so a completed signature keeps resolving to
  -- the exact bytes it was made against.
  current_artifact_id  uuid REFERENCES artifacts(id) ON DELETE SET NULL,
  signature_request_id integer REFERENCES signature_requests(id) ON DELETE SET NULL,
  created_by           varchar(64),
  created_at           timestamp NOT NULL DEFAULT now(),
  updated_at           timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_document_files_tenant ON legal_document_files (tenant_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_legal_document_files_entity ON legal_document_files (entity_id);
CREATE INDEX IF NOT EXISTS idx_legal_document_files_matter ON legal_document_files (matter_id);

-- A revocable link for an external counterparty (no account, no session) to
-- view or download one file. Third occurrence of the mint/hash/resolve shape
-- `signature_parties.tokenHash` and `form_recipients.tokenHash` already use —
-- now extracted once, in api/src/application/security/shareToken.ts.
CREATE TABLE IF NOT EXISTS legal_document_shares (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id      uuid NOT NULL REFERENCES legal_document_files(id) ON DELETE CASCADE,
  token_hash       varchar(64) NOT NULL,
  -- 'view' | 'download'.
  permission       varchar(16) NOT NULL DEFAULT 'view',
  recipient_email  varchar(320),
  expires_at       timestamp,
  revoked_at       timestamp,
  created_by       varchar(64),
  created_at       timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_document_shares_token ON legal_document_shares (token_hash);
CREATE INDEX IF NOT EXISTS idx_legal_document_shares_document ON legal_document_shares (document_id);

-- Let a signature request bind to a FILE instead of (or in addition to)
-- rendered text — additive to the existing text-only engine. `document_body`
-- was NOT NULL; a request now needs one or the other, enforced by the CHECK
-- below rather than by the column alone.
ALTER TABLE signature_requests ALTER COLUMN document_body DROP NOT NULL;
ALTER TABLE signature_requests ADD COLUMN IF NOT EXISTS document_artifact_id uuid REFERENCES artifacts(id) ON DELETE SET NULL;
ALTER TABLE signature_requests ADD COLUMN IF NOT EXISTS document_checksum varchar(64);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_signature_requests_document'
  ) THEN
    ALTER TABLE signature_requests
      ADD CONSTRAINT chk_signature_requests_document
      CHECK (document_body IS NOT NULL OR document_artifact_id IS NOT NULL);
  END IF;
END $$;
