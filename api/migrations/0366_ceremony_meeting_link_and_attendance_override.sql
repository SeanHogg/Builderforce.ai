-- 0366 — A ceremony and its meeting become ONE event, and attendance becomes
--        correctable by a human.
--
-- Both halves close gaps opened by 0365, and they are one migration because they are
-- one problem: 0365 made attendance a durable record, and a durable record that can be
-- WRONG — and that a second subsystem keeps a rival copy of — is worse than no record.
--
-- (1) TWO MODELS OF THE SAME EVENT. `meetings` (0292) already accepts
--     kind='standup'|'planning' and carries a full RSVP/join/leave attendance model in
--     `meeting_attendees`. `ceremony_sessions` (0119) independently models the same
--     standup and, since 0365, keeps its own attendance verdicts. Nothing connected
--     them, so a team that scheduled a standup meeting AND ran the ceremony produced
--     two unrelated attendance records for one event — and the two disagreed by
--     construction, because joining the video call did not mark you present at the
--     ceremony.
--
--     THE DECISION, made here and enforced in code: **`ceremony_sessions` owns
--     attendance.** It is the only one of the two that resolves a verdict, journals it,
--     and feeds the ceremony-autonomy rules that can move someone's work. `meetings`
--     owns the calendar entry and the video room. So the FK points ceremony → meeting
--     (the ceremony names its shell), and `POST /meetings/:id/join` now writes through
--     to the ceremony's presence via the same `recordCeremonyPresence` the round-table
--     heartbeat uses — one writer, so the two can no longer drift.
--
--     This also retires an ad-hoc key: the round table synthesised its own relay room
--     (`ceremony-<projectId>`, never persisted) while meetings used a stored per-meeting
--     `room_key`. A ceremony now has a real meeting row, so both surfaces resolve one
--     room from one column — and a ceremony inherits the calendar mirror and TURN
--     credentials the meetings join path already provides.
--
-- (2) ATTENDANCE HAD NO HUMAN OVERRIDE. The verdict is derived from the presence
--     heartbeat plus accrued speaking time. Someone who dialled in from a phone, whose
--     browser never connected, or who was on approved leave was recorded 'absent' with
--     no way to correct it — and 'absent' is an input to the rules that hand their work
--     to an agent. A derived-only record that cannot be corrected is a record that
--     quietly becomes untrue.
--
--     `attendance_source` is the important column: it distinguishes a verdict the system
--     INFERRED from one a person ASSERTED, so a re-conclude (or a late heartbeat) can
--     recompute the former without ever silently discarding the latter.
--
--     Planned leave is handled separately and automatically: `member_profiles.pto`
--     (0116) has been write-only since it was added — the Google Calendar sync fills it
--     and nothing has ever read it back. It is now read at conclude, and someone on
--     leave resolves to 'excused' (source 'pto'), never 'absent'. Being on holiday can
--     no longer contribute to your tickets being reassigned.

-- ── (1) the ceremony's companion meeting ────────────────────────────────────

ALTER TABLE ceremony_sessions
  ADD COLUMN IF NOT EXISTS meeting_id uuid REFERENCES meetings(id) ON DELETE SET NULL;

COMMENT ON COLUMN ceremony_sessions.meeting_id IS
  'The calendar/video meeting this ceremony is held in (0366). The ceremony owns ATTENDANCE; the meeting owns the calendar entry and the media room. ON DELETE SET NULL: losing the shell must never delete the attendance record held here.';

-- One meeting backs at most one ceremony. Enforced rather than assumed because the
-- write-through in POST /meetings/:id/join resolves meeting → ceremony, and a second
-- match would make "which ceremony did joining this call mark me present at" ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ceremony_sessions_meeting
  ON ceremony_sessions(meeting_id)
  WHERE meeting_id IS NOT NULL;

-- ── (2) attendance provenance + override ────────────────────────────────────

ALTER TABLE ceremony_participants
  -- Where the verdict in `attendance` came from:
  --   'derived' — inferred from presence/speaking time (the default, recomputable).
  --   'pto'     — the member had approved leave covering the ceremony; auto-'excused'.
  --   'manual'  — a manager asserted it. NEVER recomputed; a human's correction
  --               outranks every signal, which is the entire point of the column.
  ADD COLUMN IF NOT EXISTS attendance_source varchar(12)  NOT NULL DEFAULT 'derived',
  -- Why, in the corrector's own words ("dialled in from the airport").
  ADD COLUMN IF NOT EXISTS attendance_note   varchar(280),
  -- Who corrected it and when — a correction that moves work must be attributable.
  ADD COLUMN IF NOT EXISTS attendance_set_by varchar(64),
  ADD COLUMN IF NOT EXISTS attendance_set_at timestamp;

COMMENT ON COLUMN ceremony_participants.attendance_source IS
  'Provenance of the attendance verdict: derived (inferred from presence/speaking, recomputable) | pto (approved leave covered the ceremony → excused) | manual (a manager asserted it; never recomputed). This is what lets a re-conclude refresh inferred verdicts without discarding a human correction.';

COMMENT ON COLUMN ceremony_participants.attendance_set_by IS
  'users.id of the manager who corrected this verdict (manual source only). Null for derived/pto. An absence verdict is an input to the agent-reassignment rules, so changing one is attributable.';
