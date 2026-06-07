-- 0083: workflow execution scope.
--
-- A workflow assigned to a project executes UNDER that project, or it may execute
-- GLOBALLY (tenant-wide). This records that choice on the definition; runs
-- (manual + trigger-fired) inherit it alongside the existing run target.
ALTER TABLE workflow_definitions
  ADD COLUMN IF NOT EXISTS execution_scope varchar(16) NOT NULL DEFAULT 'project';
