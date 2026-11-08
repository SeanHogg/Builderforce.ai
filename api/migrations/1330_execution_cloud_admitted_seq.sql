-- PRD 09 D8: concurrent cloud-run cap ranked by ADMISSION order, not by execution id.
--
-- An execution row is inserted seconds before it is admitted as a cloud run (agent
-- resolution, PRD draft, a host claim window of up to 10s sit between), so a lower id can
-- be admitted AFTER a higher one. Ranking by id would let it count ahead of runs that were
-- already admitted and start more runs than the plan allows. The admission path stamps
-- `cloud_admitted_seq` from this sequence in the same UPDATE that marks the row cloud-bound,
-- and the cap counts and ranks live cloud runs by (cloud_admitted_seq, id).
--
-- Expand-only: a nullable column, a sequence and an index. No drops, no NOT NULL, no backfill
-- (legacy rows are NULL = not counted, which only ever under-counts across the deploy).
ALTER TABLE executions
  ADD COLUMN IF NOT EXISTS cloud_admitted_seq bigint;

CREATE SEQUENCE IF NOT EXISTS executions_cloud_admitted_seq;

CREATE INDEX IF NOT EXISTS idx_executions_cloud_admitted_live
  ON executions (tenant_id, status)
  WHERE cloud_admitted_seq IS NOT NULL;
