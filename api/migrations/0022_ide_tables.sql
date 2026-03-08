-- IDE (Builderforce) extensions: datasets, training jobs, workforce agents.
-- Projects are the unified API projects table (projects.id). Project files live in R2 under ide/projects/{project_id}/{path}.
-- Add template to projects in 0023; here we only create IDE-specific tables that reference projects(id).

CREATE TABLE IF NOT EXISTS ide_datasets (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  capability_prompt TEXT NOT NULL,
  r2_key TEXT NOT NULL DEFAULT '',
  example_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ide_training_jobs (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  dataset_id TEXT REFERENCES ide_datasets(id) ON DELETE SET NULL,
  base_model TEXT NOT NULL,
  lora_rank INTEGER NOT NULL DEFAULT 8,
  epochs INTEGER NOT NULL DEFAULT 3,
  batch_size INTEGER NOT NULL DEFAULT 4,
  learning_rate REAL NOT NULL DEFAULT 0.0002,
  status TEXT NOT NULL DEFAULT 'pending',
  current_epoch INTEGER NOT NULL DEFAULT 0,
  current_loss REAL,
  r2_artifact_key TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ide_training_logs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES ide_training_jobs(id) ON DELETE CASCADE,
  epoch INTEGER,
  step INTEGER,
  loss REAL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ide_agents (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES ide_training_jobs(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  bio TEXT NOT NULL,
  skills TEXT NOT NULL DEFAULT '[]',
  base_model TEXT NOT NULL,
  lora_rank INTEGER,
  r2_artifact_key TEXT,
  resume_md TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  hire_count INTEGER NOT NULL DEFAULT 0,
  eval_score REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ide_datasets_project_id ON ide_datasets(project_id);
CREATE INDEX IF NOT EXISTS idx_ide_training_jobs_project_id ON ide_training_jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_ide_training_logs_job_id ON ide_training_logs(job_id);
CREATE INDEX IF NOT EXISTS idx_ide_agents_status ON ide_agents(status);
