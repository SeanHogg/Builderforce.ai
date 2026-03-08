DO $$ BEGIN
  CREATE TYPE privacy_request_type AS ENUM ('ccpa', 'gdpr');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE privacy_request_status AS ENUM ('pending', 'completed', 'closed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS privacy_requests (
  id serial PRIMARY KEY,
  user_id varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  email varchar(255) NOT NULL,
  request_type privacy_request_type NOT NULL,
  details text,
  status privacy_request_status NOT NULL DEFAULT 'pending',
  resolution text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  closed_at timestamp
);

CREATE INDEX IF NOT EXISTS idx_privacy_requests_status ON privacy_requests(status);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_email ON privacy_requests(email);
