-- 0122_google_calendar_provider.sql
-- Add 'google_calendar' to the integration_provider enum so a tenant can connect a
-- Google account (via the existing integration_credentials framework) and the
-- member-profile Calendar sync (googleCalendarSync) can overlay busy/PTO blocks
-- onto member_profiles (sync_source='google_calendar'). Closes the "Calendar
-- later" seam from migration 0116.
--
-- ALTER TYPE ... ADD VALUE is idempotent via IF NOT EXISTS and autocommits on the
-- Neon HTTP transport (no surrounding transaction), so this is re-runnable.
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'google_calendar';
