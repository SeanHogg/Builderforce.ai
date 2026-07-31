-- 0367 — The AI Manager's stuck-ticket register.
--
-- WHY THIS TABLE EXISTS
--
-- The manager pass grooms value, ranks the backlog, assigns owners, opens/merges PRs
-- and audits role coverage. Every one of those acts on a ticket the pass happens to
-- look at. NONE of them asked the question a human PM asks first: *what is stuck, and
-- why?* Measured on tenant 1 over 90 days — 821 tickets, 809 stalled, 466 of those
-- never executed even once. Nothing in the system was accountable for noticing, so
-- nothing did.
--
-- But detection alone would have reproduced the exact bug this work uncovered. The
-- merge livelock (40,580 `sync_pr` manager actions against 10 real merges, a 4058:1
-- ratio) was NOT a wrong remedy — syncing a stale branch is correct. It was a remedy
-- applied forever with nothing ever checking whether it MOVED anything. A manager that
-- re-dispatches the same unassigned ticket every five minutes for nineteen days is not
-- autonomous; it is a retry storm with a job title.
--
-- So this table records the thing that makes the difference: WHAT the manager tried,
-- HOW MANY TIMES, and whether the ticket moved afterwards.
--
--   • `attempts` counts consecutive applications of `remedy` that did NOT move the
--     ticket. `escalateIfIneffective` converts the remedy to `escalate_human` at the
--     ceiling (MAX_REMEDY_ATTEMPTS), so an ineffective fix ends in a human's lap
--     instead of an infinite loop. This is the livelock ceiling, generalised.
--
--   • `observed_status` is how the counter knows. Each pass compares the ticket's
--     CURRENT status against the status recorded when the remedy was last applied: a
--     change means the remedy worked (reset to 0), an identical status means it did
--     not (increment). Storing the status is what makes "did it work?" answerable
--     without re-reading the whole transition history every pass.
--
--   • `resolved_at` closes the row when the ticket starts moving again, so the register
--     is a live list of what is stuck NOW, while the history stays queryable for
--     "which remedies actually work" analysis.
--
-- ONE ROW PER TICKET (the unique index) — the register is a current-state view, not an
-- event log. `manager_actions` already carries the per-pass event stream, and every
-- triage decision journals there; duplicating those rows here would just recreate the
-- write amplification the gap register already flags.

CREATE TABLE IF NOT EXISTS manager_stall_watch (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        integer     NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  project_id       integer     NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id          integer     NOT NULL REFERENCES tasks(id)    ON DELETE CASCADE,

  /** Diagnosis from `stallTriage.diagnoseStall` — e.g. 'never_started', 'unassigned',
   *  'awaiting_signoff', 'pr_conflict', 'human_gate'. Free-form varchar rather than an
   *  enum so extending the taxonomy never needs a migration + deploy ordering dance. */
  cause            varchar(32) NOT NULL,
  /** The remedy the manager applied (or 'escalate_human' once it gave up on its own). */
  remedy           varchar(32) NOT NULL,
  /** Plain-language explanation shown in the register and the manager feed. */
  detail           text        NOT NULL,

  /** The ticket's status when `remedy` was last applied — see the header note. */
  observed_status  varchar(32) NOT NULL,
  /** Consecutive applications of `remedy` that did not move the ticket. */
  attempts         integer     NOT NULL DEFAULT 0,
  /** How long the ticket had been idle when the stall was first recorded (ms). */
  idle_ms          bigint      NOT NULL DEFAULT 0,

  /** When the manager first noticed this ticket was stuck (never reset while open). */
  first_seen_at    timestamp   NOT NULL DEFAULT now(),
  /** Most recent pass that re-confirmed the stall. */
  last_seen_at     timestamp   NOT NULL DEFAULT now(),
  /** Most recent pass that actually APPLIED the remedy (null when only observed). */
  last_attempt_at  timestamp,
  /** Set when the manager conceded its remedy was not working and handed over. */
  escalated_at     timestamp,
  /** Set when the ticket started moving again — closes the row. */
  resolved_at      timestamp,

  created_at       timestamp   NOT NULL DEFAULT now(),
  updated_at       timestamp   NOT NULL DEFAULT now()
);

-- One OPEN row per ticket. Partial-unique so a resolved row stays as history and a
-- ticket that stalls again later opens a fresh row (with a truthful first_seen_at)
-- rather than resurrecting the old one's attempt count.
CREATE UNIQUE INDEX IF NOT EXISTS uq_manager_stall_watch_open
  ON manager_stall_watch (task_id) WHERE resolved_at IS NULL;

-- The register read: open stalls for a project, worst (longest idle) first.
CREATE INDEX IF NOT EXISTS idx_manager_stall_watch_open
  ON manager_stall_watch (tenant_id, project_id, resolved_at, idle_ms);

-- "What is escalated to me right now" across a workspace.
CREATE INDEX IF NOT EXISTS idx_manager_stall_watch_escalated
  ON manager_stall_watch (tenant_id, escalated_at) WHERE resolved_at IS NULL;

COMMENT ON TABLE manager_stall_watch IS
  'The AI Manager''s stuck-ticket register: one open row per stalled ticket recording the diagnosed cause, the remedy applied, and how many consecutive attempts failed to move it. attempts >= MAX_REMEDY_ATTEMPTS converts the remedy to escalate_human, which is the ceiling whose absence produced the 4058:1 sync-to-merge livelock.';
