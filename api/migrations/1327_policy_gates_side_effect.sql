-- Migration: policy_gates.side_effect (expand step).
--
-- A gate may govern every tool of a side-effect class (read / verify / mutate) instead of
-- (or as well as) one tool name; classified by the single classifier in
-- packages/agent-tools. NULL = no side-effect criterion. Additive and nullable; idempotent.

ALTER TABLE policy_gates ADD COLUMN IF NOT EXISTS side_effect VARCHAR(10);
