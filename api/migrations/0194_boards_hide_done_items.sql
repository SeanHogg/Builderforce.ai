-- 0194_boards_hide_done_items.sql
-- Board-level "hide done items" toggle. When set, the task board hides tickets
-- sitting in a terminal (Done) lane so the board shows only live work. Pure
-- display preference — does not affect the coordinator lifecycle or capacity.
--
-- Idempotent / re-runnable: ADD COLUMN IF NOT EXISTS with a default.

ALTER TABLE boards ADD COLUMN IF NOT EXISTS hide_done_items BOOLEAN NOT NULL DEFAULT FALSE;
