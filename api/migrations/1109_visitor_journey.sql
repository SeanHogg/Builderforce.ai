-- 1109 · The anonymous visitor journey — one stream, not a demo-only one.
--
-- `demo_events` was created (0360) as "anonymous demo-funnel telemetry", and it
-- is already the right SHAPE for the whole anonymous journey: an append-only
-- per-visitor stream of (kind, path, metadata, occurred_at) keyed by the same
-- opaque `visitor_id` as `marketing_sessions`. What it was not was site-wide —
-- only `DemoModeProvider` wrote to it, so a visitor who typed a prompt into the
-- landing composer and then walked through four pages left a record of the
-- prompt and NOTHING about where they went, when they left, or whether they
-- came back.
--
-- A site-wide page view is the same fact as a demo page view with `persona`
-- NULL, so this renames the table to what it now is rather than adding a second
-- one next to it (3NF: a new kind is a column value, not a new table).
--
-- `visit_id` is the one genuinely new fact. "Left" and "came back" are not
-- properties of an event; they are the boundaries BETWEEN contiguous runs of
-- them. Grouping by a client-minted visit token makes both answerable with a
-- GROUP BY instead of a window function over gaps, and makes "second visit
-- converted" a join rather than a guess.

ALTER TABLE demo_events RENAME TO visitor_events;
ALTER INDEX  idx_demo_events_persona_time RENAME TO idx_visitor_events_persona_time;
ALTER INDEX  idx_demo_events_visitor      RENAME TO idx_visitor_events_visitor;
ALTER SEQUENCE IF EXISTS demo_events_id_seq RENAME TO visitor_events_id_seq;

ALTER TABLE visitor_events ADD COLUMN IF NOT EXISTS visit_id varchar(64);

-- The journey read is always "this visitor, in visit order" — the flow graph
-- walks consecutive pairs within one visit, and the per-visitor timeline reads
-- every visit newest-first.
CREATE INDEX IF NOT EXISTS idx_visitor_events_visit
  ON visitor_events (visitor_id, visit_id, occurred_at);

-- The prompt belongs to a visit too. Without this the graph would have to guess
-- which visit a prompt fell in by comparing timestamps against event ranges,
-- which is a join that gets the answer wrong exactly when it matters: a visitor
-- who came back and typed a second prompt. The client already knows the visit it
-- is in when it submits, so the honest answer is to record it.
ALTER TABLE marketing_session_prompts ADD COLUMN IF NOT EXISTS visit_id varchar(64);
CREATE INDEX IF NOT EXISTS idx_marketing_session_prompts_visit
  ON marketing_session_prompts (visitor_id, visit_id, created_at);

-- The autovacuum override travels with the table. `1104_swept_table_autovacuum.sql`
-- set it on `demo_events`; a rename keeps the storage parameters, but the guard
-- reads the CURRENT name, and a retention-swept table with no override is how a
-- high-churn stream ends up with bloat nobody notices. Restated here so the two
-- agree by inspection rather than by remembering that a rename preserved it.
ALTER TABLE visitor_events SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000,
                                autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 1000);
