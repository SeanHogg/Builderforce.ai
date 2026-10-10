-- 1205 · Release note: schedule your reports and board packs from Finance.
--
-- `new`: report schedules (`report_schedules`, incl. the `board_pack` subject from
-- mig 0461) had routes and a cron and no screen — only QA schedules could be seen or
-- changed. Finance ▸ Reports now lists, creates, edits, pauses and deletes them, with
-- a board → frame picker read from `GET /api/reports/schedules/board-pack/frames`, so
-- a frame offered is one POST will accept. Beside it, the validation-engagements card
-- reads `/api/bi/validation-engagements`, which had a typed client and no reader.
--
-- Marketing copy, framed on what a person can now DO (see the header of 1105).
-- Fixed id so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces it exactly once. `version` is the frontend
-- release the surface ships in.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0010-4000-8000-000000001205',
    '2026.10.37',
    'Schedule your reports and board packs from Finance',
    'Finance has a new Reports tab. Pick a report (a daily standup, an executive summary, a portfolio rollup or a board pack), choose daily, weekly or monthly and the hour it should arrive, paste in who it goes to, and it lands in their inbox on that cadence. A board pack sends a frame from one of your boards: choose the board, then the frame, and the tiles inside it go out every month without anyone rebuilding a deck. Pause a schedule for a quarter, change who gets it, or delete it, all in one place. Next to it, a new card lists the experiments, validation dashboards and feedback collectors your workspace is running, so the evidence behind the numbers sits on the same page as the numbers.',
    'new',
    'live',
    '2026-10-10 12:00:00'
  )
ON CONFLICT (id) DO NOTHING;
