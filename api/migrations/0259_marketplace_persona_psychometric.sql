-- Psychometric profile for TENANT-PUBLISHED personas (Pro feature).
-- platform_personas (admin-managed) already carries `psychometric` (mig 0199); this
-- gives the same behaviour-bearing trait vector to the personas a tenant publishes
-- via /personas, so an installed marketplace persona actually shapes its agents
-- (compiled at run time into prompt directives + exec params + limbic setpoints).
-- JSON shape mirrors PsychometricProfile { vector, enneagramType?, mbti?, frameworks?, source?, notes? }.
ALTER TABLE marketplace_personas ADD COLUMN IF NOT EXISTS psychometric text; -- JSON, null = no profile
