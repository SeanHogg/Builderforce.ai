-- 1201 · Release note: the canvas knows where you are — Operate, Launch, and a path for every phase.
--
-- `new`: PRD 32 (`specs/builderforce/32-prd-canvas-phase-lens.md`). A canvas's phase
-- (Idea → Make → Run → Measure → Reach) is now per canvas and defaults to the first
-- phase not yet done. Readiness is derived from the board's own objects
-- (`lib/canvasPhaseReadiness.ts`) and never gates: an unready phase opens with a path
-- card ("Go to Run" / "Let Brain deploy it"). The board lens rings the phase's object
-- kinds and dims the rest (••• → Phase focus), a ghost card marks where the phase's
-- first object goes, the room lights the phase's station, the command bar tints the
-- phase's group and starting points lead with the phase's starters. App now starts at
-- Make. Two new surfaces: Operate (from Run: deployments, releases, app status) and
-- Launch (at Reach: Prove it / Publish / Sell / Tell people). Insights leads with
-- "This canvas".
--
-- Fixed id so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces it exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0010-4000-8000-000000001201',
    '2026.10.18',
    'The canvas knows where you are: Operate, Launch, and a path for every phase',
    'Every canvas now knows which part of the journey it is in (Idea, Make, Run, Measure or Reach) and opens on the next step you have not done yet. Each phase shows a tick when it is done and tells you when it needs an earlier one, but nothing is ever locked. Open Measure before anything is live and you get the shortest way there instead of an empty screen: "Go to Run", or one press to let Brain deploy it. The board brings the cards that matter for the phase forward and fades the rest (turn it off under Phase focus in the board menu), and a dashed card shows where the phase''s first object goes. The room lights the phase''s station, the command bar highlights the phase you are in, and starting points lead with ideas for that phase. Two new places: Operate, from Run, shows what is deployed, your releases and whether the app is live. Launch, at Reach, puts proving it, publishing, selling and telling people in one spot. Insights now opens on this canvas''s own numbers.',
    'new',
    'live',
    '2026-10-04 23:30:00'
  )
ON CONFLICT (id) DO NOTHING;
