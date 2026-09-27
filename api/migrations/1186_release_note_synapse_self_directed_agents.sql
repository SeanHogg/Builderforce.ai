-- 1186 · Release note: Synapse Self-Directed Agents — teach a task once, it does it again.
--
-- `new`: before this, work that lives inside desktop programs (no API, no export)
-- could not be handed to any Builderforce agent, and nothing that automated it kept
-- what it learned. Synapse now records one demonstration in a Windows program, Train
-- Once compiles it into a parameterised skill with approval gates on irreversible
-- steps, skills run on request or on a routine with a full audit trail, and the
-- procedure is learned by the person's private Evermind. Opt-in; all local.
--
-- Marketing copy, framed on what a person can now DO (see the header of 1105).
-- Fixed id so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces it exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0009-4000-8000-000000001186',
    '2026.9.38',
    'Synapse: teach it once, and it does it again',
    'Switch on Self-Directed Agents in Synapse and pick a Windows program. Do a task once — copy an invoice total into the ledger, fill the form that has no API — and Synapse records what you did as the controls you used and the values you set, never a keystroke log and never a password. Review the steps, and Train Once turns them into a skill that asks for new values each run, keeps secrets in Windows Credential Manager, and stops for your OK before anything it cannot undo: send, pay, delete. Run it now or on a routine while Synapse sits in the tray, press Esc to take over at any moment, and read every step of every run afterwards. Each skill is also learned by your private Evermind, on your machine, beside the memories your AI tools already keep — and any of it can be forgotten. Opt-in and local; Windows first.',
    'new',
    'live',
    '2026-09-27 12:00:00'
  )
ON CONFLICT (id) DO NOTHING;
