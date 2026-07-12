-- Migration 0286: Freelancer Payout System (Gap P0-2)
--
-- Goal: Wire an env-gated Stripe Connect payout integration so escrowed funds
-- are automatically released to freelancers when a deliverable is accepted or a
-- timecard is approved.
--
-- Changes:
--   1. Add PAYOUT_TYPE env parameter for the payout provider type (stripe).
--   2. Add PAYOUT_PROVIDER env parameter for the gate (stripe).
--   3. Add `payout_type` column to `freelancer_invoices` (enum: stripe, none).
--   4. Add `status` enum column (pending, processing, paid, failed).
--   5. Add `external_ref` varchar(255) nullable (Stripe Transfer ID, etc.).
--   6. Add `payout_error` text nullable.
--
-- Existing rows default to `status = 'pending'` and `external_ref = NULL`.
-- All changes are additive. Safe to run per-project as an additive schema update.
--
-- Security: Stripe secret keys remain in secrets manager; never in migration.
--
-- Run this migration per-project after reading the existing freelancer_invoices
-- to verify compatibility before enabling PAYOUT_PROVIDER=stripe.

-- 1. Add PAYOUT_TYPE env parameter to application config (additive, stored in
-- platform_vars as metadata for config visitor; is optional, defaults to 'none')
INSERT INTO platform_vars (key, value, created_at)
VALUES
    ('PAYOUT_TYPE', 'none', NOW()),
    ('PAYOUT_PROVIDER', 'none', NOW())
ON CONFLICT (key) DO NOTHING;

-- 2. Add columns to freelancer_invoices (additive + default support)
ALTER TABLE freelancer_invoices
    ADD COLUMN IF NOT EXISTS payout_type TEXT NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS external_ref VARCHAR(255) NULL,
    ADD COLUMN IF NOT EXISTS payout_error TEXT NULL;

-- 3. PostgreSQL-specific: add CHECK constraints for enums (optional but useful)
ALTER TABLE freelancer_invoices
    ADD CONSTRAINT chk_freelancer_invoices_payout_type
        CHECK (payout_type IN ('stripe', 'helcim', 'none', 'manual'));

ALTER TABLE freelancer_invoices
    ADD CONSTRAINT chk_freelancer_invoices_status
        CHECK (status IN ('pending', 'processing', 'paid', 'failed'));

-- 4. Indexes for frequently queried payout state (idempotent creation)
CREATE INDEX IF NOT EXISTS idx_freelancer_invoices_status
    ON freelancer_invoices (status) WHERE status IN ('processing', 'paid');

CREATE INDEX IF NOT EXISTS idx_freelancer_invoices_payout_type
    ON freelancer_invoices (payout_type) WHERE payout_type = 'stripe';

-- 5. Index for traceability by deliverable_id/timecard_id (matches FR-3 resolve)
CREATE INDEX IF NOT EXISTS idx_freelancer_invoices_deliverable_id
    ON freelancer_invoices (deliverable_id) WHERE deliverable_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_freelancer_invoices_timecard_id
    ON freelancer_invoices (timecard_id) WHERE timecard_id IS NOT NULL;

-- 6. Index on external_ref for webhook reconciliation (FR-5)
CREATE INDEX IF NOT EXISTS idx_freelancer_invoices_external_ref
    ON freelancer_invoices (external_ref) WHERE external_ref IS NOT NULL;

-- Migration successful when all above statements succeeded without errors.
-- No data is deleted or modified; only additive schema and configuration.