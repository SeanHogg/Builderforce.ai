-- 0087_agent_engine.sql
-- Cloud agents can run on one of two agent runtimes:
--   builderforce-v1 — the pi-coding-agent embedded runner (default; existing behavior)
--   builderforce-v2 — the Claude Agent SDK (@anthropic-ai/claude-agent-sdk) runner
-- The chosen engine is dispatched to the agent-runtime so it selects the matching loop.
ALTER TABLE ide_agents
  ADD COLUMN IF NOT EXISTS engine text NOT NULL DEFAULT 'builderforce-v1';
