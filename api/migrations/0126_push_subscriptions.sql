-- Migration: Web Push subscriptions
--
-- Backs the OS-level "a new app version deployed" notification. One row per
-- browser/device that opted in. The deploy hook (POST /api/push/notify-deploy)
-- fans out a Web Push to every row; endpoints the push service rejects with
-- 404/410 are pruned on send. `endpoint` is unique so a re-subscribe from the
-- same browser upserts (ON CONFLICT) instead of duplicating.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id               SERIAL PRIMARY KEY,
  tenant_id        INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id          VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint         TEXT NOT NULL UNIQUE,
  p256dh           TEXT NOT NULL,
  auth             TEXT NOT NULL,
  user_agent       VARCHAR(512),
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  last_notified_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_tenant ON push_subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
