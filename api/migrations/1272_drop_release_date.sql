-- 1272 · Product release dates — CONTRACT step of 1266 (plan vs actual).
--
-- Ship ONLY after the Worker that reads `target_date` / `released_at` is live. Until
-- then the old Worker still reads and writes `release_date`, which is why 1266 kept it.
--
-- 1. Re-run 1266's fold (`fold_product_release_date()`, the one copy) for whatever the
--    old Worker wrote during the deploy window: a release it created or moved with
--    only `release_date`, a release it marked released without `released_at`, or one
--    it moved back to planned while leaving `released_at` set. The fold's guards
--    abort here, before the drop, if any `release_date` would be lost.
-- 2. Drop `release_date` and the fold function.
-- 3. Add the invariant the service now keeps: an actual ship date exists only on a
--    release that shipped (released) or shipped and was rolled back (cancelled).
--    Added here rather than in 1266 because the old Worker could still write a
--    planned row with a ship date during the window. The fold in step 1 has just
--    cleared every such row, so the constraint validates.
--
-- Idempotent: each step is guarded on the column / function / constraint existing.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'product_releases'
       AND column_name = 'release_date'
  ) THEN
    PERFORM fold_product_release_date();
    ALTER TABLE product_releases DROP COLUMN release_date;
  END IF;
END $$;

DROP FUNCTION IF EXISTS fold_product_release_date();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'product_releases_released_at_status_chk'
       AND conrelid = 'product_releases'::regclass
  ) THEN
    ALTER TABLE product_releases
      ADD CONSTRAINT product_releases_released_at_status_chk
      CHECK (released_at IS NULL OR status IN ('released', 'cancelled'));
  END IF;
END $$;
