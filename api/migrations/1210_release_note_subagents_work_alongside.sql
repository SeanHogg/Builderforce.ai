-- 1210 · Release note: one chat, a whole team working — sub-agents run side by side.
--
-- `new`: a chat's agent used to run a helper INSIDE one tool call — it stopped until the
-- helper finished, the helper had an 8-step budget, it had no name in the chat, and the
-- container / Actions runtimes could not start one at all. A sub-agent is now the same
-- run with an owner pointer on every surface (editor: RunLineage; cloud: its own durable
-- execution, migration 1209): it starts at once, works beside its owner with no step
-- cap, posts under its own name, reports back, and can be redirected (@name / #ticket),
-- stopped, or waited on. Live sub-agents are listed in the chat's Agents roster, a
-- waiting owner gives way to the person's message, and Copy diagnostics reads every
-- sub-agent from its own run. Shipped in VSIX 2026.10.19–2026.10.22, api 2026.10.30+.
--
-- Fixed id so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces it exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0010-4000-8000-000000001210',
    '2026.10.22',
    'One chat, a whole team working: sub-agents run side by side',
    'Give the agent in your chat a spec with several parts and it no longer does them one at a time. It hands each part to a sub-agent, either an anonymous helper or one of your own agents by name, and they all start at once. The agent that started them keeps working instead of waiting, and when each sub-agent finishes, its report comes back on its own. Every working sub-agent appears in the chat''s Agents list and posts under its own name, so you always know who is doing what. To redirect one, talk to it with @name or mention the ticket it is on. You can stop one, or stop them all. If the main agent is waiting on its team and you message it, it stops waiting and answers you. Sub-agents have no step limit, can start their own sub-agents up to three levels deep, and work the same way in VS Code and in every cloud runtime. The main agent still builds and tests the combined change before it commits. Copy diagnostics now includes every sub-agent too. Update the VS Code extension to 2026.10.22 or later.',
    'new',
    'live',
    '2026-10-11 20:00:00'
  )
ON CONFLICT (id) DO NOTHING;
