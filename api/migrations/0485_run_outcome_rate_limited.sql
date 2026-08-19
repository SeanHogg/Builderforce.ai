-- Distinguish "this model did the work badly" from "this model could not be reached".
--
-- ── WHAT WAS UNMEASURABLE WITHOUT THIS ──────────────────────────────────────
-- Measured on project 11, 2026-07-31: 150 of 164 terminal runs in ONE day were
-- provider 429s from the free coder pool. Every one of those was scored by
-- `computeOutcomeScore` as a terminal non-completion — score 0.0 — and folded
-- into the learned-routing blob as evidence about the model's QUALITY.
--
-- That is a category error with a long tail. A rate limit says nothing about
-- whether a model writes good code; it says the provider refused to run it.
-- Teaching the router "this coder scores 0.0" because its pool was saturated
-- poisons the ranking for the full 60-day routing window, long after the
-- throttling clears — and it does so most severely for exactly the models a
-- free tenant leans on hardest, because those are the ones that get throttled.
--
-- Worse, the router had no way to learn the thing that IS true and IS useful:
-- that this model's pool is chronically unavailable for this tenant, so lead
-- with something else. The per-model cooldown (cooldownStore.ts) covers the
-- next few minutes. Nothing covered the standing preference.
--
-- ── WHY A COLUMN RATHER THAN A DERIVED READ ─────────────────────────────────
-- `run_model_outcomes` is the durable source of truth the `routing:<scope>` KV
-- blob is reconciled FROM. A signal the reconcile cannot recompute is a signal
-- that silently disappears the first time a blob is rebuilt, which is the one
-- guarantee that module makes ("losing the blob costs one reconcile, never
-- correctness"). The classification itself is `classifyRunFailure` — the
-- platform's existing failure taxonomy — so this column stores its verdict, it
-- does not invent a second one.
--
-- Defaults false so every historical row reads as "not rate-limited", which is
-- the conservative direction: it under-reports the problem rather than
-- retroactively demoting models on evidence nobody captured.
ALTER TABLE run_model_outcomes
  ADD COLUMN IF NOT EXISTS rate_limited boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN run_model_outcomes.rate_limited IS
  'The run ended on a provider rate limit / capacity ceiling (classifyRunFailure = rate_limited). Consumed by the learned router as an AVAILABILITY signal that demotes the model — never as a quality score, because an unreachable model is not a bad one.';
