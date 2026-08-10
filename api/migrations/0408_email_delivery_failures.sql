-- Platform-wide outbound email failure ledger. Bodies, OTPs and credentials are
-- intentionally excluded; SuperAdmin needs delivery evidence, not message content.
CREATE TABLE IF NOT EXISTS email_delivery_failures (
  id serial PRIMARY KEY,
  recipient varchar(255) NOT NULL,
  delivery_type varchar(64) NOT NULL DEFAULT 'transactional',
  provider varchar(32) NOT NULL DEFAULT 'resend',
  provider_status integer,
  error_message text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_delivery_failures_created
  ON email_delivery_failures(created_at);
CREATE INDEX IF NOT EXISTS idx_email_delivery_failures_recipient
  ON email_delivery_failures(recipient, created_at);
