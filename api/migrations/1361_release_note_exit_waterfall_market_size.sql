-- 1361 · Release note: model exit payouts by share class and size your market on the canvas.
--
-- PRD 25 slice C (docs/specs/measure.md P25-04, P25-05). `new`: the exit waterfall
-- (application/finance/exitWaterfall.ts) pays preferences by seniority, converts
-- non-participating classes at their breakpoint and reports payout per holder; the
-- `exitScenario` and `marketSize` canvas kinds expose it and TAM/SAM/SOM, and the deck's
-- market slide binds to the marketSize object.
--
-- Marketing copy, framed on what a person can now DO (see the header of 1105). Fixed id so the
-- migration is safe to replay; `emailed_at` left NULL so the product-updates digest announces it
-- exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0021-4000-8000-000000001361',
    '2026.11.153',
    'Model what every shareholder takes home at exit — and size your market beside it',
    'Drop an Exit scenario onto a board and it reads your real cap table: enter an exit value and any debt, and it pays liquidation preferences in seniority order, converts a preferred class the moment converting pays it more, and shows the payout and multiple for every holder, with the exit values where each class flips. Run a range to see sensitivity, or ask for the exit value that returns a target. A Market size object sits beside it: work TAM, SAM and SOM bottom-up from customers and ARPA, check it against a cited top-down figure, and it flags the sizing as inconsistent if SOM exceeds SAM or SAM exceeds TAM. Your pitch deck''s market slide now reads straight from that object. These are models, not legal advice — your term sheets decide the real payout.',
    'new',
    'live',
    '2026-11-20 12:00:00'
  )
ON CONFLICT (id) DO NOTHING;
