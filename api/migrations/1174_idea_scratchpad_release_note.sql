-- 1174 · Release note: an idea scratchpad on the canvas — write ideas down in seconds and
-- track every one from first thought to tested.
--
-- `new`: the canvas could hold a researched segment, a battlecard and an experiment, and
-- had nowhere to put the half-formed idea that started them. The `idea` object and the
-- Ideas surface are a capability that did not exist before (ported from BurnRateOS's Ideas
-- Scratch Pad as a canvas kind, not a second editor).
--
-- Marketing copy, framed on what a person can now DO (see the header of 1105). Fixed id so
-- the migration is safe to replay, `emailed_at` left NULL so the product-updates digest
-- announces it exactly once.
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
    'a1b2c301-0009-4000-8000-000000001174',
    '2026.9.32',
    'Write every idea down — and see which ones you have actually tested',
    'Every canvas now has an Ideas scratchpad. Open Ideas next to Board, type the thought the moment you have it — a sentence is enough — and press Capture. Each idea becomes a card on your board, so Brain can research it with you, and the scratchpad keeps the whole list: newest first, sorted by stage from Captured through Exploring, Validating and Validated, to Parked, Dropped or Promoted. One click on "Plan an interview" puts a customer interview on the board, links it to the idea and moves the idea to Validating. Every idea then shows how many interviews and experiments have actually tested it, and the scratchpad tells you how many of your open ideas nobody has talked to a customer about yet — so the next conversation you book is the one that matters.',
    'new',
    'live',
    '2026-09-15 12:00:00'
  )
ON CONFLICT (id) DO NOTHING;
