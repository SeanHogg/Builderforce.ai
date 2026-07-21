-- Gmail + Google Drive as first-class integration credential providers.
-- Gmail backs the email workflow node; Google Drive can back a project's file
-- storage. Both authenticate with OAuth offline credentials stored (encrypted)
-- in integration_credentials, like the other connectors.
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block; the primary
-- migration runner applies files non-transactionally, so these are safe here.
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'gmail';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'google_drive';
