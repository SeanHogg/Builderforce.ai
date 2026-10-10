-- 1204 · Release note: Synapse keeps your Evermind's work on your machine.
--
-- `new`: Synapse (desktop 2026.10.4) manages local models through Ollama with a
-- hardware-aware hub and serves them in the OpenAI and Anthropic formats on loopback
-- (`desktop/crates/bf-local`); hosts MCP connectors — one-click catalog or custom — whose
-- tools the Brain uses with the same Approve gate (`desktop/crates/bf-mcp`); relays a
-- Self-Directed Agent's approval to the person's phone as a self-owned `synapse.step`
-- approval only they can see or answer (`domain/approval/selfOwned.ts`); and downloads a
-- workspace Evermind as the starter private model.
--
-- Fixed id so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces it exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0010-4000-8000-000000001204',
    '2026.10.4',
    'Synapse: local models, connectors and approvals from your phone',
    'Synapse, the desktop app where your private Evermind lives, now keeps more of your AI on your own computer. Install a local model in one click, sized to your computer''s memory, and let the Brain answer with it, or point Claude Code and your scripts at it through a local OpenAI- and Anthropic-compatible endpoint. Connect GitHub, Slack, Playwright, your files or any MCP server and the Brain can use their tools, with every change waiting for your Approve. Approve an agent''s step from your phone through your Builderforce account, so only you can see or answer it. And if you have no private model yet, start from one your workspace already has. Everything it learns stays on your machine unless you publish it.',
    'new',
    'live',
    '2026-10-10 12:00:00'
  )
ON CONFLICT (id) DO NOTHING;
