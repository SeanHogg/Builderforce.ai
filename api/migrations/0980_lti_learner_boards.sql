-- A learner's LTI launch had nowhere to land.
--
-- Migration 0481 bound an LMS course to a board and an LMS resource link to an
-- `assignment` object on it, and `bridgeLaunch` refused a `learn` capability
-- outright — correctly, because the cohort board carries the whole roster and
-- every mark on it, so opening it for a student would disclose their classmates'
-- grades. The refusal then told the student "your instructor distributes your own
-- copy of the work", and that destination DID NOT EXIST on the server.
-- `assignment.distribute` was a client-side canvas action: it added one
-- `submission` NODE per roster row to the SAME cohort board. There was no board
-- of their own to send anybody to, and no table that could have named one.
--
-- ── THE DECISION THIS TABLE RECORDS ────────────────────────────────────────
-- A distributed assignment gives each learner THEIR OWN BOARD, and this table is
-- the only thing that knows which. Identity is (binding_id, assignment_ref,
-- learner_ref):
--
--   · `binding_id`    scopes it to one LMS course, so two modules that both set
--                     "Essay 1" do not collide.
--   · `assignment_ref` is the assignment's TITLE, normalised — the same
--                     `specRefKey` join the canvas itself uses between an
--                     `assignment` and the `submission`s that name it. Not the
--                     object's uuid: the canvas's academic vocabulary joins on
--                     refs, and a second key for the same relationship is the
--                     drift `SpecDeriveBoard` exists to prevent.
--   · `learner_ref`   is the platform `sub` off the roster row, normalised the
--                     same way. Not the email — a platform may release none, and
--                     an email is not stable across a surname change.
--
-- `learner_user_id` is NULLABLE on purpose. A row can be minted for a roster
-- entry whose owner has never launched, and the Builderforce account only exists
-- once they do; forcing it NOT NULL would mean either refusing to record the
-- board or provisioning accounts for people who may never arrive.
--
-- ── WHY A TABLE AND NOT A COLUMN ON `creation_sessions` ────────────────────
-- Same argument 0481 makes: the fact is about the RELATIONSHIP. A board can
-- exist with no LMS and no learner behind it (almost all do), and three more LTI
-- columns on `creation_sessions` would be three more nulls on every canvas on
-- the platform.
CREATE TABLE IF NOT EXISTS lti_learner_boards (
  id                  serial PRIMARY KEY,
  tenant_id           integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  binding_id          integer NOT NULL REFERENCES lti_context_bindings(id) ON DELETE CASCADE,
  -- The resource link the assignment was launched from, when there was one. Null
  -- for an assignment authored on the board rather than launched into it.
  resource_binding_id integer REFERENCES lti_resource_bindings(id) ON DELETE CASCADE,
  -- Normalised `specRefKey` values — see the header. 160 is the canvas title
  -- budget with room to spare; a longer title normalises to its first 160
  -- characters on both sides of the join, so it still matches itself.
  assignment_ref      varchar(160) NOT NULL,
  learner_ref         varchar(160) NOT NULL,
  -- Filled on the learner's first launch. See the header for why it is nullable.
  learner_user_id     varchar(36) REFERENCES users(id) ON DELETE CASCADE,
  -- The learner's OWN board. Never the cohort board.
  session_id          uuid NOT NULL REFERENCES creation_sessions(id) ON DELETE CASCADE,
  -- The `submission` object copied onto it. `uuid` and not text, matching
  -- `lti_context_bindings.cohort_object_id` and
  -- `lti_resource_bindings.assignment_object_id`: all three name a
  -- `creation_session_objects.id`, and one of them typed differently is a join
  -- that fails at runtime in exactly one place.
  submission_object_id uuid,
  created_at          timestamp NOT NULL DEFAULT now(),
  updated_at          timestamp NOT NULL DEFAULT now()
);

-- One board per (course, assignment, learner). This is what makes a second
-- launch RESUME the board instead of minting another copy of the work.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lti_learner_boards_learner
  ON lti_learner_boards (binding_id, assignment_ref, learner_ref);
-- "Which of my LMS-distributed boards are mine?" — the read a learner's
-- dashboard makes, and the one a tenant-scoped sweep makes.
CREATE INDEX IF NOT EXISTS idx_lti_learner_boards_tenant_user
  ON lti_learner_boards (tenant_id, learner_user_id);

COMMENT ON TABLE lti_learner_boards IS
  'One (LMS course, assignment, learner) ↔ one board of that learner''s own. A learner''s LTI launch resumes it and mints it on first launch from the submission the instructor distributed; it never opens the cohort board, which carries the whole roster and every mark on it.';
