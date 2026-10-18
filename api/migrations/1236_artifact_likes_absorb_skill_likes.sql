-- 1236 · ONE like store: fold `marketplace_skill_likes` into `artifact_likes`.
--
-- Two doors toggled likes on a skill, each against its own table:
--   POST /api/marketplace-stats/like      → artifact_likes (what every like button reads)
--   POST /marketplace/skills/:slug/like   → marketplace_skill_likes + a ±1 nudge on
--                                           marketplace_skills.likes (the catalogue sort key)
-- so the button count and the catalogue order disagreed, and the ±1 drifted on retries.
-- Both doors now call application/marketplace/artifactLikes.ts, which writes
-- artifact_likes and RECOMPUTES marketplace_skills.likes from it.
--
-- This carries the legacy rows across (idempotent on the primary key) and re-derives
-- every skill's counter once, so the catalogue starts from the same number the button
-- shows. The legacy table is left in place, unread, rather than dropped in the same
-- deploy as the code that stops writing it.
INSERT INTO artifact_likes (user_id, artifact_type, artifact_slug)
SELECT user_id, 'skill', skill_slug
FROM marketplace_skill_likes
ON CONFLICT DO NOTHING;

UPDATE marketplace_skills ms
SET likes = COALESCE(l.n, 0)
FROM marketplace_skills s
LEFT JOIN (
  SELECT artifact_slug, count(*)::int AS n
  FROM artifact_likes
  WHERE artifact_type = 'skill'
  GROUP BY artifact_slug
) l ON l.artifact_slug = s.slug
WHERE ms.id = s.id
  AND ms.likes IS DISTINCT FROM COALESCE(l.n, 0);
