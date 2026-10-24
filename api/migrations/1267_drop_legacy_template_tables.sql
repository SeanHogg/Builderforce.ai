-- 1267 · Legacy template tables — CONTRACT step of 1263 (templates into catalog_items).
--
-- Ship ONLY after the Worker that reads templates from `catalog_items` (through
-- `application/templates/catalogTemplateStore.ts`) is live. Until then the old Worker
-- still reads and writes `kanban_templates` (+ lanes + requirements) and
-- `creation_session_templates`, which is why 1263 kept them.
--
-- 1. Re-run 1263's backfill (`backfill_legacy_templates()`, the one copy) for what
--    the old Worker wrote during the deploy window:
--      - a template it CREATED is inserted (and recorded in the ledger);
--      - a template it EDITED refreshes its copy, by the function's REFRESH RULE:
--        newest write wins per row. The copy is overwritten only when the legacy
--        `updated_at` is strictly later than the copy's, so an edit the NEW Worker
--        made in the window is never clobbered. The old Worker stamped `updated_at`
--        on every template and lane edit. `install_count` takes the greater of the
--        two counts;
--      - a copy the NEW Worker deleted is never resurrected: it is in the ledger and
--        its catalog row is gone.
--    Its count guards abort here, before anything is deleted or dropped, if a row
--    would be lost.
-- 2. Carry the old Worker's DELETES: a catalog row that IS in `templates_fold_ledger`
--    but whose legacy source row no longer exists was deleted by the old Worker in the
--    window, so its copy goes too. A row the new Worker created never entered the
--    ledger, so it can never match.
-- 3. Drop the four legacy tables (their FKs and indexes go with them), the ledger and
--    the backfill function.
--
-- Idempotent: steps 1 and 2 are guarded on the function / tables / ledger existing,
-- and every drop is IF EXISTS.

DO $$
BEGIN
  IF to_regprocedure('backfill_legacy_templates()') IS NOT NULL THEN
    PERFORM backfill_legacy_templates();
  END IF;

  IF to_regclass('public.templates_fold_ledger') IS NOT NULL THEN
    IF to_regclass('public.kanban_templates') IS NOT NULL THEN
      DELETE FROM catalog_items ci
       USING templates_fold_ledger led
       WHERE ci.id = led.catalog_id
         AND ci.kind = 'kanban_template'
         AND led.legacy_table = 'kanban_templates'
         AND NOT EXISTS (SELECT 1 FROM kanban_templates kt WHERE kt.id = led.legacy_id);
    END IF;
    IF to_regclass('public.creation_session_templates') IS NOT NULL THEN
      DELETE FROM catalog_items ci
       USING templates_fold_ledger led
       WHERE ci.id = led.catalog_id
         AND ci.kind = 'canvas_template'
         AND led.legacy_table = 'creation_session_templates'
         AND NOT EXISTS (SELECT 1 FROM creation_session_templates t WHERE t.id::text = led.legacy_id);
    END IF;
  END IF;
END $$;

DROP TABLE IF EXISTS kanban_template_lane_requirements;
DROP TABLE IF EXISTS kanban_template_lanes;
DROP TABLE IF EXISTS kanban_templates;
DROP TABLE IF EXISTS creation_session_templates;
DROP TABLE IF EXISTS templates_fold_ledger;

DROP FUNCTION IF EXISTS backfill_legacy_templates();
