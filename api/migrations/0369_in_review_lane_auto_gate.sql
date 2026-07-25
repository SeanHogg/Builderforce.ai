-- 0369 — Open the `in_review` lane's gate so autonomy can reach Done.
--
-- WHY
--
-- `defaultSwimlanes.ts` seeded `in_review` with `gate = 'human'` on the reasoning that
-- review is the natural approval point. The measured consequence is that EVERY board
-- ever created shipped with autonomy switched off one lane short of Done: 0.7% of
-- tickets reached Done autonomously, and a stalled ticket's only explanation was
-- `human_gate` — which reads as "working as intended" rather than "nobody is coming".
--
-- A human gate did not mean "a human reviews this". Nobody was reviewing. It meant
-- "this ticket stops here", and tickets sat for weeks.
--
-- `auto` DOES NOT MEAN UNREVIEWED. It means the lane may dispatch a REVIEWER:
--
--   • `laneRequirementGate` resolves one from the lane's requirement rows, from its
--     staffing (`laneApprover` tier b) or from the ticket's participation manifest,
--     and suppresses the lane's normal agent while that review run is out;
--   • `evaluateTaskAutoRun` now suppresses the OWNER FALLBACK on a review-class lane
--     (`isReviewLane`), so an open gate can never mean the ticket's author re-runs on
--     its own output and signs it off — the guardrail that makes this migration safe;
--   • when no reviewer can be resolved at all the lane reports `no_agent` — "staff a
--     reviewer", which a person can act on — instead of a gate that looks deliberate.
--
-- SCOPE OF THIS UPDATE
--
-- Only lanes that still carry BOTH halves of the seeded default (`key = 'in_review'`
-- AND `gate = 'human'`) are flipped. A lane an operator renamed, re-keyed, or already
-- set to `auto` is untouched. There is no column recording "the operator chose this",
-- so a team that deliberately set `human` on an `in_review` lane is also flipped —
-- they set it back in Board configuration, where it becomes the explicit choice it
-- always should have been. That trade is taken knowingly: the default was blocking
-- every tenant, and an unreviewed-by-default gate that nobody staffed was not
-- providing the safety it appeared to.

UPDATE swimlanes
   SET gate = 'auto'
 WHERE key = 'in_review'
   AND gate = 'human';
