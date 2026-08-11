-- Compatibility source for environments that applied an early version of this
-- migration before Brain preferences moved into the kernel settings primitive.
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

-- A user belongs to a tenant, so Brain preferences are a kernel setting scoped
-- to that user inside each active workspace. Copy any early table rows to every
-- active membership before removing the duplicate settings-shaped table.
INSERT INTO settings (tenant_id, scope, scope_ref, feature, value, updated_by, created_at, updated_at)
SELECT
  tm.tenant_id,
  'user',
  p.user_id,
  'brain',
  jsonb_build_object(
    'effort', p.effort,
    'thinking', p.thinking,
    'webBrowsing', p.web_browsing,
    'modelSelection', CASE
      WHEN p.model_mode = 'model' AND p.model_id IS NOT NULL
        THEN jsonb_build_object('mode', 'model', 'model', p.model_id)
      WHEN p.model_mode = 'byo_pool'
        THEN jsonb_build_object('mode', 'byo_pool')
      ELSE jsonb_build_object('mode', 'auto')
    END,
    'responseInstructions', COALESCE(p.response_instructions, '')
  ),
  p.user_id,
  p.created_at,
  p.updated_at
FROM user_brain_preferences p
INNER JOIN tenant_members tm
  ON tm.user_id = p.user_id
 AND tm.is_active = true
ON CONFLICT (tenant_id, scope, scope_ref, feature)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_by = EXCLUDED.updated_by,
  updated_at = EXCLUDED.updated_at;

DROP TABLE user_brain_preferences;
