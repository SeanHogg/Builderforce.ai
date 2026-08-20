-- 0975 — The Agentic Tester becomes a first-class agent, not a synthetic subject.
--
-- WHY
--
-- The Agentic Tester is the one autonomous worker that exercises the LIVE product,
-- and it was the only one with no `ide_agents` row. It ran as a machine subject
-- minted per exploration, which meant: it could not be assigned a ticket, it did
-- not appear on the workforce board beside the rest of the team, its findings had
-- no author anyone could click through to, and it had nowhere to carry its own
-- model, persona or traits. Every other built-in worker — Validator, Security,
-- Manager, the six business seats (0436) — is an ordinary cloud agent identified
-- by `builtin_kind` (0289). This makes the tester one too, so the roster, the
-- assignee pickers, the lane-role matcher and the chat reply loop all reach it
-- through machinery that already exists.
--
-- Its capability entry (`BUILTIN_KIND_ROLE_KEYS.qa_tester = ['qa-tester']`) is
-- deliberately NOT exclusive: Validator keeps `qa-tester` too, because the
-- acceptance review it performs is itself a QA act, and two capable agents let
-- the assignment choose rather than leaving the role unfillable when one is busy.
--
-- The bio is the PERSONA (compiled into directives at reply time), so it is
-- written as a standard of conduct and names NO TOOLS — a tool name persisted per
-- tenant outlives every deploy that could correct it (see 0376/0379).
--
-- New tenants get it from `provisionBuiltinAgents`; this backfills existing ones.
-- Idempotent: one NOT EXISTS, so re-running (or racing the provisioner) is a no-op.

INSERT INTO ide_agents (id, tenant_id, name, title, bio, skills, base_model, status, runtime_support, published, price_cents, builtin_kind)
SELECT 'qa-tester-t' || t.id, t.id, 'Agentic Tester',
       'Agentic Tester — explores the live product in a real browser',
       'Drives a real browser through the app the way people actually use it, ranked by where they actually go: it reads the interaction heat map, plans an exploration over the hottest routes and controls, and reports what genuinely broke — runtime errors, failed navigations, server errors, crashes — with the page image captured at the moment it happened. It reports what it observed rather than what it expected, files one finding per distinct fault, and turns a finding into a board ticket only when a human or an opt-in routing rule asks it to.',
       '["exploratory-testing","browser-automation","playwright","regression-testing","accessibility"]',
       'builderforce-default', 'active', 'cloud', FALSE, 0, 'qa_tester'
FROM tenants t
WHERE NOT EXISTS (SELECT 1 FROM ide_agents a WHERE a.tenant_id = t.id AND a.builtin_kind = 'qa_tester');
