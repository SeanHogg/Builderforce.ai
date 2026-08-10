-- Publish the August 2026 product-update batch.
--
-- These are customer-facing summaries of the major features shipped after the
-- initial release-note seed. Fixed ids make the migration safe to replay, and
-- explicit publication times keep the public changelog in a deterministic
-- order. `emailed_at` deliberately remains NULL so the normal product-updates
-- digest can announce this batch once.
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
    'a1b2c301-0002-4000-8000-000000000001',
    '2026.7.209',
    'Your canvas is now your workspace',
    'The Creation Canvas now stays at the center of Builderforce while projects, files, settings and the rest of the product open around it. Your board, Brain conversation, collaborators and current selection remain in place as you move between tools, so you can keep working without losing context.',
    'improvement',
    'live',
    '2026-08-10 12:07:00'
  ),
  (
    'a1b2c301-0002-4000-8000-000000000002',
    '2026.7.209',
    'Build and publish without leaving the canvas',
    'Add a Builder object to create a real IDE project directly on your board. Choose from website, mobile, web and mobile, video, Evermind, fine-tuning or voice starters, then edit the files, run a live preview and publish from the same canvas.',
    'new',
    'live',
    '2026-08-10 12:06:00'
  ),
  (
    'a1b2c301-0002-4000-8000-000000000003',
    '2026.7.235',
    'Turn a brief into a working system',
    'Paste a challenge brief and Builderforce can plan and assemble the project, including a published site and its server-side workflows. Generated systems can receive webhooks, store data, use protected credentials and run request handlers instead of stopping at a static prototype.',
    'new',
    'live',
    '2026-08-10 12:05:00'
  ),
  (
    'a1b2c301-0002-4000-8000-000000000004',
    '2026.7.235',
    'Connect workflows to the services you use',
    'Connector manifests and OpenAPI imports can now turn external APIs into reusable workflow steps without a Builderforce code change. The same platform powers the full Twilio surface, including SMS, WhatsApp, voice calls, recordings and verification.',
    'new',
    'live',
    '2026-08-10 12:04:00'
  ),
  (
    'a1b2c301-0002-4000-8000-000000000005',
    '2026.7.209',
    'Create, edit and export real files',
    'Documents are editable directly on the canvas, and every major artifact now leaves in its native format. Download documents, presentations, spreadsheets, diagrams and canvas images as the files you expect instead of converting everything to Markdown first.',
    'improvement',
    'live',
    '2026-08-10 12:03:00'
  ),
  (
    'a1b2c301-0002-4000-8000-000000000006',
    '2026.7.209',
    'Make a game and play it on the canvas',
    'Ask Builderforce to create a browser game and run it immediately in an interactive canvas preview. You can play, pause, restart and expand the result without opening another tab, then keep iterating with Brain beside it.',
    'new',
    'live',
    '2026-08-10 12:02:00'
  ),
  (
    'a1b2c301-0002-4000-8000-000000000007',
    '2026.7.165',
    'Share a canvas with anyone',
    'Free canvases can now create a live guest room and a copyable invite link without asking the host or their collaborators to sign up first. Everyone on the link sees the same board and roster and can work together in real time.',
    'improvement',
    'live',
    '2026-08-10 12:01:00'
  ),
  (
    'a1b2c301-0002-4000-8000-000000000008',
    '2026.7.158',
    'See your work in 3D',
    'Switch the Creation Canvas into a 3D view that lifts objects and their connections onto meaningful depth planes. Arrange the scene by dependency flow or object group, rotate the workspace to understand structure and return to the flat board at any time.',
    'new',
    'live',
    '2026-08-10 12:00:00'
  )
ON CONFLICT (id) DO NOTHING;
