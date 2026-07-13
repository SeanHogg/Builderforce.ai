-- Migration: Create Generated 1099 Forms Table
-- ID: 36
-- Description: Store generated 1099 forms for annual tax reporting

CREATE TABLE IF NOT EXISTS generated_1099s (
  id TEXT PRIMARY KEY,
  fiscal_year INTEGER NOT NULL,
  form_type TEXT NOT NULL CHECK (form_type IN ('1099-NEC', '1099-MISC')),
  irs_target_category TEXT,
  
  -- Recipient information
  recipient_id TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  recipient_tin TEXT NOT NULL,
  recipient_address JSONB NOT NULL,
  
  -- Financial summary
  payment_count INTEGER NOT NULL DEFAULT 0,
  total_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  gross_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(15, 2),
  withhold_amount NUMERIC(15, 2),
  
  -- Status and audit
  status TEXT NOT NULL DEFAULT 'draft',
  generated_at TIMESTAMPTZ NOT NULL,
  last_modified_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- E-filing metadata
  e_filing_provider TEXT,
  fta_id TEXT,
  tracking_number TEXT,
  filing_date TIMESTAMPTZ,
  confirmation_number TEXT,
  
  -- Generated documents
  pdf_url TEXT,
  e_file_package_url TEXT,
  internal_report_url TEXT,
  
  CONSTRAINT fk_recipient FOREIGN KEY (recipient_id) REFERENCES freelancer_profiles(id),
  CONSTRAINT chk_payment_count CHECK (payment_count >= 0),
  CONSTRAINT chk_amount_positive CHECK (total_amount >= 0)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_1099_fiscal_year ON generated_1099s(fiscal_year);
CREATE INDEX IF NOT EXISTS idx_1099_form_type ON generated_1099s(form_type);
CREATE INDEX IF NOT EXISTS idx_1099_status ON generated_1099s(status);
CREATE INDEX IF NOT EXISTS idx_1099_recipient ON generated_1099s(recipient_id);
CREATE INDEX IF NOT EXISTS idx_1099_recipient_tin ON generated_1099s(recipient_tin);
CREATE INDEX IF NOT EXISTS idx_1099_generated_at ON generated_1099s(generated_at);

-- Constraints
ALTER TABLE generated_1099s ADD CONSTRAINT chk_status_valid 
  CHECK (status IN ('draft', 'ready', 'e_filed', 'error'));

-- Comments
COMMENT ON TABLE generated_1099s IS 'Generated 1099 forms for annual tax reporting';
COMMENT ON COLUMN generated_1099s.payment_count IS 'Total number of payments included in this 1099';
COMMENT ON COLUMN generated_1099s.total_amount IS 'Gross total of all payments subject to 1099 reporting';
COMMENT ON COLUMN generated_1099s.gross_amount IS 'Gross amount before any withholdings';
COMMENT ON COLUMN generated_1099s.net_amount IS 'Total after withholdings (if any)';
COMMENT ON COLUMN generated_1099s.withhold_amount IS 'Total tax withheld from payments';
COMMENT ON COLUMN generated_1099s.pdf_url IS 'URL to PDF copy of the 1099 form';
COMMENT ON COLUMN generated_1099s.e_file_package_url IS 'URL to package file for third-party e-filing providers';
COMMENT ON COLUMN generated_1099s.irs_target_category IS 'IRS tax category (nec or null for MISC)';
COMMENT ON COLUMN generated_1099s.e_filing_provider IS 'Identifier of the e-filing provider used';
COMMENT ON COLUMN generated_1099s.fta_id IS 'FTA ID for third-party e-filing (if applicable)';
COMMENT ON COLUMN generated_1099s.tracking_number IS 'Tracking number provided by the e-filing provider';
COMMENT ON COLUMN generated_1099s.confirmation_number IS 'IRS confirmation number after successful e-filing';