-- 0331_brain_chat_project_backfill.sql
-- One-time backfill: give a project-less Brain chat the project of the task it is
-- linked to.
--
-- A chat created from (or later linked to) a board task carries a
-- chat_ticket_links row (ticket_kind='task', ticket_ref = the tasks.id as text),
-- but brain_chats.project_id may still be NULL (e.g. a chat started globally that
-- later spawned a task). This sets project_id from the linked task so the chat
-- scopes to the right project board / 360.
--
-- Only the task-kind join is safe/simple here (tasks.id is integer; the
-- strategy-tier ids are UUIDs). Ambiguity guard: a chat can link to several tasks,
-- so we pick the MIN task project deterministically via a correlated subquery
-- rather than an unbounded join (which would multiply rows / pick nondeterministically).
--
-- Idempotent: only touches rows where project_id IS NULL, so a re-run is a no-op
-- (a chat that got a project on the first pass is skipped).

UPDATE brain_chats bc
SET project_id = (
  SELECT MIN(t.project_id)
  FROM chat_ticket_links ctl
  JOIN tasks t
    ON t.id = NULLIF(ctl.ticket_ref, '')::integer
  WHERE ctl.chat_id = bc.id
    AND ctl.ticket_kind = 'task'
    AND ctl.ticket_ref ~ '^[0-9]+$'   -- guard the ::integer cast against non-numeric refs
    AND t.project_id IS NOT NULL
)
WHERE bc.project_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM chat_ticket_links ctl
    JOIN tasks t
      ON t.id = NULLIF(ctl.ticket_ref, '')::integer
    WHERE ctl.chat_id = bc.id
      AND ctl.ticket_kind = 'task'
      AND ctl.ticket_ref ~ '^[0-9]+$'
      AND t.project_id IS NOT NULL
  );
