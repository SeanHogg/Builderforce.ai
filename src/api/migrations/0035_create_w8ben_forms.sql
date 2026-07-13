-- Migration: Create W-8BEN Tax Forms Table
-- ID: 35
-- Description: Initial table for foreign W-8BEN tax form storage

CREATE TABLE IF NOT EXISTS w8ben_forms (
  id TEXT PRIMARY KEY,
  freelancer_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  
  -- Form metadata
  submitted_at TIMESTAMPTZ NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL,
  effective_until TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending',
  taxpayer_type TEXT NOT NULL,
  entity_name TEXT,
  foreign_tax_number TEXT,
  foreign_address JSONB NOT NULL,
  
  -- Exemption claim
  beneficial_owner JSONB,
  waiver_text BOOLEAN DEFAULT FALSE,
  
  -- Archive information
  archive_reason TEXT,
  archived_at TIMESTAMPTZ,
  
  -- Audit trails
  form_type TEXT NOT NULL,
  form_data_json JSONB NOT NULL,
  scanned_document_url TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT fk_freelancer FOREIGN KEY (freelancer_id) REFERENCES freelancer_profiles(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_w8ben_status ON w8ben_forms(status);
CREATE INDEX IF NOT EXISTS idx_w8ben_freelancer ON w8ben_forms(freelancer_id);
CREATE INDEX IF NOT EXISTS idx_w8ben_valid_from ON w8ben_forms(valid_from);
CREATE INDEX IF NOT EXISTS idx_w8ben_foreign_tin ON w8ben_forms(foreign_tax_number);

-- Comments
COMMENT ON TABLE w8ben_forms IS 'W-8BEN Tax Forms table for foreign payment recipients (foreign persons)';
COMMENT ON COLUMN w8ben_forms.foreign_tax_number IS 'Foreign tax identification number';
COMMENT ON COLUMN w8ben_forms.foreign_address IS 'JSONB object containing foreign address fields (country, street_line1, street_line2, city, region, postal_code)';
COMMENT ON COLUMN w8ben_forms.status IS 'Form submission status: pending, submitted, verified, expired, archived';
COMMENT ON COLUMN w8ben_forms.taxpayer_type IS 'Type of taxpayer: individual, entity';
COMMENT ON COLUMN w8ben_forms.beneficial_owner IS 'JSONB object containing beneficial owner information (country_of_residence, ownership_percent, certification)';
COMMENT ON COLUMN w8ben_forms.waiver_text IS 'Indicates whether beneficial owner is claiming reduced rate or exemption';