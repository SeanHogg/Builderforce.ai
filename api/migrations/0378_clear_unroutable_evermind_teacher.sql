-- Clear Evermind teacher pins that route nowhere.
--
-- `xai/grok-4.5` matches no vendor prefix (the routable forms are
-- `direct/xai/…` and `xai-oauth/…`) and is not a catalog id, so vendorForModel
-- fell through to DEFAULT_VENDOR — a vendor that has never heard of the model.
-- Every coordinator alarm therefore dispatched a doomed request and recorded a
-- distillation fault: 2,083 events and still climbing when this landed.
--
-- The pin endpoint now refuses unroutable ids (isRoutableModel) and the
-- coordinator now treats one as 'unroutable' instead of calling it, but the row
-- itself still says the project has a working teacher. Clearing it makes the
-- stored state honest: a null teacher is the documented self-learning path
-- (skipReason 'not_pinned'), and the manager can re-pin through the validated
-- endpoint, which will now reject the bad form at the point of entry.
--
-- Deliberately NOT rewritten to `direct/xai/grok-4.5`: that routes to a
-- different account and billing path, which is the operator's decision to make,
-- not a migration's.
--
-- Scoped by the prefixes that actually route. A bare catalog id (no `/`) is
-- left alone — those resolve through the catalog index and are valid.

UPDATE project_evermind
   SET teacher_model = NULL
 WHERE teacher_model IS NOT NULL
   AND teacher_model LIKE '%/%'
   AND teacher_model NOT LIKE 'openrouter/%'
   AND teacher_model NOT LIKE 'cerebras/%'
   AND teacher_model NOT LIKE 'nim/%'
   AND teacher_model NOT LIKE 'ollama/%'
   AND teacher_model NOT LIKE 'googleai/%'
   AND teacher_model NOT LIKE 'evermind/%'
   AND teacher_model NOT LIKE 'openai-codex/%'
   AND teacher_model NOT LIKE 'xai-oauth/%'
   AND teacher_model NOT LIKE 'cloudflare/%'
   AND teacher_model NOT LIKE 'direct/%'
   AND teacher_model NOT LIKE '@cf/%';
