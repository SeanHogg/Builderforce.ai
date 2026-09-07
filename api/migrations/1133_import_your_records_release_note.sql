-- Publish the release note for record import (the /import page over /api/import).
--
-- The board-deck lenses (People, R&D, Quality, AI) read from tables no connector
-- fills, and the only way in was one tracker row at a time. An import endpoint
-- existed off the Insights API, spoken only by the Brain, and an /import page
-- existed that nothing linked to, knew one generic "record", and ended every
-- submission with a timer and an invented reference number.
--
-- The page is now a real front on ONE import surface: kinds and columns come from
-- the server's registry, a file is mapped onto them, checked client-side AND by a
-- server dry run, then posted in batches with real progress and the server's own
-- verdict. It is a tab of Insights, so it finally has a door. This is a `new`
-- note, not an `improvement`: the destination did not exist on any path a user
-- could reach.
--
-- Fixed id so the migration is safe to replay, and `emailed_at` left NULL so the
-- product-updates digest announces it exactly once. `version` is the frontend
-- release the page is live in.
INSERT INTO release_notes (
  id,
  version,
  title,
  body,
  category,
  stage,
  published_at
) VALUES
  (
    'a1b2c301-0005-4000-8000-000000000002',
    '2026.9.13',
    'Import a quarter of records at once, and watch the board lenses move',
    'The People, R&D, Quality and AI lenses on Insights always drew from real tables — and for the datasets with no connector, the only way to fill them was one row at a time. Import is now a tab of Insights. Pick a dataset, download its template or drop the file you already have, and your columns are matched onto the server''s own registry — required ones starred, examples in every placeholder. Every cell is checked against its column type before anything is written, and the server runs the same file as a dry run and tells you which rows it would write. Then the valid rows go up in batches, with a progress bar that moves when the server acknowledges each one, and a receipt that says exactly what landed. The guided path still takes a single record with each field checked as you go; it now posts through the same door and shows the server''s answer. The Brain''s board_data.import tool speaks the same contract, dry run included.',
    'new',
    'live',
    '2026-09-06 18:00:00'
  )
ON CONFLICT (id) DO NOTHING;
