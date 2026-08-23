-- 1117 · Tax reporting: where a payee's W-9/W-8 facts live, where the tax ID
--        itself lives, and the one index that makes a year-end scan possible.
--
-- A platform that pays people must be able to produce a 1099. Three shapes were
-- missing, and NONE of them is a new table — that is the point of the migration.
--
-- ── 1 · THE TAX PROFILE IS A ROLE, NOT A TABLE ──────────────────────────────
-- The obvious move is `payout_tax_profiles (user_id, legal_name, address…)`.
-- It is wrong for the reason PRD 20 §4 already argued nineteen times: a tax
-- profile is a set of facts about A PERSON HOLDING THE PAYEE ROLE, which is
-- exactly `party_roles`. That table already carries `uq_party_roles_role`
-- (tenant, party_kind, party_ref, role), so "one tax profile per person per
-- workspace" is enforced by an index that already exists, and the non-secret
-- W-9 facts (entity type, legal name, address, residency, form type, tax-id
-- TYPE and last four) are exactly what `attrs` is for.
--
-- So this migration adds NO DDL for the profile at all. `role = 'payee'` is a
-- column VALUE. The comment below is the whole change, and it is here so the
-- next reader does not add the table.
COMMENT ON COLUMN party_roles.role IS
  'candidate | employee | freelancer | investor | partner | seller | recruiter | '
  'customer | vendor | contact | payee. ''payee'' carries the W-9/W-8 tax profile '
  'in attrs (entity_type, legal_name, business_name, address_*, tax_residency_country, '
  'tax_id_type, tax_id_last4, tax_form_type, form_submitted_at). The tax ID ITSELF is '
  'never here — it is a sealed credentials row with purpose = ''tax_id'' (migration 1117).';

-- ── 2 · A CREDENTIAL THAT BELONGS TO A SUBJECT, NOT A CONNECTION ────────────
-- A tax ID is the worst possible fact to store twice, so it does not get a
-- column on the profile: it goes into `credentials`, the one encrypted store,
-- sealed by the same per-tenant AES-256-GCM `credentialCrypto` every connection
-- uses. That keeps ciphertext out of the hot profile read for free — the split
-- `credentials` already makes for the same reason.
--
-- Anchoring it on the payout `connections` row was considered and rejected: a
-- W-9 can be submitted before any payout destination exists, and one person may
-- hold several destinations. The secret belongs to the PERSON.
--
-- Which exposes a live defect. `credentials.connection_id` is NULLABLE, and
-- `uq_credentials_purpose` is (tenant_id, connection_id, purpose) — in Postgres
-- two NULLs are DISTINCT in a unique index, so a connection-less credential has
-- no uniqueness at all. Today nothing writes one; the moment this does, a
-- retried W-9 submission would insert a SECOND sealed tax ID and every later
-- read would pick one of them arbitrarily.
--
-- The fix is a subject column plus TWO partial indexes that cannot fight: the
-- existing one keeps connection-owned rows unique and now excludes the NULLs it
-- never constrained anyway, and the new one makes (tenant, subject, purpose)
-- unique for exactly the rows the old one could not see. A new owner KIND is a
-- column value, not a new table.
ALTER TABLE credentials ADD COLUMN IF NOT EXISTS subject_ref varchar(64);

COMMENT ON COLUMN credentials.subject_ref IS
  'Who the secret belongs to when it belongs to nobody''s connection — a user id for '
  'purpose = ''tax_id''. Exactly one of connection_id / subject_ref is set, and each '
  'has its own partial unique index because a single index over a nullable column '
  'enforces nothing on the NULL side.';

DROP INDEX IF EXISTS uq_credentials_purpose;
CREATE UNIQUE INDEX IF NOT EXISTS uq_credentials_purpose
  ON credentials (tenant_id, connection_id, purpose)
  WHERE connection_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_credentials_subject_purpose
  ON credentials (tenant_id, subject_ref, purpose)
  WHERE connection_id IS NULL AND subject_ref IS NOT NULL;

-- ── 3 · READING A CALENDAR YEAR OF PAYOUTS FOR EVERY RECIPIENT ──────────────
-- The 1099 report groups `ledger_entries` by `account_ref` across a whole year
-- for ALL recipients. `idx_ledger_entries_account` leads with account_kind +
-- account_ref, so it can answer "this person's payouts" and cannot answer "every
-- person's payouts this year" — that query has no account predicate to lead
-- with and falls to a sequential scan of the entire ledger, which is the table
-- that grows fastest on the platform.
--
-- Partial to `entry_kind = 'payout'` because money that MOVED is a small
-- minority of ledger rows beside every grant, spend and hold.
CREATE INDEX IF NOT EXISTS idx_ledger_entries_payout_year
  ON ledger_entries (tenant_id, denomination, occurred_at)
  WHERE entry_kind = 'payout';
