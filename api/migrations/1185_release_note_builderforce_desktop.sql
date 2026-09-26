-- 1185 · Release note: Builderforce Desktop — one local code index for every AI tool.
--
-- `new`: before this, every agent (and every other AI tool) oriented itself in a
-- repository by grepping and reading, from nothing, separately; and recalled memory
-- that named deleted code was obeyed. The desktop app keeps a local index per
-- repository (definitions, a reference-ranked repo map, meaning-level search), serves
-- it to the VS Code agent, Claude Code and Cursor, and flags stale memories.
--
-- Marketing copy, framed on what a person can now DO (see the header of 1105).
-- Fixed id so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces it exactly once. `version` is the frontend
-- release the surfaces ship in.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0009-4000-8000-000000001185',
    '2026.9.37',
    'Builderforce Desktop: one local code index for every AI tool',
    'Install Builderforce Desktop and every repository you open gets a code index that lives on your own machine and stays current as you save. Agents in the VS Code extension now start oriented — each turn carries a map of the repository ranked by what the code actually depends on — and can find code by describing it: ask how refunds reach the ledger and semantic_search returns the function that does it, path and lines, in one call. The same index serves Claude Code and Cursor through one MCP entry, so every tool you use shares it. And recalled memories that name code you have since renamed or deleted are now flagged as possibly stale, so the agent checks the current code instead of following advice that stopped being true. Indexing and embeddings run locally; your code is never uploaded. Download it from the Agents page for Windows, macOS or Linux.',
    'new',
    'live',
    '2026-09-26 12:00:00'
  )
ON CONFLICT (id) DO NOTHING;
