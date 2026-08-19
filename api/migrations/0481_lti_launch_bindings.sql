-- The LTI launch verified a signature and then went nowhere.
--
-- `POST /api/lti/launch` checked the `id_token` correctly and returned JSON —
-- issuer, memberships URL, line-item URL — that NOTHING consumed. There was no
-- route the LMS's `target_link_uri` landed a person on, no session it
-- established, and no board it opened. So a `cohort`'s `ltiIssuer` /
-- `ltiMembershipsUrl` and an `assignment`'s `ltiLineItemUrl` — the fields
-- `cohort.import` and `submission.mark` call the roster and grade services with —
-- could only be set by an admin pasting values out of an LMS configuration
-- screen. The protocol worked; the product did not.
--
-- ── THE DECISION THIS TABLE RECORDS ────────────────────────────────────────
-- A launch RESUMES the board bound to its COURSE, and creates one on first
-- launch. The course, not the resource link: an LMS course-navigation launch and
-- an assignment launch are two doors into the same module, and a board per
-- resource link would give one cohort two rosters that drift. So the identity of
-- a board is (issuer, deployment_id, context_id) — all three, because
-- `context_id` is unique only within a deployment and `deployment_id` only within
-- an issuer.
--
-- The RESOURCE LINK still matters, and it is the second table: one assignment
-- object per link, so a second assignment launched from the same course adds an
-- object to the existing board instead of a board.
--
-- ── WHY A BINDING TABLE AND NOT A COLUMN ON `creation_sessions` ────────────
-- Because the fact is about the RELATIONSHIP, not about the board: a board can
-- exist with no LMS behind it (most do), and four LTI columns on
-- `creation_sessions` would be four nulls on every canvas the platform has. This
-- is the same shape `site_records` and the other single-pane connectors use.
CREATE TABLE IF NOT EXISTS lti_context_bindings (
  id              serial PRIMARY KEY,
  tenant_id       integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  registration_id integer NOT NULL REFERENCES lti_registrations(id) ON DELETE CASCADE,
  issuer          varchar(255) NOT NULL,
  deployment_id   varchar(255) NOT NULL,
  context_id      varchar(255) NOT NULL,
  -- What the LMS calls the course, frozen at first launch so a board that is
  -- later renamed still says where it came from.
  context_label   varchar(255),
  context_title   varchar(255),
  -- The board a launch lands on.
  session_id      uuid NOT NULL REFERENCES creation_sessions(id) ON DELETE CASCADE,
  -- The `cohort` object on it. This is the row that carries `ltiIssuer` and
  -- `ltiMembershipsUrl`, which is why the launch can now set them.
  cohort_object_id uuid,
  -- NRPS. Null when the platform did not grant the roster scope.
  memberships_url text,
  created_at      timestamp NOT NULL DEFAULT now(),
  updated_at      timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lti_context_bindings_context
  ON lti_context_bindings (issuer, deployment_id, context_id);
CREATE INDEX IF NOT EXISTS idx_lti_context_bindings_tenant
  ON lti_context_bindings (tenant_id, session_id);

-- One assignment object per resource link within a course.
CREATE TABLE IF NOT EXISTS lti_resource_bindings (
  id                   serial PRIMARY KEY,
  tenant_id            integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  binding_id           integer NOT NULL REFERENCES lti_context_bindings(id) ON DELETE CASCADE,
  resource_link_id     varchar(255) NOT NULL,
  resource_link_title  varchar(255),
  assignment_object_id uuid,
  -- AGS. Null when the platform did not grant the score scope, which is exactly
  -- when `submission.mark` must NOT claim it pushed a grade back.
  line_item_url        text,
  created_at           timestamp NOT NULL DEFAULT now(),
  updated_at           timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lti_resource_bindings_link
  ON lti_resource_bindings (binding_id, resource_link_id);

COMMENT ON TABLE lti_context_bindings IS
  'One LMS course context ↔ one canvas board. A launch resumes the bound board and creates it on first launch; identity is (issuer, deployment_id, context_id) because context ids are unique only within a deployment.';
COMMENT ON TABLE lti_resource_bindings IS
  'One LMS resource link ↔ one assignment object on the course''s board. A second link in the same course adds an object, never a second board.';
