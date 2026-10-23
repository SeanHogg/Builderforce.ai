-- 1260 · Release note: bring your skills with you — Agent Skills folders, everywhere.
--
-- `new`: before this, a skill written for another agent tool (Claude Code's .claude/skills,
-- a repo's .agents/skills) could not come into a workspace except as pasted text, losing its
-- scripts and references; nothing left the platform as a folder; and the Brain, the canvas
-- and the Studio could not use a workspace's skills at all. Skills now follow the open Agent
-- Skills standard (migration 1259 + @builderforce/agent-skills): import a folder, write one in
-- the browser, download any skill as a folder, publish one with its whole folder, and every
-- surface loads it through one tool. Blog: /blog/bring-your-skills-with-you.
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
    'a1b2c301-0009-4000-8000-000000001260',
    '2026.10.72',
    'Bring your skills with you: one skill folder, every agent',
    'The procedures your team wrote for Claude Code or a repo''s .agents folder now come into BuilderForce unchanged, scripts and references included. Import a skill folder, a .zip or a single SKILL.md from Workspace skills, or write a new skill in the browser. Either way it is saved as a standard Agent Skills folder. Every agent in the workspace can use it from its next run: cloud runs, the Brain on the web, in VS Code and in Rovr, the creation canvas and the Studio. Self-hosted agents now receive assigned skills on disk as real folders. Any skill downloads as a ready-to-use folder, and publishing to the marketplace sends the whole folder, so installers get exactly what you run.',
    'new',
    'live',
    '2026-10-23 18:00:00'
  )
ON CONFLICT (id) DO NOTHING;
