-- 0339_evermind_serve_quarantine.sql
--
-- Auto-quarantine for a project's Evermind head. An under-trained head can emit
-- fluent-looking gibberish (broken UTF-8, "commit … commit … commit" repetition,
-- near-words) that clears a length check and gets served to users. The serve path
-- now scores each Evermind reply for coherence; this adds the bookkeeping that lets
-- a head DISABLE ITSELF after a streak of incoherent replies instead of answering
-- in garbage every turn:
--
--   * serve_failure_streak — consecutive incoherent serves. A coherent serve (or a
--     manual re-enable) resets it to 0; reaching the threshold force-disables
--     inference_enabled and stamps the two columns below.
--   * quarantined_at        — when the head was auto-disabled (NULL = not quarantined).
--   * quarantine_reason      — human-readable cause, shown in the Evermind console.
--
-- Idempotent: guarded with IF NOT EXISTS so re-running is safe. Existing rows get
-- streak 0 / NULL flags → unaffected (not quarantined) until they actually misbehave.

ALTER TABLE project_evermind ADD COLUMN IF NOT EXISTS serve_failure_streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE project_evermind ADD COLUMN IF NOT EXISTS quarantined_at TIMESTAMP;
ALTER TABLE project_evermind ADD COLUMN IF NOT EXISTS quarantine_reason TEXT;
