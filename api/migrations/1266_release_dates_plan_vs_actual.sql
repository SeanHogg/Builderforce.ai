-- 1266 · Product release dates become PLAN vs ACTUAL (operator decision) — EXPAND step.
--
-- `product_releases` carried three dates: `release_date` (0059, the release-planning
-- tracker's single "Date" field), `target_date` and `released_at` (0316, the release
-- picker's pair). `release_date` meant the plan on one surface and the ship date on
-- another, so no rollup could tell a commitment from an outcome. From here on:
--
--   target_date  the planned ship date
--   released_at  when it actually shipped (TIMESTAMPTZ) — stamped by the transition
--                to `released`, cleared when a release moves back to planned /
--                in_progress, KEPT when a shipped release is cancelled (rolled back)
--                (ProductReleaseService + domain/delivery/releaseSchedule.ts)
--
-- Expand/contract. This migration runs BEFORE the new Worker deploys, while the old
-- Worker still reads and writes `release_date`, so the column STAYS. It folds every
-- row onto the pair now; 1268 (shipped once the new Worker is live) re-runs the same
-- fold for anything the old Worker wrote during the deploy window, then drops the
-- column, this function, and adds the status/released_at CHECK.
--
-- The fold — `fold_product_release_date()`, ONE copy for both migrations:
--   a. legacy statuses onto the release vocabulary, mirroring 1160's mapping
--      (shipped -> released, frozen -> in_progress, rolled_back -> cancelled); any
--      other unknown status aborts the migration rather than being guessed at;
--   b. a `release_date` that the pair will NOT carry (it disagrees with the target
--      and is not the kept ship date) is written into `notes` as
--      "Former release date: YYYY-MM-DD" before anything else moves, so no fact is lost;
--   c. a release with no plan takes its old `release_date` as `target_date`;
--   d. a released release with no actual date takes the old `release_date`, else
--      `updated_at` (the last write — the closest record of when it was marked released);
--   e. planned / in_progress releases carry no actual date; a cancelled release keeps
--      the ship date it has (1160 folded rolled-back plans in as cancelled);
--   f. guard: every non-null `release_date` is now carried by `target_date`,
--      `released_at` or `notes` — else the migration aborts.
-- Dates compare by calendar day (UTC): the tracker only ever wrote dates.
--
-- Idempotent: the type change is guarded on the column's current type, and the fold
-- only touches rows that still need it (the note is not appended twice).

DO $$
BEGIN
  -- released_at becomes TIMESTAMPTZ. The old TIMESTAMP values were written as UTC
  -- by the Worker, so they are read back AT TIME ZONE 'UTC'.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'product_releases'
       AND column_name = 'released_at' AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE product_releases
      ALTER COLUMN released_at TYPE TIMESTAMPTZ USING released_at AT TIME ZONE 'UTC';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION fold_product_release_date() RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
  unknown_statuses TEXT;
  unpreserved INTEGER;
BEGIN
  -- a. One status vocabulary before anything keys on it.
  UPDATE product_releases
     SET status = CASE status WHEN 'shipped' THEN 'released'
                              WHEN 'frozen' THEN 'in_progress'
                              WHEN 'rolled_back' THEN 'cancelled' END
   WHERE status IN ('shipped', 'frozen', 'rolled_back');

  SELECT string_agg(DISTINCT status, ', ') INTO unknown_statuses
    FROM product_releases
   WHERE status NOT IN ('planned', 'in_progress', 'released', 'cancelled');
  IF unknown_statuses IS NOT NULL THEN
    RAISE EXCEPTION 'product_releases has status value(s) outside the release vocabulary (planned, in_progress, released, cancelled): %. Map them before release_date is folded.', unknown_statuses;
  END IF;

  -- b. Keep a release_date the pair will not carry. It IS carried when it becomes
  --    the target (no target yet, or the same day), or when it is the actual date a
  --    shipped/cancelled row keeps (d. adopts it for a released row with none).
  UPDATE product_releases
     SET notes = concat_ws(E'\n\n', NULLIF(notes, ''),
                           'Former release date: ' || to_char(release_date, 'YYYY-MM-DD'))
   WHERE release_date IS NOT NULL
     AND target_date IS NOT NULL
     AND target_date::date <> release_date::date
     AND NOT (status IN ('released', 'cancelled') AND released_at IS NOT NULL
              AND (released_at AT TIME ZONE 'UTC')::date = release_date::date)
     AND NOT (status = 'released' AND released_at IS NULL)
     AND position('Former release date: ' || to_char(release_date, 'YYYY-MM-DD') IN COALESCE(notes, '')) = 0;

  -- c. The plan.
  UPDATE product_releases
     SET target_date = release_date
   WHERE target_date IS NULL AND release_date IS NOT NULL;

  -- d. The actual date of what has shipped.
  UPDATE product_releases
     SET released_at = COALESCE(release_date AT TIME ZONE 'UTC', updated_at AT TIME ZONE 'UTC')
   WHERE status = 'released' AND released_at IS NULL;

  -- e. Nothing that has not shipped carries an actual date.
  UPDATE product_releases
     SET released_at = NULL
   WHERE status IN ('planned', 'in_progress') AND released_at IS NOT NULL;

  -- f. Nothing release_date said is lost.
  SELECT count(*) INTO unpreserved
    FROM product_releases
   WHERE release_date IS NOT NULL
     AND (target_date IS NULL OR target_date::date <> release_date::date)
     AND (released_at IS NULL OR (released_at AT TIME ZONE 'UTC')::date <> release_date::date)
     AND position('Former release date: ' || to_char(release_date, 'YYYY-MM-DD') IN COALESCE(notes, '')) = 0;
  IF unpreserved > 0 THEN
    RAISE EXCEPTION '% product_releases row(s) would lose their release_date: it is carried by neither target_date, released_at nor notes.', unpreserved;
  END IF;
END
$fn$;

SELECT fold_product_release_date();

-- Indexes. No index ever covered `release_date`, so none is dropped. The list reads
-- newest-plan-first per tenant, and the plan-vs-actual rollup grades the shipped ones.
CREATE INDEX IF NOT EXISTS idx_product_releases_target
  ON product_releases (tenant_id, target_date DESC);
CREATE INDEX IF NOT EXISTS idx_product_releases_released
  ON product_releases (tenant_id, released_at)
  WHERE released_at IS NOT NULL;
