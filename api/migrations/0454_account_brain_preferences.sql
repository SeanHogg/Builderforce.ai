-- A user belongs to a tenant, so Brain preferences are a kernel setting scoped
-- to that user inside each active workspace. Copy any early table rows to every
-- active membership before removing the duplicate settings-shaped table.
DO $$
BEGIN
  IF to_regclass('public.user_brain_preferences') IS NOT NULL THEN
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
  END IF;
END $$;

DROP TABLE IF EXISTS user_brain_preferences;
