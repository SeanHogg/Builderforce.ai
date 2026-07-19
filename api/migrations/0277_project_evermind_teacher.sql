-- 0277_project_evermind_teacher.sql
-- Frontier-LLM TEACHER for a project's self-learning Evermind (teacher→student
-- distillation).
--
-- The learn loop (0258/0264) adapts a project's Evermind on RAW run text. This
-- column lets a manager pin ANY gateway model (Opus, Mistral, GLM, …) as a
-- TEACHER: when set, the coordinator first asks that frontier model for the ideal
-- version of a run, then adapts the SSM on the teacher's exemplar instead of the
-- raw text — feeding a frontier LLM back into the Evermind. NULL = today's
-- behaviour (self-learning on run text only, no teacher call, no teacher cost).
ALTER TABLE project_evermind
  ADD COLUMN IF NOT EXISTS teacher_model TEXT;
