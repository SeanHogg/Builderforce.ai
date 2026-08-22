-- 1112 · Learning paths, course prerequisites, and the xAPI LRS.
--
-- The LMS core landed in 0420 with nine tables and no application layer. This is
-- the remainder PRD 18 §T6 named — "learning PATHS and the xAPI LRS" — and it
-- adds ONE column and TWO indexes, because the coverage map had already decided
-- that everything else here is an existing shape:
--
--   HV learning_paths            merged     → folded into a sibling
--   HV learning_path_courses     primitive  → relation
--   HV learning_path_enrollments merged     → course_enrollments
--   HV course_prerequisites      merged     → folded into a sibling
--   HV xapi_statements           primitive  → event_log
--   HV lrs_statements            primitive  → event_log
--   HV lrs_credentials           primitive  → credential
--   HV external_lrs_targets      merged     → folded into a sibling
--
-- ── A PATH IS A COURSE ──────────────────────────────────────────────────────
-- `learning_paths` is "merged into a sibling" and the sibling is `courses`: the
-- source table's columns ARE this one's — slug, title, summary, status,
-- published_at, author_ref, price. What differs is what it contains, and that is
-- an edge, not a column.
--
-- Folding it in is not a saving of one table; it is what makes a path enrollable,
-- certifiable and sellable for free. `course_enrollments`, `course_certificates`
-- and `course_checkouts` all key on `course_id`, so a path that is a course row
-- inherits every one of them. A separate `learning_paths` table would have needed
-- `learning_path_enrollments`, `learning_path_certificates` and
-- `learning_path_checkouts` beside it — which is exactly the four tables the
-- source product had.
ALTER TABLE courses ADD COLUMN IF NOT EXISTS kind varchar(16) NOT NULL DEFAULT 'course';

-- Both catalogue reads filter on it — "the courses" and "the paths" are separate
-- listings on the same table, and each must not scan the other's rows.
CREATE INDEX IF NOT EXISTS idx_courses_kind ON courses (tenant_id, kind, status);

-- ── A PATH'S COURSES ARE EDGES ──────────────────────────────────────────────
-- `relations` carries them (`kind='contains'`, ordered by `position`) and
-- prerequisites too (`kind='depends_on'`). No DDL: the table shipped with PRD 20
-- naming this exact case — "ordered join rows (a course's modules, a path's
-- courses) are this table with a position, not their own DDL (§3.3)" — and until
-- now nothing had ever written to it.
--
-- Order lives on the EDGE because the same course sits third in one path and
-- first in another. On the course it would be one fact contradicting itself.

-- ── ENROLLING IN A PATH ─────────────────────────────────────────────────────
-- Also no DDL. A path enrollment is a `course_enrollments` row whose `course_id`
-- is the path, and `path_ref` — a column 0420 already carried, unused — marks a
-- member course's enrollment as belonging to that path. The rollup ("how far
-- through the path is this learner") reads the member rows, so it needs the
-- reverse lookup indexed. Partial: `path_ref` is null on every standalone
-- enrollment, which is most of them.
CREATE INDEX IF NOT EXISTS idx_course_enrollments_path
  ON course_enrollments (tenant_id, path_ref, learner_ref)
  WHERE path_ref IS NOT NULL;

-- ── THE LRS ─────────────────────────────────────────────────────────────────
-- An xAPI statement is `actor · verb · object` with a result. That is
-- `activity_log`'s shape exactly, which is why the map sends both statement
-- tables to the `event_log` primitive (corrected here from `ledger_entry` — a
-- statement is not money-shaped, and nothing had been built against the old
-- target).
--
-- The conformance win is `idx_activity_log_event_key`, which is already UNIQUE.
-- xAPI requires a statement id to be immutable and a re-PUT of the same id to be
-- idempotent rather than a duplicate; storing the statement id as `event_key`
-- makes the database enforce that instead of a read-then-write race.
--
-- `lrs_documents` (State, Activity Profile, Agent Profile) is a KEEP and already
-- exists. LRS Basic-auth keys are `credentials` (purpose 'basic') under a
-- `connections` row, which is also where an external forwarding target lives —
-- so a tenant's own LRS and an enterprise LRS it forwards to are the same shape,
-- distinguished by `config`.
--
-- One index: the statement listing is filtered by verb and by activity, and both
-- are metadata rather than typed columns, so the query leads with the actor type
-- and time the way every other visitor-shaped read does.
CREATE INDEX IF NOT EXISTS idx_activity_log_learner_time
  ON activity_log (tenant_id, occurred_at)
  WHERE actor_type = 'learner';
