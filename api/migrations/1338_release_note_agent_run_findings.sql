-- 1338 · Release note: the Visualizer names what went wrong in an editor agent's run.
--
-- `new`: PRD 46. The VS Code Visualizer gains an Agent runs drawer that reads the editor agent's
-- recorded runs and names each problem deterministically (analysis that never ended, one write per
-- turn, files written and never checked, edits that broke bracket balance, tickets filed then done
-- inline, slow or oversized turns, a run stopped with unchecked changes), with the turn, tool and
-- file as evidence and a turn strip. The editor agent now also gets language-server diagnostics
-- and a bracket-balance warning on every edit's own result.
--
-- Fixed id so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces it exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0016-4000-8000-000000001338',
    '2026.10.143',
    'See exactly what went wrong in an agent run, and catch broken edits as they happen',
    'When an editor agent run went badly, all you had was a feeling and a report that said Inconclusive. Now the Visualizer in VS Code has an Agent runs drawer. Pick one of your recent runs and it names what went wrong, the same way every time: analysis that never turned into work, a loop of turns that each made one change while re-sending the whole conversation, files written and never checked, an edit that left a file with unbalanced brackets, tickets filed and then done in the same session anyway, turns that were slow or carried oversized arguments, and a run stopped with changes nobody verified. Every finding points at its evidence, the turn, the tool and the file, and a strip of turns shows at a glance which ones read, which wrote and how much each cost in prompt tokens. Files the run touched are listed as written or checked, one click from the knowledge map. One real run spent 3.06 million prompt tokens over 42 turns: 21 spent reading, 13 that each made a single change, not one check, and a file it broke along the way. The old report called it Inconclusive. The drawer names 13 findings. The agent also catches more on its own now: every edit comes back with the language server''s errors for that file, and a warning when the change opened or closed more brackets than it should, so a broken file is fixed in the next turn instead of discovered at the end.',
    'new',
    'live',
    '2026-11-09 10:00:00'
  )
ON CONFLICT (id) DO NOTHING;
