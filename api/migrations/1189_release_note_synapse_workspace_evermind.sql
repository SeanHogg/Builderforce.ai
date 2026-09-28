-- 1189 · Release note: Synapse shows your workspace's Evermind models, with the same
-- Teach / Test / Check / Maintain console as VS Code, and puts your chats first.
--
-- `improvement`, not `new`: teaching, testing, checking and maintaining a workspace
-- Evermind already existed in the web Studio and the VS Code extension. What changed is
-- that Synapse — which, once signed in, still only showed the private model on the
-- machine — now opens on the workspace's models with that same console, can fold the
-- machine's own memory into one, and lists chats in its sidebar with setup moved into
-- Settings.
--
-- Fixed id so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces it exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0009-4000-8000-000000001189',
    '2026.9.40',
    'Synapse: your workspace''s Evermind models, with Teach, Test, Check and Maintain',
    'Signed in to Synapse, the Evermind page now opens on your workspace''s Evermind models — the same models the web Studio and VS Code show — and the brain in the sidebar follows the one you choose. Below the brain is the same console as VS Code: teach it from a transcript, run a prompt or the readiness check, have a frontier model check what it learned and fix it, or replace, re-index and clean it up. Import from builderforce-memory folds the facts your AI tools remembered on this machine into the model and compacts them to stubs so they stop filling your context. The private model on your machine is one choice away. And the sidebar is now your chats, newest first, with a new chat at the top; the code index, your agents and connecting tools moved into Settings.',
    'improvement',
    'live',
    '2026-09-27 21:00:00'
  )
ON CONFLICT (id) DO NOTHING;
