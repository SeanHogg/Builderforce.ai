-- Freelancer for-hire profile: vanity slug + avatar.
--
-- Two additions so a for-hire profile reads as a real, shareable public page:
--   1) slug — a human alias used in the public URL instead of the raw user guid
--      (/talent/jane-smith rather than /talent/bf9d977f-…). Unique, case-insensitive.
--   2) avatar_key — R2 object key for an uploaded profile picture. Served publicly at
--      GET /api/freelancers/:id/avatar; the absolute URL is mirrored onto users.avatar_url
--      so the talent card / detail / marketplace all render it via the existing join.

ALTER TABLE freelancer_profiles ADD COLUMN IF NOT EXISTS slug       varchar(60);
ALTER TABLE freelancer_profiles ADD COLUMN IF NOT EXISTS avatar_key varchar(300);

-- Case-insensitive uniqueness — 'Jane-Smith' and 'jane-smith' collide. Partial so
-- profiles without a slug don't fight over NULL.
CREATE UNIQUE INDEX IF NOT EXISTS uq_freelancer_slug
  ON freelancer_profiles (lower(slug)) WHERE slug IS NOT NULL;
