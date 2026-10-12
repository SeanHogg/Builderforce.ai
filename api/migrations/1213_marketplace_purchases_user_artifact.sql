-- 1213 · Unique user-scoped marketplace purchases.
--
-- Skill and persona rows carry a null tenant_id (bought by a PERSON, not a
-- workspace). The existing unique index only covers tenant-scoped agent rows
-- (`WHERE tenant_id IS NOT NULL`), so a replayed skill checkout could insert a
-- second charge. This is the other half: one (user, type, slug) while tenant_id
-- is null. Duplicate rows from the old unverified purchase path are collapsed
-- first so the index can land.

DELETE FROM marketplace_purchases a
USING marketplace_purchases b
WHERE a.tenant_id IS NULL
  AND b.tenant_id IS NULL
  AND a.user_id = b.user_id
  AND a.artifact_type = b.artifact_type
  AND a.artifact_slug = b.artifact_slug
  AND a.id > b.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_marketplace_purchases_user_artifact
  ON marketplace_purchases (user_id, artifact_type, artifact_slug)
  WHERE tenant_id IS NULL;
