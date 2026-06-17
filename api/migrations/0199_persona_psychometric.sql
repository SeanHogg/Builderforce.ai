-- Psychometric persona profiles (Pro feature).
-- Stores the structured trait vector that gives a persona a personality, compiled
-- at execution time (in agent-runtime) into prompt directives + execution params.
-- JSON shape mirrors PsychometricProfile { vector, enneagramType?, mbti?, frameworks?, source?, notes? }.
ALTER TABLE platform_personas ADD COLUMN IF NOT EXISTS psychometric text; -- JSON, null = no profile
