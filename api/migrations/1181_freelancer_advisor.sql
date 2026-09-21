-- Add advisor opt-in to freelancer_profiles for marketplace category filter
-- Supports ?category=advisors on the talent browse endpoint

ALTER TABLE freelancer_profiles ADD COLUMN is_advisor boolean NOT NULL DEFAULT false;

CREATE INDEX idx_freelancer_profiles_advisor ON freelancer_profiles(published, is_advisor) WHERE is_advisor = true;
