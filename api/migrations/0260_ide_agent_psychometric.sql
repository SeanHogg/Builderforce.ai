-- Per-agent personality (Pro feature).
-- An agent can carry its OWN psychometric trait vector, independent of any persona
-- assigned to it — so each agent (ide_agents row) can be given a distinct personality
-- from the Workforce agent editor. Compiled at run time (alongside assigned personas)
-- into prompt directives + exec params + limbic setpoints.
-- JSON shape mirrors PsychometricProfile { vector, enneagramType?, mbti?, frameworks?, source?, notes? }.
ALTER TABLE ide_agents ADD COLUMN IF NOT EXISTS psychometric text; -- JSON, null = no profile
