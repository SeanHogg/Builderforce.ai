-- 1244 · Release note: run Kimi K3 from your own Kimi account — in VS Code and Rovr.
--
-- `new`: before this, a Kimi subscription connected to Builderforce could only be used when a
-- separate agent runtime was online to relay through (Kimi's edge refuses our cloud), and the
-- editor could use Kimi only if the Kimi Code CLI was installed and signed in. Rovr could not
-- use Kimi at all. Now the editor and Rovr call Kimi themselves with the workspace's
-- connection, and offer the sign-in the moment a Kimi turn needs it.
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
    'a1b2c301-0009-4000-8000-000000001244',
    '2026.10.76',
    'Kimi K3 as your coder or planner — from your own Kimi account',
    'Connect your Kimi account once and use Kimi K3 to plan, to code, or both. Pick a Kimi model in VS Code or in Rovr: if your workspace has no Kimi account yet, Builderforce opens Kimi''s sign-in right there, keeps the connection in your workspace''s integrations, and stores a short-lived token on your machine so the editor and the browser call Kimi directly. No Kimi Code install needed, nothing to paste. On a Kimi plan that includes K3, put K3 first under Settings → Bring your own models → Kimi and every surface leads with it.',
    'new',
    'live',
    '2026-10-18 18:00:00'
  )
ON CONFLICT (id) DO NOTHING;
