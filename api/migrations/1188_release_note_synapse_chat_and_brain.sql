-- 1188 · Release note: Synapse signs in to Builderforce — chat with the Brain and your
-- agents from the desktop, and watch your private Evermind learn.
--
-- `new`: before this, Synapse had no way to talk to anyone. It could not sign in, had no
-- chat, could not reach the workspace's agents, and showed what Evermind learned only as
-- lists. Now it signs in with the browser (the device flow, key in the OS credential
-- store), shows the workspace's Brain chats, answers the Brain's turn with the person's
-- private Evermind recall, lets agents be assigned and addressed with @ (the platform
-- runs their reply with their own tools, as the person), and draws Evermind as a live
-- two-hemisphere brain with training-loss and activity charts.
--
-- Marketing copy, framed on what a person can now DO (see the header of 1105).
-- Fixed id so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces it exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0009-4000-8000-000000001188',
    '2026.9.39',
    'Synapse: a private brain on your desktop that hands the work to your agents',
    'Sign in to Builderforce from Synapse with your browser, and your workspace''s chats are on the desktop — the same conversations as the web app and VS Code. Ask the Brain and it answers with what your private Evermind has learned on your machine: the facts your coding agents remembered, the procedures you taught Synapse, the conventions you corrected. When it is work, assign an agent to the chat and address it with @ — it does the job with its own tools, as you, never beyond your own permissions. And Synapse now draws your Evermind as a brain that stays in view: the left hemisphere is what it knows, the right is what it has done, a region glows while it learns, and the Evermind page adds training loss for every adaptation and thirty days of activity. The key stays in your system''s credential store.',
    'new',
    'live',
    '2026-09-27 18:00:00'
  )
ON CONFLICT (id) DO NOTHING;
