-- 0316_release_task_association.sql
-- EMP-10a — Release-picker association.
-- A product release already exists as a first-class entity (product_releases, 0227)
-- and tasks already carry release_id (0227). No new release table or task column is
-- needed. This migration only makes a release PROJECT-SCOPABLE so the release-picker
-- can list "releases for this project", and adds the target/actual dates the picker
-- and the delivery lens want. All additive + nullable → zero backfill. Idempotent.

ALTER TABLE product_releases ADD COLUMN IF NOT EXISTS project_id  INTEGER REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE product_releases ADD COLUMN IF NOT EXISTS target_date TIMESTAMP;
ALTER TABLE product_releases ADD COLUMN IF NOT EXISTS released_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_product_releases_project ON product_releases(tenant_id, project_id);
