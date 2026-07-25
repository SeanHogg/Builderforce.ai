-- 0365 — Ceremony attendance, history, and the autonomy rules that govern an
--        unattended ceremony.
--
-- THREE problems, one migration. They are one migration because they are one
-- question: "the manager ran a standup nobody came to — what is it allowed to do,
-- and where do I go to see what it did?"
--
-- (1) ATTENDANCE WAS NEVER RECORDED. `ceremony_participants` (0119) is a ROSTER —
--     who was expected to speak and in what order — and presence was computed in
--     the browser from live WebSocket peers (CeremonyStage.presentKeys) and thrown
--     away when the tab closed. Nothing persisted said who actually turned up. The
--     only durable proxy was `duration_ms > 0`, which cannot tell "sat silently
--     through the whole standup" apart from "never joined". So a completed session
--     could not answer the first question anyone asks about a standup: who was here?
--
--     `attendance` is a resolved verdict, not a raw signal, and it is written ONCE
--     when the session concludes (see `concludeCeremonySession`). Until then it
--     stays 'unknown' — an active session has no attendance answer yet, and
--     defaulting it to 'absent' would make every in-progress ceremony read as a
--     room full of no-shows.
--
-- (2) A SCHEDULED CEREMONY COULD NEVER END. `runDueCeremonies` (0349) opens a
--     session; only a human clicking Complete ever closed one. Combined with
--     `uq_ceremony_session_active(project_id, kind) WHERE status='active'` that is
--     a wedge: the first standup nobody closes blocks EVERY future standup on that
--     board forever, and the schedule dutifully records 'already_active' each day.
--     `status` gains 'abandoned' and sessions gain a close reason + denormalised
--     outcome counters, so the reaper can conclude a session the same way a human
--     would and the history list can render a row without fanning out to
--     participants per session.
--
-- (3) THE AUTONOMY RULES HAD NOWHERE TO LIVE. "May a standup run with no humans?"
--     and "may a human's ticket be handed to an agent?" are questions about what
--     the AI Manager may do unattended — exactly what `tenant_manager_defaults` /
--     `project_manager_configs` already govern (0363). So these are FOUR MORE
--     COLUMNS ON THE EXISTING TIERS, resolved by the SAME `resolveTieredManagerPolicy`
--     fold, and not a parallel ceremony-policy table that would need its own
--     precedence rules, its own cache, and its own settings screen to drift out of
--     sync with the manager's.
--
--     Both booleans are GRANTS and default to NOT granted at every tier, matching
--     `allow_auto_merge` (0363): conducting business without the people it concerns,
--     and moving someone's work off their plate, are things a workspace hands over
--     on purpose or not at all.
--
-- The journal of what a ceremony DID (turns, reassignments, notifications, the
-- close itself) is NOT a new table — it goes to `activity_log`, the one canonical
-- audit store since 0295, under target_type='ceremony_session'. A ceremony_events
-- table would have been a second audit store for one subsystem.

-- ── (1) attendance on the roster ────────────────────────────────────────────

ALTER TABLE ceremony_participants
  -- Was this member EXPECTED? A scheduled roster is required; someone who simply
  -- walked into a live ceremony is recorded present but never counts as a no-show.
  ADD COLUMN IF NOT EXISTS required    boolean     NOT NULL DEFAULT true,
  -- First and last moment this member was observed in the room. Written by the
  -- attendance heartbeat; joined_at is set once, left_at moves forward.
  ADD COLUMN IF NOT EXISTS joined_at   timestamp,
  ADD COLUMN IF NOT EXISTS left_at     timestamp,
  -- The resolved verdict, written when the session concludes.
  --   'unknown'  — the session is still open; no verdict yet (the default).
  --   'present'  — observed in the room at least once.
  --   'absent'   — required, never observed. This is a fact, NOT a fault: missing a
  --                standup is normal, and nothing here penalises it on its own.
  --   'excused'  — not required (an optional/ad-hoc seat that never joined).
  ADD COLUMN IF NOT EXISTS attendance  varchar(12) NOT NULL DEFAULT 'unknown',
  -- When this member was invited to join the live session, so a re-notify on a
  -- later sweep tick cannot spam someone who has already been told.
  ADD COLUMN IF NOT EXISTS notified_at timestamp;

COMMENT ON COLUMN ceremony_participants.attendance IS
  'Resolved attendance verdict, written once at conclude: unknown (session still open) | present | absent (required + never observed) | excused (optional + never observed). Absence is recorded, never punished on its own — the agent-reassignment rules additionally require the work to be stale.';

COMMENT ON COLUMN ceremony_participants.required IS
  'Whether this seat was expected to attend. Roster seats are required; someone who joined a live ceremony ad-hoc is not, so they can never be counted as a no-show.';

-- ── (2) how a session ended ─────────────────────────────────────────────────

ALTER TABLE ceremony_sessions
  -- Who closed it. 'human' = someone clicked Complete; 'manager' = the AI Manager
  -- concluded it unattended; 'system' = the reaper closed a session no one ended.
  ADD COLUMN IF NOT EXISTS concluded_by     varchar(16),
  -- Why it closed — the governance answer, kept separate from `status` so
  -- "completed" never has to be read as four different outcomes.
  --   'facilitator'  — a human ended it.
  --   'unattended'   — the manager conducted + closed it with no humans present.
  --   'no_humans'    — closed WITHOUT conducting: nobody came and the workspace has
  --                    not granted unattended ceremonies. Status becomes 'abandoned'.
  --   'expired'      — ran past the max session duration with no conclusion.
  ADD COLUMN IF NOT EXISTS close_reason     varchar(24),
  -- Denormalised outcome counters. The history LIST renders from these alone; the
  -- per-session fan-out to participants happens only when a row is opened. Without
  -- them "show me the last 20 standups" is 20 extra participant queries.
  ADD COLUMN IF NOT EXISTS humans_expected  integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS humans_present   integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reassigned_count integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dispatched_count integer     NOT NULL DEFAULT 0,
  -- Set when the invite fan-out ran, so the sweep never re-notifies a room twice.
  ADD COLUMN IF NOT EXISTS notified_at      timestamp;

COMMENT ON COLUMN ceremony_sessions.close_reason IS
  'Why the session ended: facilitator (a human closed it) | unattended (the manager conducted it with no humans) | no_humans (nobody came and unattended ceremonies are not granted — status abandoned) | expired (ran past the max duration).';

COMMENT ON COLUMN ceremony_sessions.status IS
  'active | completed | abandoned. abandoned = concluded without being conducted (see close_reason); it still frees the partial unique index so the next scheduled ceremony can open.';

-- The history read: newest sessions for a board+kind. Partial on the concluded
-- states because the active-session lookup already has its own index and history
-- never asks for active rows.
CREATE INDEX IF NOT EXISTS idx_ceremony_sessions_history
  ON ceremony_sessions(tenant_id, project_id, kind, started_at DESC)
  WHERE status <> 'active';

-- The reaper's due query: active sessions old enough to conclude. Tiny by
-- construction (at most one active row per board+kind).
CREATE INDEX IF NOT EXISTS idx_ceremony_sessions_active_started
  ON ceremony_sessions(started_at)
  WHERE status = 'active';

-- ── (3) ceremony autonomy on the EXISTING manager policy tiers ──────────────
--
-- Nullable at BOTH tiers: null = "this tier has no opinion, inherit downward",
-- which is what makes the fold in managerPolicy.ts a genuine three-level override
-- rather than a second copy of the defaults. Note that unlike the 0265 project
-- columns these are nullable on the project tier too — they are new, so no project
-- has ever expressed an opinion about them and none should be pinned to one by an
-- ADD COLUMN default.

ALTER TABLE tenant_manager_defaults
  ADD COLUMN IF NOT EXISTS allow_unattended_ceremonies     boolean,
  ADD COLUMN IF NOT EXISTS allow_agent_reassignment        boolean,
  ADD COLUMN IF NOT EXISTS agent_reassign_idle_hours       integer,
  ADD COLUMN IF NOT EXISTS agent_reassign_max_per_session  integer;

ALTER TABLE project_manager_configs
  ADD COLUMN IF NOT EXISTS allow_unattended_ceremonies     boolean,
  ADD COLUMN IF NOT EXISTS allow_agent_reassignment        boolean,
  ADD COLUMN IF NOT EXISTS agent_reassign_idle_hours       integer,
  ADD COLUMN IF NOT EXISTS agent_reassign_max_per_session  integer;

COMMENT ON COLUMN tenant_manager_defaults.allow_unattended_ceremonies IS
  'May the AI Manager CONDUCT a ceremony with no humans present? A CEILING (an explicit false cannot be re-granted by a project). NULL = no opinion; nothing set anywhere = false, and a session nobody joined is closed as abandoned instead — it never silently acts on the team''s behalf.';

COMMENT ON COLUMN tenant_manager_defaults.allow_agent_reassignment IS
  'May a ceremony move a ticket off an absent human and onto an agent? A CEILING. NULL = no opinion; nothing set anywhere = false. Absence alone NEVER triggers this — the ticket must also be idle past agent_reassign_idle_hours.';

COMMENT ON COLUMN tenant_manager_defaults.agent_reassign_idle_hours IS
  'The CONDITION on agent reassignment: how long a ticket must have sat untouched before an absent owner''s claim on it lapses. Resolved most-restrictive-wins (the LARGEST value across tiers), so a project can demand more patience than the workspace but never less. Default 48.';

COMMENT ON COLUMN tenant_manager_defaults.agent_reassign_max_per_session IS
  'Hard bound on reassignments one ceremony may make. Resolved most-restrictive-wins (the SMALLEST value across tiers). Default 3 — a standup that quietly re-homed an entire sprint would be indistinguishable from a bug.';

COMMENT ON COLUMN project_manager_configs.allow_unattended_ceremonies IS
  'Per-project grant: may the AI Manager conduct this project''s ceremonies with no humans present? NULL = inherit tenant_manager_defaults (itself falling back to false).';

COMMENT ON COLUMN project_manager_configs.allow_agent_reassignment IS
  'Per-project grant: may this project''s ceremonies reassign an absent human''s stale ticket to an agent? NULL = inherit tenant_manager_defaults (itself falling back to false).';

COMMENT ON COLUMN project_manager_configs.agent_reassign_idle_hours IS
  'Per-project idle threshold before an absent owner''s claim lapses. NULL = inherit. Folded most-restrictive-wins (largest value), so this can only ever be MORE patient than the workspace.';

COMMENT ON COLUMN project_manager_configs.agent_reassign_max_per_session IS
  'Per-project cap on reassignments per ceremony. NULL = inherit. Folded most-restrictive-wins (smallest value), so this can only ever be TIGHTER than the workspace.';
