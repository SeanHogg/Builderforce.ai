-- 1257 · Specialist admissions (LLM Cost Optimization · E2).
--
-- A specialist is a small, cheap model admitted for ONE narrow job (the compaction
-- dropped-middle summary, the ticket action-type classifier fallback, …) because it
-- scored ≥ 0.9 of the frontier model on that job's held-out eval set — the same
-- frontier-parity rule as the Evermind coding gate (`specialists/admission.ts`).
--
--   llm_specialist_eval_cases   the held-out eval set, one row per captured job input.
--                               Nothing already stored was usable: llm_traces does not
--                               cover the internal summarizer / classifier calls, caps
--                               bodies and is purged at 30 days. So the NEXT inputs each
--                               job sees are captured (sampled, capped per job by the
--                               registry, secrets redacted) and the weekly sweep asks
--                               the frontier reference model for each case's reference
--                               output once. Tenant-owned: a deleted tenant's inputs
--                               go with it (ON DELETE CASCADE).
--   llm_specialist_admissions   one row per admission. The weekly sweep re-scores every
--                               active admission and stamps `revoked_at` when the score
--                               drifts under the bar; a re-admission is a new row, so
--                               the history of a (job, model) pair stays readable.
--                               A platform fact about a MODEL, identical for every
--                               tenant — no tenant column (see adjudications).

CREATE TABLE IF NOT EXISTS llm_specialist_eval_cases (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id varchar(64) NOT NULL,
  input_hash varchar(64) NOT NULL,
  -- The exact chat request the job sent ({ messages, max_tokens, response_format? }), JSON.
  request text NOT NULL,
  reference_output text,
  reference_model varchar(200),
  captured_at timestamp NOT NULL DEFAULT now(),
  referenced_at timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_llm_specialist_eval_cases_job_input
  ON llm_specialist_eval_cases (job_id, input_hash);

CREATE TABLE IF NOT EXISTS llm_specialist_admissions (
  id serial PRIMARY KEY,
  job_id varchar(64) NOT NULL,
  model varchar(200) NOT NULL,
  dataset varchar(200) NOT NULL,
  cases integer NOT NULL,
  score real NOT NULL,
  frontier_score real NOT NULL,
  frontier_model varchar(200),
  admitted_at timestamp NOT NULL DEFAULT now(),
  evaluated_at timestamp NOT NULL DEFAULT now(),
  revoked_at timestamp,
  revoke_reason varchar(64)
);
-- At most ONE active admission per (job, model).
CREATE UNIQUE INDEX IF NOT EXISTS uq_llm_specialist_admissions_active
  ON llm_specialist_admissions (job_id, model) WHERE revoked_at IS NULL;
