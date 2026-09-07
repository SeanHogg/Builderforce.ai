-- 1136 · OpenTelemetry export + a fixed agent benchmark.
--
-- WHY (OTel). Every competitor with an enterprise story emits OTel natively and one
-- has it on by default; BuilderForce emits none. That is not a missing feature so
-- much as a missing DOOR: a buyer who already runs Honeycomb, Datadog or Grafana
-- cannot see agent runs next to the rest of their system, so agent work stays an
-- island no matter how good the in-product timeline is. The platform already records
-- every lifecycle transition and every tool call — the gap is purely that nothing
-- ships them anywhere a tenant chose.
--
-- `headers_enc` / `headers_iv` hold the vendor auth header (`x-honeycomb-team`,
-- `Authorization: Api-Token …`) AES-GCM encrypted with the shared credential helper.
-- Unlike a webhook's HMAC secret, this one is SENT on every request, so it is a
-- bearer credential and is stored as one. The health columns are why this is its own
-- table rather than a `settings` row: the sweep and the settings panel both read
-- them, and a value that gets queried is not a setting.
--
-- WHY (benchmarks). `semanticEval`, `driftMonitor` and `variantEval`'s promotion gate
-- all exist, but every one of them scores whatever traffic happened to arrive. With no
-- FIXED task set, "did agent quality improve this month" has no answer that is not
-- confounded by which tickets came in. A benchmark case is a stable prompt plus what a
-- good answer must contain; a benchmark run scores today's agent against the same set
-- as last month's.
--
-- `agent_benchmark_*` rather than `benchmark_*`: `industry_benchmarks` and
-- `tenant_benchmark_profiles` already mean "how do we compare to our industry", and
-- one word doing two jobs in a schema is how a dashboard ends up plotting the wrong
-- number. Cross-domain ids (`project_id`, `execution_id`) are plain integers with no
-- FK, per the boundary rule.

CREATE TABLE IF NOT EXISTS otel_exporters (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                 VARCHAR(255) NOT NULL,
  -- OTLP/HTTP collector base. Spans POST to `<endpoint>/v1/traces`.
  endpoint             TEXT NOT NULL,
  headers_enc          TEXT,
  headers_iv           VARCHAR(64),
  -- `service.name` on every emitted resource; defaults to the workspace's name.
  service_name         VARCHAR(255),
  -- 0–1. 1 = export every run; a busy workspace pays per span at its vendor.
  sample_rate          REAL NOT NULL DEFAULT 1,
  enabled              BOOLEAN NOT NULL DEFAULT true,
  last_export_at       TIMESTAMPTZ,
  last_error           TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_by           VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS otel_exporters_tenant_idx ON otel_exporters(tenant_id, enabled);

COMMENT ON COLUMN otel_exporters.headers_enc IS 'AES-GCM encrypted OTLP headers. A bearer credential (it is sent on every request), unlike a webhook signing secret which never leaves.';
COMMENT ON COLUMN otel_exporters.consecutive_failures IS 'Read by the settings panel and the exporter: a collector that has failed repeatedly is shown as broken rather than silently dropping spans.';

-- The fixed task set. A case is stable ON PURPOSE: changing one resets the series.
CREATE TABLE IF NOT EXISTS agent_benchmark_cases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id      INTEGER,
  slug            VARCHAR(255) NOT NULL,
  name            VARCHAR(255) NOT NULL,
  -- What the agent is asked to do.
  prompt          TEXT NOT NULL,
  -- What a good answer must contain, as a JSON string[] of required substrings.
  expectations    TEXT NOT NULL DEFAULT '[]',
  category        VARCHAR(64) NOT NULL DEFAULT 'general',
  enabled         BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_benchmark_cases_slug ON agent_benchmark_cases(tenant_id, slug);

-- One scored attempt at one case. The regression series is these rows over time.
CREATE TABLE IF NOT EXISTS agent_benchmark_results (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  case_id         UUID NOT NULL REFERENCES agent_benchmark_cases(id) ON DELETE CASCADE,
  -- Which agent + model answered, so a regression is attributable to a change.
  cloud_agent_ref VARCHAR(255),
  model           VARCHAR(255),
  execution_id    INTEGER,
  -- 0–1, from the shared lexical/LLM evaluator.
  score           REAL NOT NULL,
  -- Fraction of `expectations` present in the answer, scored independently of the
  -- evaluator so a rubric miss and a quality drop are distinguishable.
  coverage        REAL NOT NULL DEFAULT 0,
  passed          BOOLEAN NOT NULL DEFAULT false,
  answer          TEXT,
  duration_ms     INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_benchmark_results_series_idx
  ON agent_benchmark_results(tenant_id, case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_benchmark_results_agent_idx
  ON agent_benchmark_results(tenant_id, cloud_agent_ref, created_at DESC);

COMMENT ON COLUMN agent_benchmark_results.coverage IS 'Fraction of the case expectations present in the answer. Kept separate from `score` so a rubric miss and a quality drop are told apart.';
COMMENT ON COLUMN agent_benchmark_results.execution_id IS 'Run that produced the answer. No FK: it crosses a domain boundary, and a deleted run must not erase the series.';
