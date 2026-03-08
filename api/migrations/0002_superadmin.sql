-- Add superadmin flag to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_superadmin boolean NOT NULL DEFAULT false;

-- Grant superadmin to the platform owner
UPDATE users SET is_superadmin = true WHERE email = 'seanhogg@gmail.com';

-- API error log (populated by the 500 handler for visibility in the admin UI)
CREATE TABLE IF NOT EXISTS api_error_log (
  id         SERIAL PRIMARY KEY,
  method     VARCHAR(10),
  path       VARCHAR(500),
  message    TEXT,
  stack      TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Keep the table lean by deleting entries older than 30 days periodically
