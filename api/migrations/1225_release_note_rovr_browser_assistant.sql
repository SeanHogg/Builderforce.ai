-- 1225 · Release note: meet Rovr — Builderforce's own assistant in your browser.
--
-- `new`: the agent that codes in VS Code and builds on the canvas had no presence in
-- the place most everyday work happens — the browser. Rovr is a Chrome extension: a
-- side panel that reads the page you are on, fills in forms and carries out tasks step
-- by step on sites you allow, asking before anything that submits, buys, sends or
-- touches a password or card. It runs on a model on your own machine first (Synapse,
-- Ollama, FreeToken) and falls back to Builderforce's cloud models; it keeps working
-- offline and syncs the chat, every recorded action and the tasks it produced to your
-- workspace when the connection returns. Playbooks tell it how you want things done.
-- Shipped in the Rovr extension 2026.10.2.
--
-- Fixed id so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces it exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0010-4000-8000-000000001225',
    '2026.10.2',
    'Meet Rovr — your Builderforce assistant in the browser',
    'Your Builderforce agent could write code in your editor and build on a canvas, but it could not help with the work that happens in a browser tab: the expense form, the booking, the twelve pages you read to make one decision. Rovr is that help. It is a Chrome extension that opens beside the page you are on, reads it, finds what you need, fills in forms and carries out a task step by step — on the sites you allow, and only those. Anything that submits a form, buys something, sends a message or touches a password or card waits for you to say yes. Every action it takes is written down: what it did, on which page, and how it went, so you can always see what happened. Rovr runs on a model on your own computer first — Synapse, Ollama or FreeToken — and uses Builderforce''s cloud models when it needs to, so it keeps working on a plane and costs nothing when your machine can answer. Your chat, its record of actions and the tasks it creates sync to your workspace when you are back online. Tell it how you like things done with playbooks — "when I say file my expenses, do this" — and it follows them. Install Rovr, allow a site, and ask.',
    'new',
    'live',
    '2026-10-16 22:00:00'
  )
ON CONFLICT (id) DO NOTHING;
