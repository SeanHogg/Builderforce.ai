-- 1341 · Release note: every agent run in VS Code ends with a run delta card.
--
-- `new`: PRD 41 §1, §C10, §C11. After each agent run in the VS Code chat, a card answers from
-- measured facts what the run changed: security (a route that lost its auth guard, a new entry
-- point or system capability, weak crypto, a redacted secret), performance (static rules: awaited
-- I/O in a loop, blocking I/O), quality including tests the agent weakened, and the ISO/IEC 25010
-- -ilities it measures today (compatibility, maintainability, safety), the rest shown as not
-- measured. Verdicts, ≈ on heuristics, a blast-radius band relative to the repo's own past runs, a
-- details side sheet with lineage and evidence, offline and signed out, deterministic digest.
--
-- Fixed id so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces it exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0017-4000-8000-000000001341',
    '2026.10.144',
    'Know what an agent run did without reading its code',
    'You let the agent write the code, so you no longer read every line it changes. You still need to know what the run did. Now every agent run in the VS Code chat ends with a run delta card. It compares the code before and after the run and answers four questions from measured facts. Security: did a route lose its auth guard, did the run add an entry point, a system capability such as child_process, weak cryptography or a secret? Secrets are always shown redacted. Performance: did it add an awaited I/O call inside a loop or a blocking I/O call? These are static checks, and the card says so. Quality: did it make the code worse, and did it weaken the tests that judge it? A skipped or focused test, a deleted test, fewer assertions, a weaker matcher, a suppressed lint or type check or a raised timeout all count, and the headline says tests were weakened. The -ilities from ISO/IEC 25010: compatibility (an exported API broke or was added), maintainability (new dependency cycles, more duplicated code, unused code, an oversized file that grew) and safety (a destructive schema change, a force push, a recursive delete). The ones it does not measure yet say Not measured, not zero. Each dimension reads Better, Worse, Unchanged, Not comparable or Not measured, heuristic findings carry a ≈, and a blast-radius band of low, medium or high ranks the run against your repository''s own past runs. Open details shows the findings by dimension, split into new in this run, resolved, changed and already there, with their evidence and an Open code link. For autonomous runs, a removed auth guard or weakened tests are flagged as blocking. The card works offline and signed out, it never holds up the run, and the same before and after give the same result on any machine. It is available in English, Chinese, Spanish, French and German.',
    'new',
    'live',
    '2026-11-10 10:00:00'
  )
ON CONFLICT (id) DO NOTHING;
