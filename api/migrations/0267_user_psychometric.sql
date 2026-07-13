-- Personality for HUMAN users (Pro feature).
-- Personality applies to any and all users, not just agents/personas — a person
-- carries the SAME PsychometricProfile shape an agent does, so people and agents are
-- described (and displayed) the same way. Set by the user on their own profile.
-- JSON shape mirrors PsychometricProfile { vector, enneagramType?, mbti?, frameworks?, source?, notes? }.
ALTER TABLE users ADD COLUMN IF NOT EXISTS psychometric text; -- JSON, null = no profile
