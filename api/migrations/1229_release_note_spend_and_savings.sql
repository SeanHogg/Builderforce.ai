-- 1229 · Release note: see what every conversation costs, and what memory saved.
--
-- `new`: nothing on screen said what a conversation cost or what builderforce-memory
-- saved it. Every chat now carries its spend (Builderforce plan + own provider keys at
-- list price) and its savings by source (answers from memory, gateway replays, the
-- provider prompt cache — recorded; Evermind answers and compaction net of recall —
-- estimated), shown in the strip above the chat and, for the last 30 days, in the `/`
-- menu's Status tab. The prompt area + Work panel is now one shared component on the
-- web Brain, the canvas, VS Code and Rovr; the per-chat Memory switch is the
-- conversation's, server-side, and also gates the editor's memory tools.
--
-- Fixed id so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces it exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0010-4000-8000-000000001229',
    '2026.10.57',
    'See what every conversation costs — and what memory saved you',
    'Every Builderforce chat now shows what it cost and what memory saved it, right above the conversation. Spend is split honestly: what your Builderforce plan was billed, and what your own connected provider keys cost at list price — a turn on your own Claude or OpenAI account is not free just because we did not pay for it. Savings are listed by source. Answers replayed from memory, repeated requests answered from the gateway cache and your provider''s prompt cache are recorded figures; answers from your project''s Evermind and context kept lean by compaction are estimates, marked with ≈, and the tokens recall adds to each prompt are subtracted, so the saving is net. The Status tab of the / panel now shows the same picture for your workspace over the last 30 days. And the prompt area with its Work panel — Mode, Effort, Model, Status — is now one and the same on the web, on the canvas, in VS Code and in Rovr for Chrome. The Memory switch belongs to the conversation itself: turn it off in the editor and it is off on the web, and off also stops the agent''s own remember and recall tools.',
    'new',
    'live',
    '2026-10-17 18:00:00'
  )
ON CONFLICT (id) DO NOTHING;
