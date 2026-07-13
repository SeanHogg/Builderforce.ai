-- Migration: Create W-9 Tax Forms Table
-- ID: 34
-- Description: Initial table for US W-9 tax form storage

CREATE TABLE IF NOT EXISTS w9_forms (
  id TEXT PRIMARY KEY,
  freelancer_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  
  -- Form metadata
  submitted_at TIMESTAMPTZ NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL,
  effective_until TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending',
  taxpayer_type TEXT NOT NULL,
  tin_type TEXT NOT NULL,
  tin TEXT NOT NULL,
  name_on_form TEXT NOT NULL,
  business_name TEXT,
  
  -- Address information
  address JSONB NOT NULL,
  
  -- Optional fields based on entity type
  account_numbers TEXT,
  statement_transactions INTEGER,
  waiver_checkbox INTEGER,
  reset_ein INTEGER,
  
  -- Audit trails
  form_data_json JSONB NOT NULL,
  scanned_document_url TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT fk_freelancer FOREIGN KEY (freelancer_id) REFERENCES freelancer_profiles(id),
  CONSTRAINT uidx_freelancer_tin UNIQUE (freelancer_id, tin, effective_until IS NULL)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_w9_status ON w9_forms(status);
CREATE INDEX IF NOT EXISTS idx_w9_freelancer ON w9_forms(freelancer_id);
CREATE INDEX IF NOT EXISTS idx_w9_tin ON w9_forms(tin);
CREATE INDEX IF NOT EXISTS idx_w9_valid_from ON w9_forms(valid_from);
CREATE INDEX IF NOT EXISTS idx_w9_taxpayer_type ON w9_forms(taxpayer_type);

-- Comments
COMMENT ON TABLE w9_forms IS 'W-9 Tax Forms table for US payment recipients (US persons/entities)';
COMMENT ON COLUMN w9_forms.tin IS 'Tax Identification Number: SSN, EIN, or ITIN';
COMMENT ON COLUMN w9_forms.address IS 'JSONB object containing address fields (street_line1, street_line2, city, state, postal_code, country)';
COMMENT ON COLUMN w9_forms.status IS 'Form submission status: pending, submitted, verified, expired, archived';
COMMENT ON COLUMN w9_forms.taxpayer_type IS 'Type of taxpayer: individual, corporation, partnership, llc, trust, trust_estate';
COMMENT ON COLUMN w9_forms.tin_type IS 'Type of tax ID: ssn, ein, itin';