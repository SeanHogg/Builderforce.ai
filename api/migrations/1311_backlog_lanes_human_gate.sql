-- 1311 · Backlog lanes are human-gated on every live board.
--
-- Operator decision 2026-11-07 (ROADMAP "Autonomous delivery"): backlog is the STAGING
-- lane, so a ticket sitting there must never spend tokens until a person moves it out
-- ("yes, do this"). New boards already seed it `human` (swimlane/defaultSwimlanes.ts),
-- and every built-in kanban template now derives its backlog lane from the same
-- constant (kanban/templateCatalog.ts). Boards created from a template BEFORE that fix
-- were seeded `auto`, so their parked work was eligible for autonomous runs.
--
-- Scope is exactly `key = 'backlog' AND gate = 'auto'`: lanes already `human` are
-- untouched, and no other lane key is touched. The operator decision covers every live
-- board, so a lane someone had set back to `auto` by hand is included.
--
-- `gate_source` (0933: 'seed' | 'operator') records WHO set the gate, and a later seed-default
-- change must not overwrite an 'operator' choice. The human gate here is a platform
-- decision applied to every lane, not that lane's operator choosing it, so the flipped rows
-- are reset to 'seed' (the system default) rather than left claiming 'operator'.
--
-- Idempotent (a replay matches no rows) and data-only: no schema change.
UPDATE swimlanes
   SET gate = 'human',
       gate_source = 'seed',
       updated_at = NOW()
 WHERE key = 'backlog'
   AND gate = 'auto';
