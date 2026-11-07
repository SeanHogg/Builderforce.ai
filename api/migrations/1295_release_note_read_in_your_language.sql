-- 1295 · Release note: read anyone's message in your own language, translated on your own device.
--
-- `new`: PRD 42 Part E. A teammate's message, a comment or an imported document can be read in
-- the viewer's language. Translation runs on the device first (the browser's built-in
-- translator in Chrome; Edge has none), falls back to a cloud translation, free within daily
-- limits, when the browser has none, and the original text is always one click away. Summaries and rewrites also run on the
-- device first when the browser can (Gemini Nano in Chrome, Phi-4-mini in Edge).
--
-- Fixed id so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces it exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0012-4000-8000-000000001295',
    '2026.10.131',
    'Read anyone''s message in your own language — translated on your own device',
    'A team that does not share one language loses context in every handoff. Now a teammate''s message or a comment on a card is translated into your language automatically as it scrolls into view, and a document you import can be translated into a new document beside it with one click. The translation runs on your own device first, using the translator built into Chrome, so the text of your conversation does not have to leave your computer to be understood, and it costs nothing. If your browser has no translator, as in Edge today, a cloud translation steps in instead, free within daily limits. Every translated message is labelled with the language it came from, and Show original is always one click away: Translated from Spanish · Show original. Summaries and rewrites also now run on your device first when the browser can, with Gemini Nano in Chrome and Phi-4-mini in Edge, and go to the cloud models only when it cannot.',
    'new',
    'live',
    '2026-11-06 12:00:00'
  )
ON CONFLICT (id) DO NOTHING;
