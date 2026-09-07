-- 1146 · Release note for the account menu in the top-right corner.
--
-- `improvement`, deliberately, not `new`. Nothing here is a capability somebody
-- did not have: alerts, chat, the cart, the theme switch, Settings and the way
-- out all worked before. What changed is that they stopped being six separate
-- controls competing for the quietest corner of the canvas. A consolidation is
-- worth telling people about — they have to find their Settings again — and it
-- is emphatically not news.
--
-- Fixed id so the migration is safe to replay, `emailed_at` left NULL so the
-- product-updates digest announces it exactly once.
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
    'a1b2c301-0009-4000-8000-000000000012',
    '2026.9.18',
    'Six icons in the corner became one: your avatar',
    'The top-right of a signed-in canvas carried a bell, a chat bubble, a cart, a sun, a door, and — down in the left rail, nowhere near any of them — Settings. Six controls, each with its own badge, on the surface that should be the quietest thing on the screen while you are making something. They are one avatar now. The badge on it is everything waiting for you across all of them, so you can tell at a glance that there is something to look at without reading a row of icons; open it and the count breaks back down per row — alerts, messages, cart — beside the theme switch and the way out. Settings moved in there too, where every product you already use keeps it, and it arrives in the three tiers that actually apply to you: your own settings always, your workspace''s if you administer it, the platform console if you run it. Nothing gained a new power and nothing was taken away — the notification feed and the message hub open as the same panels, and the cart is the same cart. There is simply less chrome between you and the board. The founder''s-journey chip that used to sit up there is gone as well: it said the same word the canvas''s own phase stepper and the panel''s stage switcher were already saying, and one fact belongs in one place.',
    'improvement',
    'live',
    '2026-09-07 18:10:00'
  )
ON CONFLICT (id) DO NOTHING;
