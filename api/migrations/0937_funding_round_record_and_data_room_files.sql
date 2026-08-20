-- The round header becomes a RECORD, and a data room can hold a legal file.
-- Closes the two residuals of FO-E1/FO-E2 (ROADMAP FO-E5 and its sibling).
--
-- ── 1 · `funding_rounds` had no writer, and one column was a stored total ───
-- `grep` returned exactly two references to this table — the Drizzle declaration
-- and the entity registration — so the `fundingRound` card's `roundType`,
-- `targetAmount`, `valuation` and `closeTarget` were typed onto board JSON beside
-- an empty table. Three of those four had no column to live in, which is why the
-- card could never be anything but authored.
--
-- `amount_raised` is DROPPED rather than filled. It is a stored total the
-- allocations can contradict — the exact shape migration 0464 forbids for
-- `work_estimates.lines` — and the raise projection now derives "how much have we
-- closed" from the `deals` rows themselves. One fact, one place: the round says
-- what was PLANNED, the allocations say what actually happened, and no column can
-- disagree with the rows under it.
--
-- `pre_money` / `post_money` stay: a valuation is negotiated, not summed, so it is
-- a fact about the round and not a rollup of anything.

ALTER TABLE funding_rounds
  -- 'pre-seed' | 'seed' | 'series-a' | 'bridge' | 'safe'. The canvas card's own
  -- vocabulary, which had nowhere to be stored.
  ADD COLUMN IF NOT EXISTS round_type      varchar(24),
  -- What the round is RAISING. Distinct from what has closed, which is derived.
  ADD COLUMN IF NOT EXISTS target_amount   numeric(18, 2),
  -- The date the founder intends to close on — a real deadline a `trigger` can
  -- watch, which is why it is a column and not prose in a card.
  ADD COLUMN IF NOT EXISTS close_target_at timestamp;

ALTER TABLE funding_rounds DROP COLUMN IF EXISTS amount_raised;

-- ── 2 · A data room could hold an obligation and not a FILE ────────────────
-- `data_rooms` reads its contents from `due_diligence_documents` joined through
-- its checklists, so an encrypted `legal_document_files` row — the formation
-- certificate, the executed IP assignment, the first thing a fund asks for —
-- could not be put in a room at all. Both already resolve to a `kernel.artifacts`
-- row, so this is a JOIN and not a second store.
--
-- On `legal_document_files` rather than a link table: a file belongs to at most
-- one room at a time (moving it is an act, not a fan-out), and a join table would
-- make "which room is this in" a query instead of a column. ON DELETE SET NULL,
-- because deleting a room must not delete the executed contract that was in it.

ALTER TABLE legal_document_files
  ADD COLUMN IF NOT EXISTS data_room_id integer REFERENCES data_rooms(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_legal_document_files_data_room
  ON legal_document_files (data_room_id) WHERE data_room_id IS NOT NULL;
