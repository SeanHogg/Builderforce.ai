-- 0299_two_way_reviews_jss.sql
-- Two-sided reputation for the freelance marketplace (Upwork-parity P1 #3).
--
-- Before this, freelancer_reviews was employer→freelancer ONLY (one row per
-- engagement, unique on engagement_id). This adds the reverse direction so a
-- freelancer can rate a client too, and both sides carry trust signals:
--
--   * direction = 'employer_to_freelancer' (the freelancer's received rating — the
--     default, so every pre-existing row back-fills correctly) OR
--     'freelancer_to_employer' (the client's received rating). The reviewed party is
--     implied by direction: freelancer_user_id for the former, tenant_id for the
--     latter. reviewer_user_id is always the actual author.
--
-- The single-column unique is replaced by (engagement_id, direction) so each side may
-- leave exactly one review per engagement. A Job Success Score + Top-Rated /
-- Rising-Talent badge are DERIVED (not stored) in the cached freelancer stat block —
-- no new column needed. Idempotent throughout.

ALTER TABLE freelancer_reviews ADD COLUMN IF NOT EXISTS direction VARCHAR(24) NOT NULL DEFAULT 'employer_to_freelancer';
-- Optional "would work with them again" signal (feeds JSS + client reputation).
ALTER TABLE freelancer_reviews ADD COLUMN IF NOT EXISTS would_work_again BOOLEAN;

-- Swap the single-column unique for a per-direction one so both sides can review.
DROP INDEX IF EXISTS uq_review_engagement;
CREATE UNIQUE INDEX IF NOT EXISTS uq_review_engagement_direction ON freelancer_reviews(engagement_id, direction);

-- Read paths: the freelancer's received rating (profile), and the client's received
-- rating (job browse / vetting).
CREATE INDEX IF NOT EXISTS idx_reviews_freelancer_dir ON freelancer_reviews(freelancer_user_id, direction);
CREATE INDEX IF NOT EXISTS idx_reviews_tenant_dir     ON freelancer_reviews(tenant_id, direction);
