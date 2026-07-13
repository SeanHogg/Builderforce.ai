-- 0161_feedback_triage_link.sql
-- Voice-of-Customer triage (spec 05 §4.2): ingested `customer_feedback` rows
-- (status `new`) can be triaged into the backlog. This adds the link from a
-- triaged feedback row to the backlog task it spawned/attached, plus the moment
-- of triage, so the inbox can show "triaged → PROJ-7" and never re-triage a row.
--
--   - triaged_task_id: the backlog task this feedback was triaged into. ON DELETE
--                      SET NULL so deleting the task doesn't erase the feedback's
--                      triaged history (it just unlinks).
--   - triaged_at:      when the row was triaged (NULL while status = 'new').
--
-- NOT applied to the live DB by convention — run `npm --prefix api run db:migrate`.
ALTER TABLE customer_feedback ADD COLUMN IF NOT EXISTS triaged_task_id integer REFERENCES tasks(id) ON DELETE SET NULL;
ALTER TABLE customer_feedback ADD COLUMN IF NOT EXISTS triaged_at      timestamp;

-- The inbox lists by (segment, status) newest-first; a partial index keeps the
-- common "new" queue read cheap as the feedback log grows.
CREATE INDEX IF NOT EXISTS idx_customer_feedback_segment_status
  ON customer_feedback (segment_id, status, created_at DESC);
