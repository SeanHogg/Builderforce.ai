-- Migration: Expand integration_provider enum with single-pane / migration
-- connectors so tenants can connect (and migrate data out of) more external
-- work, ITSM, and incident systems:
--   pm        — Linear, monday.com, Asana, ClickUp
--   itsm      — ServiceNow  (Freshservice already present)
--   incident  — Sentry, PagerDuty
--
-- These ids are stored in integration_credentials.provider (the enum) and, for
-- board sync, in board_connections.provider / external_ticket_links.provider /
-- tasks.source (all plain VARCHAR(24), no enum change needed there).
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block. The migrate
-- runner does NOT wrap files in a transaction (see 0065_external_board_sync.sql),
-- so each ADD VALUE below runs as its own autocommit statement. IF NOT EXISTS
-- makes the whole file idempotent / safe to re-run.

ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'servicenow';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'linear';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'sentry';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'pagerduty';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'monday';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'asana';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'clickup';
