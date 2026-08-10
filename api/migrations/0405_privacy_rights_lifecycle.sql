-- Complete privacy-rights lifecycle and auditable fulfillment evidence.
ALTER TYPE privacy_request_type ADD VALUE IF NOT EXISTS 'access';
ALTER TYPE privacy_request_type ADD VALUE IF NOT EXISTS 'correction';
ALTER TYPE privacy_request_type ADD VALUE IF NOT EXISTS 'deletion';
ALTER TYPE privacy_request_type ADD VALUE IF NOT EXISTS 'portability';
ALTER TYPE privacy_request_type ADD VALUE IF NOT EXISTS 'restriction';
ALTER TYPE privacy_request_type ADD VALUE IF NOT EXISTS 'objection';
ALTER TYPE privacy_request_type ADD VALUE IF NOT EXISTS 'opt_out';
ALTER TYPE privacy_request_type ADD VALUE IF NOT EXISTS 'appeal';
ALTER TYPE privacy_request_type ADD VALUE IF NOT EXISTS 'automated_decision_review';
ALTER TYPE privacy_request_status ADD VALUE IF NOT EXISTS 'verifying';
ALTER TYPE privacy_request_status ADD VALUE IF NOT EXISTS 'processing';
ALTER TYPE privacy_request_status ADD VALUE IF NOT EXISTS 'denied';
ALTER TYPE privacy_request_status ADD VALUE IF NOT EXISTS 'appealed';

ALTER TABLE privacy_requests
  ADD COLUMN IF NOT EXISTS jurisdiction varchar(32),
  ADD COLUMN IF NOT EXISTS parent_request_id integer REFERENCES privacy_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS due_at timestamp,
  ADD COLUMN IF NOT EXISTS verified_at timestamp,
  ADD COLUMN IF NOT EXISTS fulfillment_evidence jsonb,
  ADD COLUMN IF NOT EXISTS processor_deletion_status jsonb,
  ADD COLUMN IF NOT EXISTS backup_disposition text;
CREATE INDEX IF NOT EXISTS privacy_requests_due_idx ON privacy_requests(status, due_at);
