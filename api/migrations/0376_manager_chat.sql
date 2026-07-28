-- 0376 — ASK THE MANAGER: the AI Manager becomes an addressable teammate with its own
-- accountability chat on the Manager page.
--
-- WHY
--
-- Managing the backlog was a background service with no face. The Manager page could
-- show WHAT it did (the decision feed) and WHAT is stuck (the register/census), but a
-- person could not put the only question that matters to the thing responsible for it:
-- "what did you and the team get done today, and why not more?" Answering that in prose
-- from a dashboard is exactly the kind of narration the register exists to replace — so
-- instead the manager answers it itself, in a conversation, having first read its own
-- record through the manager.* / autonomy.* MCP tools.
--
-- Two pieces, both idempotent:
--
--   A. The Manager as an ordinary cloud agent (`ide_agents.builtin_kind = 'manager'`),
--      exactly like the Validator (0271), Security (0291), Product Manager + Designer
--      (0293), Incident Manager (0326) and CTO + Product Owner (0335) before it. Being
--      an ordinary agent is the point: the chat reply loop, the manager-designation
--      picker and the workforce roster all reach it through machinery that already
--      exists, and it can be REPLACED by a tenant's own agent without a special case.
--      New tenants get it from `provisionBuiltinAgents`; this backfills existing ones.
--      The bio is the persona — it is compiled into the agent's directives at reply
--      time — so it is written as a standard of conduct, not a description. It names
--      NO TOOLS: this text is persisted per tenant while the tool catalog is code, so
--      a name baked in here outlives every deploy that could correct it. The original
--      version of this INSERT named the catalog ids and shipped them to every tenant;
--      see 0379 for the repair and `application/llm/toolNaming.ts` for the class.
--
--   B. One manager chat per project (`brain_chats.origin = 'manager'`). It reuses the
--      whole Brain chat stack (messages, members, agent participants, the addressed-
--      agent reply loop, the trace) rather than growing a second conversation system.
--      The unique index makes get-or-create race-safe the same way 0294 did for the
--      team chat — two concurrent page loads must resolve the SAME chat, or the
--      transcript silently forks and half the history disappears on the next read.

-- A. The built-in Manager agent ----------------------------------------------

INSERT INTO ide_agents (id, tenant_id, name, title, bio, skills, base_model, status, runtime_support, published, price_cents, builtin_kind)
SELECT 'manager-t' || t.id, t.id, 'Manager',
       'Manager — runs the backlog and answers for what the team got done',
       'Runs this workspace''s backlog: scores each ticket''s business value, ranks the work, dates it, staffs it, dispatches it, and shepherds pull requests — then answers for the result. When asked what was accomplished, it READS ITS OWN RECORD before replying — the day''s digest, the decisions it actually took, the stall census across every ticket, what it was permitted to do and whether autonomy was paused at all — by CALLING the manager tools it was given on that turn, never by describing them or reporting that their results are missing. It answers with those numbers and never claims work it cannot point at. If little or nothing got done it says so plainly, names the specific gate that held the work — an unstaffed lane, a withheld merge authority, an exhausted token budget, a sign-off nobody gave — and states the one change that would unblock it. It does not apologise in place of explaining, and it does not describe a stalled board as progress.',
       '["backlog-management","prioritization","delivery-management","accountability","triage"]',
       'builderforce-default', 'active', 'cloud', FALSE, 0, 'manager'
FROM tenants t
WHERE NOT EXISTS (SELECT 1 FROM ide_agents a WHERE a.tenant_id = t.id AND a.builtin_kind = 'manager');

-- B. One manager chat per project --------------------------------------------
--
-- Partial + scoped exactly like `uq_team_chat_scope` (0294): the key is the project,
-- and archived rows are excluded so archiving a chat leaves room for a fresh one.

CREATE UNIQUE INDEX IF NOT EXISTS uq_manager_chat_scope
  ON brain_chats (tenant_id, project_id)
  WHERE origin = 'manager' AND is_archived = false;
