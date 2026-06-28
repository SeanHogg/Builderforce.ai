-- 0227_knowledge_management.sql
-- Knowledge Management: SOPs, processes & documents with versioning, tagging,
-- read-acknowledgement (audit evidence for SOX/TISAX/ISO) and training
-- assignments with due dates. Tenant- and segment-scoped like the rest of the
-- platform; optionally project-scoped (NULL = workspace-wide knowledge).

-- A knowledge document: an SOP, process flow, or general doc. The live body
-- lives here (content); immutable snapshots are kept in knowledge_document_versions.
CREATE TABLE IF NOT EXISTS knowledge_documents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id        uuid REFERENCES segments(id) ON DELETE CASCADE,
  project_id        integer REFERENCES projects(id) ON DELETE SET NULL,  -- NULL = workspace-wide
  doc_type          varchar(16) NOT NULL DEFAULT 'sop',     -- 'sop' | 'process' | 'doc'
  title             varchar(255) NOT NULL,
  summary           varchar(500),
  content           text NOT NULL DEFAULT '',
  status            varchar(16) NOT NULL DEFAULT 'draft',   -- 'draft' | 'published' | 'archived'
  -- Monotonic published version. Bumped each time a draft is published; the
  -- snapshot at each bump is written to knowledge_document_versions. Read
  -- acknowledgements are tied to the version a user read (re-read on republish).
  version_number    integer NOT NULL DEFAULT 0,
  -- When acknowledgement is required, every active tenant member is expected to
  -- read & acknowledge the current published version (drives the audit rollup).
  requires_ack      boolean NOT NULL DEFAULT false,
  created_by        varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  updated_by        varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  published_at      timestamp,
  created_at        timestamp NOT NULL DEFAULT now(),
  updated_at        timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_tenant ON knowledge_documents(tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_segment ON knowledge_documents(segment_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_project ON knowledge_documents(project_id);

-- Immutable snapshot of a document at the moment it was published. Lets the
-- audit prove exactly what text a user acknowledged, even after later edits.
CREATE TABLE IF NOT EXISTS knowledge_document_versions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id       uuid NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  version_number    integer NOT NULL,
  title             varchar(255) NOT NULL,
  content           text NOT NULL,
  change_note       varchar(500),
  published_by      varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_versions_doc ON knowledge_document_versions(document_id, version_number DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_versions ON knowledge_document_versions(document_id, version_number);

-- Free-form tags for filtering/organising knowledge.
CREATE TABLE IF NOT EXISTS knowledge_document_tags (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id       uuid NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  tag               varchar(64) NOT NULL,
  created_at        timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_tags_doc ON knowledge_document_tags(document_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_tags_tenant_tag ON knowledge_document_tags(tenant_id, tag);
CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_tags ON knowledge_document_tags(document_id, tag);

-- Audit evidence: a user read & acknowledged a specific published version.
-- One row per (document, user) — re-acknowledging a new version updates the
-- version_number/acknowledged_at in place (the user has re-read the latest).
CREATE TABLE IF NOT EXISTS knowledge_acknowledgements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id       uuid NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  user_id           varchar(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version_number    integer NOT NULL,
  acknowledged_at   timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_acks_doc ON knowledge_acknowledgements(document_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_acks_tenant_user ON knowledge_acknowledgements(tenant_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_acks ON knowledge_acknowledgements(document_id, user_id);

-- Training expectation: a manager assigns a document to a user with an optional
-- due date. Completion is derived from a matching acknowledgement of the
-- current published version; due_at drives the overdue audit signal.
CREATE TABLE IF NOT EXISTS knowledge_training_assignments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id       uuid NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  user_id           varchar(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by       varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  due_at            timestamp,
  created_at        timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_training_doc ON knowledge_training_assignments(document_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_training_user ON knowledge_training_assignments(tenant_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_training ON knowledge_training_assignments(document_id, user_id);

-- Per-document collaborators: users explicitly invited to a page. An 'editor'
-- may co-edit, publish and invite others (alongside the document creator and
-- workspace managers); a 'viewer' is explicitly associated for awareness. Read
-- access remains open to the tenant; this table grants per-page edit rights to
-- members who are not workspace managers.
CREATE TABLE IF NOT EXISTS knowledge_document_collaborators (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id   uuid NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  user_id       varchar(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          varchar(16) NOT NULL DEFAULT 'editor',   -- 'editor' | 'viewer'
  invited_by    varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_collab_doc ON knowledge_document_collaborators(document_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_collab_user ON knowledge_document_collaborators(tenant_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_collab ON knowledge_document_collaborators(document_id, user_id);
