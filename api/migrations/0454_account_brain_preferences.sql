-- Account-level Brain defaults. These belong to the human, not a tenant, so the
-- same choices follow them across workspaces and devices.
CREATE TABLE IF NOT EXISTS user_brain_preferences (
  user_id varchar(36) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  effort varchar(16) NOT NULL DEFAULT 'balanced',
  thinking boolean NOT NULL DEFAULT false,
  web_browsing boolean NOT NULL DEFAULT false,
  model_mode varchar(16) NOT NULL DEFAULT 'auto',
  model_id text,
  response_instructions text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT user_brain_preferences_effort_check CHECK (effort IN ('quick', 'balanced', 'thorough')),
  CONSTRAINT user_brain_preferences_model_mode_check CHECK (model_mode IN ('auto', 'byo_pool', 'model')),
  CONSTRAINT user_brain_preferences_model_check CHECK (model_mode <> 'model' OR model_id IS NOT NULL)
);
