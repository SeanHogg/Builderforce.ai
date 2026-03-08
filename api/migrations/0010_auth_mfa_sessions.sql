ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret_enc TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_temp_secret_enc TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_temp_expires_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_recovery_generated_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_last_verified_at TIMESTAMP;

DO $$
BEGIN
  CREATE TYPE auth_token_type AS ENUM ('web', 'tenant', 'api', 'claw');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS user_mfa_recovery_codes (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash VARCHAR(64) NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_user_sessions (
  id UUID PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_name VARCHAR(120),
  user_agent TEXT,
  ip_address VARCHAR(64),
  is_active BOOLEAN NOT NULL DEFAULT true,
  revoked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  jti VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES auth_user_sessions(id) ON DELETE SET NULL,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  token_type auth_token_type NOT NULL,
  issued_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP,
  user_agent TEXT,
  ip_address VARCHAR(64),
  last_seen_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_session ON auth_tokens(session_id);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_tenant ON auth_tokens(tenant_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_recovery_codes_user ON user_mfa_recovery_codes(user_id);
