-- 0379 — REPAIR the persisted Manager persona: a stored prompt may not name a tool.
--
-- WHAT WENT WRONG
--
-- Migration 0376 wrote the AI Manager's persona (`ide_agents.bio`) into every tenant's
-- row, and that text instructed the agent to read its record via `manager.digest`,
-- `manager.decisions`, `manager.census`, `manager.policy` and `autonomy.wiring_audit` —
-- the CATALOG ids. A model is advertised those tools as `builtin_manager_digest` &c, so
-- the persona pointed at five strings that appear nowhere in the model's tool list.
--
-- That failure is silent in both directions: no error, `finish_reason: stop`, a fluent
-- reply. Measured on project 11 / chat 86 on 2026-07-28 (api 2026.7.172, served by
-- `xai-oauth/grok-4.3`): SEVEN model turns, 102 tools advertised, ZERO tool calls, and
-- the manager answering three consecutive accountability questions with "The tools
-- required are manager.digest, manager.decisions, manager.census and manager.policy" and
-- "the required tools have not returned results yet". It was reciting its own persona.
--
-- WHY A DEPLOY DID NOT FIX IT
--
-- The TypeScript seed (`agent/provisionBuiltinAgents.ts`) was corrected to emit the
-- advertised names — but `provisionBuiltinAgents` skips a tenant that already has the
-- agent (a NOT-EXISTS check per kind), so no existing row was ever rewritten. The
-- persona is DATA; only a migration can reach it. This is the whole reason the defect
-- survived its own fix for a full release cycle.
--
-- THE FIX, AND WHY IT REMOVES THE NAMES RATHER THAN CORRECTING THEM
--
-- A persisted prompt naming a tool is drift waiting to happen: the row outlives every
-- deploy that could correct it, so `builtin_manager_digest` is only right until the
-- catalog is renamed, and then it is exactly as wrong as `manager.digest` is today —
-- with the same silence. The persona now states the STANDARD ("read your own record
-- before replying, by CALLING the manager tools you were given") and names nothing.
-- The tools are named where a name can be kept honest: `accountabilityFraming` in
-- `brain/BrainService.ts` resolves each id against the tools ACTUALLY advertised on the
-- turn and DROPS any clause whose tool is missing.
--
-- Surgical `replace()` rather than an overwrite: a tenant may have edited its Manager's
-- bio, and only the defective clause is theirs to lose. Both spellings are repaired —
-- rows backfilled by 0376 carry the catalog ids, rows provisioned by the corrected seed
-- (api 2026.7.171+) carry the advertised names — and the guard clause makes the whole
-- statement idempotent and a no-op for anyone already correct.
--
-- The resolved persona is read through a 300s KV / 60s L1 read-through cache
-- (`workforce_model:resolve:<agentId>`), so a repaired row takes effect within five
-- minutes of this migration running; there is no cache key to invalidate by hand.

UPDATE ide_agents
SET bio = replace(
      replace(
        bio,
        'it reads its OWN record before replying — manager.digest for what finished today, manager.decisions for what it actually decided, manager.census for what is stuck across every ticket, manager.policy for what it was permitted to do and whether autonomy was paused at all, and autonomy.wiring_audit for whether work can complete unattended in the first place.',
        'it READS ITS OWN RECORD before replying — the day''s digest, the decisions it actually took, the stall census across every ticket, what it was permitted to do and whether autonomy was paused at all — by CALLING the manager tools it was given on that turn, never by describing them or reporting that their results are missing.'
      ),
      'it reads its OWN record before replying — builtin_manager_digest for what finished today, builtin_manager_decisions for what it actually decided, builtin_manager_census for what is stuck across every ticket, builtin_manager_policy for what it was permitted to do and whether autonomy was paused at all, and builtin_autonomy_wiring_audit for whether work can complete unattended in the first place.',
      'it READS ITS OWN RECORD before replying — the day''s digest, the decisions it actually took, the stall census across every ticket, what it was permitted to do and whether autonomy was paused at all — by CALLING the manager tools it was given on that turn, never by describing them or reporting that their results are missing.'
    )
WHERE bio LIKE '%manager.digest for what finished today%'
   OR bio LIKE '%builtin_manager_digest for what finished today%';
