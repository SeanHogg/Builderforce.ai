-- 1365 · Release note: agents you declare by role now run inside your running app's environment.
--
-- `new`: W12 phase 3, shipped in BuilderForce WebContainers 2026.11.24. Agents declared under
-- `agents` in `.builderforce/builderforce.json` run inside the environment through the one
-- `env.*` tool port (`EnvironmentToolPort`: files, `env.run`, the app's own services and their
-- status); a tool outside an agent's allowlist is refused with a typed error and a Security
-- Shield event; mutating calls carry an idempotency key. Brain drives them through the
-- `runtime.agents.list/start/steer/cancel/status` catalog, and `/starter-kit react-node --with
-- agents` scaffolds a coordinator, developer and tester. `version` is the runtime release.
-- Blog: /blog/agents-that-run-inside-your-app.
--
-- Marketing copy, framed on what a person can now DO (see the header of 1105). Fixed id so the
-- migration is safe to replay; `emailed_at` left NULL so the product-updates digest announces it
-- exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0024-4000-8000-000000001365',
    '2026.11.24',
    'Agents you declare now run inside your app',
    'An AI agent that helps build your app has always worked from the outside: it edits files somewhere else, and you find out whether they run when you press Run. Now the agents live inside the app''s own environment in your browser tab. Declare them by role, such as a coordinator, a developer and a tester, in the project''s builderforce.json or with the define-agents form, and give each one the tools it may use. Each agent reads and writes the project''s files, runs the tests, and checks the app''s own services from inside the running environment. A tool that is not on an agent''s list is refused, with a clear reason, and reported to the Security Shield. A file path outside the project is refused too, and an agent can reach only your app''s own services, never a host it names. Ask Brain to list your agents, start one on a task, steer it while it works, check its status or cancel it. To begin from a working example, /starter-kit react-node --with agents scaffolds a React and Node app with a coordinator, a developer and a tester already declared, each with its own brief. For teams that embed the open-source runtime: the same agents, tool port and allowlists ship in BuilderForce WebContainers 2026.11.24 on npm.',
    'new',
    'live',
    '2026-11-24 12:00:00'
  )
ON CONFLICT (id) DO NOTHING;
