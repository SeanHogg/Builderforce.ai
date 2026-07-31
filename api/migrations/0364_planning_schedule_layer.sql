-- 0364 — Planning gets a SCHEDULING layer: manager authority to place work in time,
--        and provenance for how an Epic was broken down.
--
-- THE PROBLEM. The planning spine rendered every node as "no dates" at every level —
-- objective, initiative, epic, task — and drew no dependency edges, on a board with
-- hundreds of tickets. That was not missing data entry. NOTHING in the agentic path
-- ever wrote a date:
--
--   • `TaskService.decomposeEpic` hardcoded `startDate: null, dueDate: null` on every
--     child it fanned out — and fan-out is the dominant way work is created.
--   • The MCP tool surface agents actually call (`tasks.create` / `tasks.update`)
--     exposed `dueDate` but no `startDate` at all, so an agent could not schedule
--     even deliberately.
--   • The AI Manager READ `due_date` to compute an urgency score (`prioritize.ts`)
--     but never wrote one — so the urgency term was scoring a column that was always
--     null, on every ticket, forever.
--   • `task_dependencies` (0121) existed with a full DAG-validating write path, but
--     nothing except two human UI screens ever inserted a row.
--
-- Decomposition answered "what work". The manager answered "in what order, by score".
-- Neither answered "WHEN" or "AFTER WHAT". This migration adds the two columns that
-- part of the fix needs; the rest is code (see application/planning/scheduleWork.ts,
-- the one pure planner both writers now share).

-- ── (1) manager authority to SCHEDULE ───────────────────────────────────────
-- A tuning knob, not a permission, so it follows the plain last-tier-wins branch of
-- resolveTieredManagerPolicy (project overrides workspace overrides hardcoded), exactly
-- like auto_assign / auto_business_value / auto_prioritize.
--
-- Defaulted TRUE on the project tier to match its siblings: a project that has a config
-- row already opted into manager grooming, and placing already-owned work on a timeline
-- is reversible and non-destructive (it writes only start_date/due_date on tickets that
-- have NEITHER, and never touches a date a human set). The workspace tier stays NULLABLE
-- because NULL is the meaningful "this workspace has no opinion" state.
ALTER TABLE project_manager_configs
  ADD COLUMN IF NOT EXISTS auto_schedule boolean NOT NULL DEFAULT true;

ALTER TABLE tenant_manager_defaults
  ADD COLUMN IF NOT EXISTS auto_schedule boolean;

COMMENT ON COLUMN project_manager_configs.auto_schedule IS
  'Whether the AI Manager may place unscheduled tickets on the timeline (write start_date/due_date in rank order, honouring the task_dependencies DAG). Only ever fills tickets that have NEITHER date — a human-set date is never overwritten.';

COMMENT ON COLUMN tenant_manager_defaults.auto_schedule IS
  'Workspace default for manager scheduling. NULL = no opinion, inherit the hardcoded default (true). A plain override, not a ceiling: a project row wins.';

-- ── (2) how an Epic was actually decomposed ─────────────────────────────────
-- `llmEpicDecomposer` falls back to the deterministic markdown-checklist parser on ANY
-- failure (gateway 4xx, kill switch, malformed JSON) — `catch { return heuristic… }`.
-- The fallback produces a visibly worse plan (it used to turn every bullet, including
-- markdown sub-headers like `- **API Endpoints**:`, into a ticket), and until now the
-- data carried no trace of which one ran. Recording it makes the degraded path
-- auditable instead of silent.
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS decomposition_source varchar(16);

COMMENT ON COLUMN tasks.decomposition_source IS
  'For an EPIC: which reasoning step produced its children — ''llm'' (real BA-style assessment), ''heuristic'' (the degraded markdown-checklist fallback) or ''manual'' (caller-supplied plan). NULL on anything never decomposed.';

-- Scheduling reads/writes are always project-scoped and only ever target tickets with
-- NO dates, so the manager's SCHEDULE pass filters on exactly this shape every tick.
-- Partial index: only the unscheduled rows are ever scanned, so it stays tiny on a
-- board whose tickets are mostly already dated.
CREATE INDEX IF NOT EXISTS idx_tasks_unscheduled_by_project
  ON tasks(project_id)
  WHERE start_date IS NULL AND due_date IS NULL AND archived = false;
