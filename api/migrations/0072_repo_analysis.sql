-- Migration 0072: Digital Transformation / Architect repo-analysis tool.
--
-- A signed-in user maps repo(s) to a project, then runs a cloud-only analysis
-- that produces onboarding artifacts (a "what this repo does" diagnostic, a
-- business summary, the 4+1 architecture views in Markdown+Mermaid, an
-- anti-patterns report, a DRY/SOLID/DDD assessment, and a
-- brownfield/greenfield/parallel recommendation) plus a write-back to the
-- project's details + Brain memory. The whole job is driven by
-- AnalysisRunnerDO, advancing one stage per Durable Object alarm() tick so it
-- stays under the Cloudflare per-invocation subrequest + CPU caps.
--
--   repo_analysis_runs       — the job + state machine mirror (UI polls this)
--   repo_analysis_artifacts  — one row per generated output (6 kinds)
--   repo_analysis_evidence   — one row per repo per run (the sampled snapshot
--                              the LLM calls were grounded on; agent-reusable)

CREATE TABLE IF NOT EXISTS repo_analysis_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id      UUID REFERENCES segments(id) ON DELETE CASCADE,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- queued | fetching | analyzing | writing_back | completed | partial | failed
  status          VARCHAR(24) NOT NULL DEFAULT 'queued',
  stage           VARCHAR(40),
  progress        INTEGER NOT NULL DEFAULT 0,
  -- brownfield | greenfield | parallel (denormalized headline from the recommendation artifact)
  recommendation  VARCHAR(24),
  effective_plan  VARCHAR(8),
  token_budget    INTEGER,
  tokens_used     INTEGER NOT NULL DEFAULT 0,
  error           TEXT,
  triggered_by    VARCHAR(36),
  started_at      TIMESTAMP,
  finished_at     TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_repo_analysis_runs_segment ON repo_analysis_runs;
CREATE TRIGGER trg_repo_analysis_runs_segment BEFORE INSERT ON repo_analysis_runs FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_repo_analysis_runs_project ON repo_analysis_runs(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS repo_analysis_artifacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id  UUID REFERENCES segments(id) ON DELETE CASCADE,
  run_id      UUID NOT NULL REFERENCES repo_analysis_runs(id) ON DELETE CASCADE,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- diagnostic | business | arch_4plus1 | antipatterns | principles | recommendation
  kind        VARCHAR(32) NOT NULL,
  title       VARCHAR(255),
  body_md     TEXT,                 -- human-readable Markdown (Mermaid in fences)
  data_json   TEXT,                 -- structured strict-schema output (agent-consumable)
  model       VARCHAR(255),
  tokens      INTEGER,
  status      VARCHAR(16) NOT NULL DEFAULT 'complete',  -- complete | skipped | failed
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_repo_analysis_artifact UNIQUE (run_id, kind)
);
DROP TRIGGER IF EXISTS trg_repo_analysis_artifacts_segment ON repo_analysis_artifacts;
CREATE TRIGGER trg_repo_analysis_artifacts_segment BEFORE INSERT ON repo_analysis_artifacts FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_repo_analysis_artifacts_run ON repo_analysis_artifacts(run_id, kind);

CREATE TABLE IF NOT EXISTS repo_analysis_evidence (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id     UUID REFERENCES segments(id) ON DELETE CASCADE,
  run_id         UUID NOT NULL REFERENCES repo_analysis_runs(id) ON DELETE CASCADE,
  repo_id        UUID NOT NULL REFERENCES project_repositories(id) ON DELETE CASCADE,
  provider       VARCHAR(16),
  default_branch VARCHAR(255),
  languages      TEXT,             -- JSON { lang: bytes }
  tree_summary   TEXT,             -- JSON { topDirs, fileCount, totalBytes, truncated }
  sampled_files  TEXT,             -- JSON [{ path, bytes, truncated, content }]
  commit_summary TEXT,             -- JSON { recent: [{message, date}], hotspots: [...] }
  token_estimate INTEGER,
  status         VARCHAR(16) NOT NULL DEFAULT 'complete',  -- complete | partial | failed
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_repo_analysis_evidence UNIQUE (run_id, repo_id)
);
DROP TRIGGER IF EXISTS trg_repo_analysis_evidence_segment ON repo_analysis_evidence;
CREATE TRIGGER trg_repo_analysis_evidence_segment BEFORE INSERT ON repo_analysis_evidence FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
CREATE INDEX IF NOT EXISTS idx_repo_analysis_evidence_run ON repo_analysis_evidence(run_id, repo_id);
