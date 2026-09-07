-- 1145 · Release note for the sales programme every account now owns.
--
-- `new`, not `fix`. The hub was built and working; what changed is WHO can open it, and
-- for every account but a Builderforce sales associate the answer used to be nobody. A
-- capability you could not reach is a capability you did not have, so gaining a pipeline,
-- campaigns, weekly targets, reports, payouts and a referral link is something a customer
-- could not do in Builderforce.ai before this — which is the new-feature bar, not the
-- repaired-regression one.
--
-- Fixed id so the migration is safe to replay, `emailed_at` left NULL so the
-- product-updates digest announces it exactly once.
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
    'a1b2c301-0009-4000-8000-000000000011',
    '2026.9.18',
    'Every account gets a sales programme',
    'You can take an idea onto a canvas, argue it into objects, build the thing, run it as a company and read whether it worked. Then somebody has to buy it — and until this week the left rail had an answer to that for exactly one kind of account. Sales Hub, with its pipeline, campaigns, weekly targets, reports, payouts and sales kit, was a row you only saw if you had signed up as a Builderforce sales associate. Every founder who had just shipped something on the platform got a rail that ran Idea, Make, Run, Measure, and then handed them a marketplace listing and wished them luck. That was not a missing feature; it was a built feature behind the wrong door. The door is open. Sales lives under REACH for every account, alongside the marketplace and the campaigns that were already there, because putting the result in front of people is what Reach means and a pipeline is how that actually happens. Nothing about your data changed: every contact, campaign, goal and commission rule was already keyed to its owner, so opening this up removed a gate rather than widening a scope — a superadmin can still only open the workspace of a platform associate, never a customer''s private pipeline. And the stage above it went too. EXPAND was a heading with one row underneath it, which is a label rather than an information architecture; its single row is that sales programme, and it now sits where it belonged. The arc is five sayable words again — Idea, Make, Run, Measure, Reach — and every one of them has real work under it.',
    'new',
    'live',
    '2026-09-07 16:30:00'
  )
ON CONFLICT (id) DO NOTHING;
