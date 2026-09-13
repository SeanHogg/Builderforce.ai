-- 1164 · Release note: "Acting as" in the editor, and one To / Acting-as pair on both surfaces.
--
-- `new`, not `improvement`: choosing who the Brain answers as was possible on the web and
-- NOT in the VS Code chat — an editor user could not run a turn as an assigned agent or as
-- a modality persona at all. The recipient half (the same "To" control on both surfaces)
-- and group turns naming who they went to ride in the same note because a reader meets
-- them in the same place: the composer and the transcript of a multi-party chat.
--
-- Marketing copy, framed on what a person can now DO (see the header of 1105). Fixed id
-- so the migration is safe to replay, `emailed_at` left NULL so the product-updates digest
-- announces it exactly once.
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
    'a1b2c301-0009-4000-8000-000000001164',
    '2026.9.48',
    'Choose who answers — in your editor too',
    'In a chat with teammates and agents, two questions decide every turn: who is answering, and who you are talking to. On the web you could already set both; in VS Code you could only choose who you were talking to. Now "Acting as" is in the editor composer as well: run the Brain as your default coding assistant, as a Website, Mobile or Evermind persona, or as any agent assigned to the Brain — and an agent persona runs on that agent''s own model unless you have pinned one. The persona sits on top of what the editor already knows about your workspace, so choosing the Mobile persona changes how it builds, not where it thinks your files are. "To" is the same control on both surfaces, and a question you put to the whole board now shows every agent it went to, on the web and in the editor.',
    'new',
    'live',
    '2026-09-12 23:00:00'
  )
ON CONFLICT (id) DO NOTHING;
