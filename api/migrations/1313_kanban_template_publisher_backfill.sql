-- 1313 · Kanban template seller of record: backfill publisher_ref from the author.
--
-- `KanbanTemplateService.setPublication` now sets `publisher_ref` only when it is NULL or the caller is the
-- row's `created_by`, so a second manager can no longer redirect a sale's proceeds by re-publishing. Rows that
-- were published before the seller of record was stamped have publisher_ref NULL; the only safe owner of those
-- is their author. Both columns are varchar, so no cast is needed.
--
-- Data-only, idempotent (the predicate excludes rows already backfilled), expand-only.
SET LOCAL lock_timeout = '3s';

UPDATE catalog_items
   SET publisher_ref = created_by
 WHERE kind = 'kanban_template'
   AND published_at IS NOT NULL
   AND publisher_ref IS NULL
   AND created_by IS NOT NULL;
