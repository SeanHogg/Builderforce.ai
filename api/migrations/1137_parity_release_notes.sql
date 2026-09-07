-- 1137 · Release notes for the competitive-parity pass.
--
-- Three of these are `new` — a capability nobody could reach before, on any path.
-- Two are `fix`, because a governance gate that never fired and a steer that was
-- accepted and dropped were both advertised behaviour that did not happen; making
-- something work as claimed is not news, and writing it up as news would be a lie
-- about what changed.
--
-- Fixed ids so the migration is safe to replay, `emailed_at` left NULL so the
-- product-updates digest announces each exactly once. `version` names the release
-- the capability is live in. No tool ids in the body: persisted text is never
-- rewritten by a deploy, so a tool name written here is wrong forever the moment
-- the catalog moves (check-prompt-tool-names.mjs enforces it).
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
    'a1b2c301-0006-4000-8000-000000000001',
    '2026.9.14',
    'Bring your own MCP server, from the browser or the editor',
    'Your workspace can now register an external Model Context Protocol server, and every agent here gets its tools. Add one under Settings › Integrations: paste the server''s address, give it a name, and either store a secret or connect through the server''s own consent screen — a three-legged flow BuilderForce completes server to server, so the credential never reaches your browser and is encrypted at rest. Choose which of the server''s tools your agents may call, or allow them all. The same registration lives in the VS Code extension under Register MCP Server, so an editor-first team never has to leave it. Registering is owner-only, because it widens what every agent in the workspace can reach.',
    'new',
    'live',
    '2026-09-07 12:00:00'
  ),
  (
    'a1b2c301-0006-4000-8000-000000000002',
    '2026.9.14',
    'Agents can now write the procedure down',
    'A run that finishes real, verified work has just executed a procedure that works — and until now that procedure lived only in a transcript nobody reads, so the next run rediscovered it. Agents can now propose what they learned as a skill: the steps, the exact commands, and how to tell it worked. Proposals arrive as drafts under Skills › Proposed by agents, with the run that wrote each one and the evidence it offered. Nothing an agent proposes reaches another agent until you approve it; once you do, every agent on the workspace follows it from their next run. Most runs propose nothing, which is the point — the bar is a verified result, not a busy afternoon.',
    'new',
    'live',
    '2026-09-07 12:05:00'
  ),
  (
    'a1b2c301-0006-4000-8000-000000000003',
    '2026.9.14',
    'Send agent runs to your own observability stack, and measure them against a fixed set',
    'Agent runs no longer stop at our timeline. Point BuilderForce at your OpenTelemetry collector under Settings › Integrations and every run''s lifecycle and tool calls arrive as spans in Honeycomb, Datadog, Grafana or whatever you already run — with the health of that export shown next to it, so a collector that has started refusing spans says so instead of quietly dropping them. Separately, agent quality is now a series rather than an anecdote: define a fixed set of benchmark cases, and the same tasks are scored the same way every day. The AI insights hub plots score and expectation coverage over time, so when the number moves you know it was the agents and not this month''s tickets.',
    'new',
    'live',
    '2026-09-07 12:10:00'
  ),
  (
    'a1b2c301-0006-4000-8000-000000000004',
    '2026.9.14',
    'Governance gates now hold in the editor too',
    'Policy packs were enforced on cloud and self-hosted runs, and the VS Code extension had the plumbing for them but was never handed any — so a gate that blocked a tool in the cloud silently allowed it in the editor. Both editor surfaces now resolve the workspace''s effective gates at the start of every run: a blocking gate refuses the tool with the reason, an approval gate prompts even with auto-approve on, and the gate directives are prepended to the agent''s instructions. If the policy cannot be read, the turn does not start — the same fail-closed rule the server applies.',
    'fix',
    'live',
    '2026-09-07 12:15:00'
  ),
  (
    'a1b2c301-0006-4000-8000-000000000005',
    '2026.9.14',
    'Mid-run steering reaches self-hosted runs again',
    'Sending a follow-up direction to a running self-hosted execution was accepted, saved, and then dropped: it was delivered to a chat session the current engine no longer runs in. Steers now go into the live run itself and are applied as its next turn, and the run''s timeline records each one as it lands — matching how steering already worked on cloud runs. Cancelling was never affected.',
    'fix',
    'live',
    '2026-09-07 12:20:00'
  )
ON CONFLICT (id) DO NOTHING;
