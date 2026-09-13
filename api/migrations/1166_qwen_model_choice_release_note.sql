-- 1166 · Release note: choose which models a connected Qwen account runs.
--
-- `improvement`, not `new`: connecting a Qwen key already worked. What changed is that the
-- account is no longer limited to one built-in model — it offers Qwen Cloud's whole catalog,
-- including the DeepSeek, GLM and Kimi models Qwen Cloud serves, in an order the owner sets.
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
    'a1b2c301-0009-4000-8000-000000001166',
    '2026.9.29',
    'Pick the models your Qwen account runs',
    'A Qwen Cloud key reaches far more than Qwen — DeepSeek, GLM and Kimi models are served through the same account. Until now a connected Qwen account ran one built-in model. Open Qwen under Settings → Bring your own models and you get Qwen Cloud''s full catalog, with the models your key can actually call marked. Pick the ones you want and put them in order: your agents lead with the first and fall back down your list, in chat, in the editor and in cloud runs.',
    'improvement',
    'live',
    '2026-09-12 23:30:00'
  )
ON CONFLICT (id) DO NOTHING;
