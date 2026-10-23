-- 1252 · Release note: BuilderForce in VS Code's agent chat area, beside your code.
--
-- `new`: before this, the BuilderForce chat could only open as an editor tab, taking the
-- space the code it was changing needed. It now has its own tab in the editor's agent chat
-- area (the secondary sidebar, beside Chat / Claude Code / Codex), and every way of opening a
-- chat lands there. Blog: /blog/builderforce-in-your-editors-agent-chat-area.
--
-- Marketing copy, framed on what a person can now DO (see the header of 1105). Fixed id so the
-- migration is safe to replay, `emailed_at` left NULL so the product-updates digest announces it
-- exactly once.
INSERT INTO release_notes (
  id,
  version,
  title,
  body,
  category,
  stage,
  published_at
) VALUES
  (
    'a1b2c301-0009-4000-8000-000000001252',
    '2026.10.59',
    'BuilderForce in VS Code''s agent chat area, right beside your code',
    'BuilderForce now has its own tab in VS Code''s agent chat area, next to Chat, Claude Code and Codex. Your code keeps the editor at full width while the conversation that changes it sits alongside: watch the edits land, approve tool calls and review changes without splitting a pane or switching tabs. Open Chat, a session from the sidebar, a task from the board and a Project 360 prompt all land in that same tab. It is the same conversation, runs and model choice as on the web. Boards still open in the editor, and the per-session tab setting still gives you one tab per conversation.',
    'new',
    'live',
    '2026-10-22 18:00:00'
  )
ON CONFLICT (id) DO NOTHING;
