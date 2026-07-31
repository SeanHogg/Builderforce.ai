-- 0377 — LANE MOVES GET AN ACTOR: repair the rows that recorded the wrong one.
--
-- WHY
--
-- `task_status_transitions.actor_kind` was written as a two-valued flag: 'human' when
-- the route had a `userId`, 'system' otherwise. Two things went wrong with that.
--
--   A. An agent's lane hop carried NO identity. Every agent advance, every coordinator
--      move and every cron sweep collapsed into the same anonymous ('system', NULL)
--      row, so per-agent throughput could not be read off the log at all — the Manager
--      digest had to infer agent contribution from `executions` and ticket ownership,
--      and the `moves` column was humans-only by construction.
--
--   B. Worse, a MACHINE caller was recorded as a PERSON. An on-prem agent host
--      authenticates with a service token whose subject is `agentHost:<id>`, and the
--      PATCH route passed that subject straight through as `actor_user_id`. Those hops
--      landed as ('human', 'agentHost:5') — an invented user id that resolves to
--      nobody, inflating the human half of every autonomy ratio the platform reports.
--      The same applied to `agentHost:mcp`, the built-in MCP relay's service subject.
--
-- The writer now classifies the actor once (`taskLifecycle.resolveTransitionActor`) and
-- the execution path forwards the running agent's identity, so new rows are correct.
-- This repairs the history so a 90-day autonomy window is not read off bad data.
--
-- NO DDL: `actor_kind` is already varchar(16) and holds the new values as-is. Readers
-- that only ask "was this autonomous?" test `actor_kind <> 'human'`, which stays true
-- for every agent kind — so nothing downstream needs to change in lockstep.
--
-- Both statements are idempotent (their WHERE clauses no longer match after running).

-- A. A machine subject that names a specific host WAS carrying an identity — recover it
--    rather than discarding it. `agentHost:5` → ('host_agent', '5'), matching the bare
--    `agent_hosts.id` ref shape `resolveActorByRef` expects.
UPDATE task_status_transitions
   SET actor_kind = 'host_agent',
       actor_ref  = substring(actor_ref from char_length('agentHost:') + 1)
 WHERE actor_kind = 'human'
   AND actor_ref ~ '^agentHost:[0-9]+$';

-- B. Service subjects that name no agent (`agentHost:mcp`, `embed:<keyId>`) are the
--    genuine identity-less case. They are automation, not people.
UPDATE task_status_transitions
   SET actor_kind = 'system',
       actor_ref  = NULL
 WHERE actor_kind = 'human'
   AND (actor_ref LIKE 'agentHost:%' OR actor_ref LIKE 'embed:%');
