-- Migration 043: Learning Store — Institutional Memory & Lineage
-- Adds a versioned, append-only store for validated learnings with lineage.
-- Each record is immutable; inserts are versioned as new versions.

BEGIN;

-- Learning objects: human-readable ML learning statements.
CREATE TABLE learning_objects (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  learning_id TEXT NOT NULL,
  content JSONB NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  confidence_score NUMERIC(3,2) NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('run', 'task', 'experiment')),
  source_id TEXT NOT NULL,
  baseline_version TEXT REFERENCES baseline_versions(version_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  constraint unique_ml_learning_id_tenant UNIQUE (tenant_id, learning_id),
  constraint tags_not_empty CHECK(array_length(tags, 1) IS NOT NULL)
);

-- Baseline model versions: explicit lineage anchor.
CREATE TABLE baseline_versions (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  version_id TEXT NOT NULL UNIQUE,
  model_name TEXT NOT NULL,
  model_version TEXT NOT NULL,
  provider TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  constraint tags_not_empty CHECK(array_length(tags, 1) IS NOT NULL)
);

-- Learning object versions: preserve immutable historical records.
CREATE TABLE learning_object_versions (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  learning_object_id BIGINT NOT NULL REFERENCES learning_objects(id) ON DELETE CASCADE,
  content JSONB NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  confidence_score NUMERIC(3,2) NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  baseline_version TEXT REFERENCES baseline_versions(version_id) ON DELETE SET NULL,
  version_number INT NOT NULL,
  version_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  constraint unique_object_version UNIQUE (tenant_id, learning_object_id, version_number),
  constraint tags_not_empty CHECK(array_length(tags, 1) IS NOT NULL)
);

-- Indexes for efficient querying (tags and confidence ranges).
CREATE INDEX idx_learning_objects_tags ON learning_objects USING GIN(tags);
CREATE INDEX idx_learning_objects_created_at ON learning_objects(created_at);
CREATE INDEX idx_learning_objects_source ON learning_objects(source_type, source_id);
CREATE INDEX idx_learning_objects_confidence ON learning_objects(confidence_score);
CREATE INDEX idx_learning_objects_baseline ON learning_objects(baseline_version);

CREATE INDEX idx_learning_object_versions_tags ON learning_object_versions USING GIN(tags);
CREATE INDEX idx_learning_object_versions_created_at ON learning_object_versions(created_at);
CREATE INDEX idx_learning_object_versions_source ON learning_object_versions(source_type, source_id);
CREATE INDEX idx_learning_object_versions_confidence ON learning_object_versions(confidence_score);
CREATE INDEX idx_learning_object_versions_baseline ON learning_object_versions(baseline_version);

CREATE INDEX idx_learning_object_versions_id FOR SEARCH ON learning_object_versions USING GIN(to_tsvector('english', COALESCE(to_jsonb(content), '{}')));

COMMIT;