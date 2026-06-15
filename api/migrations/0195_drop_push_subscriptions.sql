-- Migration: drop Web Push subscriptions
--
-- OS-level notifications are now handled by the host platform (BurnRateOS.com),
-- not by Builderforce. The self-hosted VAPID/web-push stack (routes, services,
-- frontend client, and this table) has been removed; drop the now-orphaned table
-- and its indexes. Idempotent so it is safe whether or not 0126 was ever applied.
DROP INDEX IF EXISTS idx_push_subscriptions_user;
DROP INDEX IF EXISTS idx_push_subscriptions_tenant;
DROP TABLE IF EXISTS push_subscriptions;
