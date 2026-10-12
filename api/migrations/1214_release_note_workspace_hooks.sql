-- 1214 · Release note: workspace hooks and rules your team commits.
--
-- `new`: the VS Code agent had no user-defined directives — every end-of-run step was
-- hard-coded. A repository can now commit `.builderforce/hooks.json` (stop prompts and
-- checks, preTool gates, postTool feedback, runEnd commands) and `.builderforce/rules.md`
-- (standing instructions); every run in that workspace follows them, on both editor chat
-- surfaces. Commands need a one-time per-machine approval, re-asked when they change.
-- Shipped in VSIX 2026.10.31, brain-embedded 2026.10.22.
--
-- Fixed id so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces it exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0010-4000-8000-000000001214',
    '2026.10.31',
    'Workspace hooks: tell the agent what every run must do, and commit it',
    'You can now give the BuilderForce agent in VS Code standing directives for a repository, and share them through git. Add .builderforce/hooks.json, for example a stop hook with the prompt "Update README.md and DONE.md with the work completed in this session". Before any run that changed code finishes, the agent does that too, and the result ships in the same commit. Hooks can also run commands. A stop check such as your linter must pass before the run ends. A preTool gate can refuse a call, for example no git_push until the tests pass. A postTool check, such as a formatter after every edit, sends its output back to the agent. A runEnd command runs after the run finishes. Put standing instructions in .builderforce/rules.md and every run in that workspace follows them. Because both files are committed, everyone on the team gets the same actions. Each machine approves a workspace''s commands once, and approves again when they change. Run "BuilderForce: Edit Workspace Hooks" to start. Update the VS Code extension to 2026.10.31 or later.',
    'new',
    'live',
    '2026-10-12 12:00:00'
  )
ON CONFLICT (id) DO NOTHING;
