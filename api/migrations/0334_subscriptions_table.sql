-- subscription-recurring-billing-table.sql
-- PostgreSQL migration to support recurring subscription billing with Helcim.
-- Implements FR1-FR7 and dunning management from PRD.

-- Drop existing base if it was defined somewhere (rare but idempotent)
-- DROP TABLE IF EXISTS subscriptions CASCADE;

-- Main subscriptions table
CREATE TABLE subscriptions (
  id                          BIGSERIAL PRIMARY KEY,
  tenant_id                   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Plan configuration
  plan                        VARCHAR(16) NOT NULL CHECK (plan IN ('PRO', 'TEAMS')),
  billing_cycle               VARCHAR(16) NOT NULL CHECK (billing_cycle IN ('MONTHLY', 'YEARLY')),
  billing_email               VARCHAR(255), -- Primary billing contact
  -- Subscription lifecycle
  status                      VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'canceled', 'trialing', 'suspended')),
  seats                       INTEGER, -- Only meaningful for TEAMS plan
  -- Reconciliation with payment provider
  external_customer_id        VARCHAR(255), -- Helcim customerCode
  external_subscription_id    VARCHAR(255), -- Helcim recurring billing schedule ID
  -- Billing period tracking
  current_period_start        TIMESTAMP WITH TIME ZONE,
  current_period_end          TIMESTAMP WITH TIME ZONE,
  next_billing_date           TIMESTAMP WITH TIME ZONE,
  -- Provider-provided identifiers for payment methods
  payment_brand               VARCHAR(50), -- e.g. "Visa"
  payment_last4               VARCHAR(4), -- Last 4 digits of card
  -- Dunning state
  dunning_status              VARCHAR(24) NOT NULL DEFAULT 'none' CHECK (dunning_status IN ('none', 'pending_retry', 'action_required')),
  dunning_attempts            INTEGER NOT NULL DEFAULT 0,
  dunning_failed_attempts     INTEGER NOT NULL DEFAULT 0,
  -- Monitoring
  created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for common queries

-- Tenant lookup (fastest for API reads)
CREATE INDEX idx_subscriptions_tenant_id ON subscriptions(tenant_id);

-- For renewal worker: find subscriptions due for billing
CREATE INDEX idx_subscriptions_next_billing_date ON subscriptions(next_billing_date) WHERE status = 'active';

-- For admin listing: status and plan filtering
CREATE INDEX idx_subscriptions_status_plan ON subscriptions(status, plan);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);

-- For webhook processing: track external subscription ID
CREATE UNIQUE INDEX idx_subscriptions_external_id ON subscriptions(external_subscription_id);

-- Dunning queries: find subscriptions in non-'none' state
CREATE INDEX idx_subscriptions_dunning_status ON subscriptions(dunning_status, status) WHERE dunning_status != 'none';

-- Auditing: subscription lifecycle events
CREATE TABLE subscription_events (
  id                          BIGSERIAL PRIMARY KEY,
  subscription_id             BIGINT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  tenant_id                   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type                  VARCHAR(48) NOT NULL CHECK (event_type IN (
    'subscription.created',
    'subscription.renewed',
    'subscription.failed',
    'subscription.past_due',
    'subscription.collected',
    'subscription.canceled',
    'subscription.dunning_initiated',
    'subscription.dunning_resolved',
    'subscription.dunning_failed'
  )),
  summary                     TEXT,
  additional_data             JSONB,
  occurred_at                 TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscription_events_subscription_id ON subscription_events(subscription_id);
CREATE INDEX idx_subscription_events_type ON subscription_events(event_type);
CREATE INDEX idx_subscription_events_occurred_at ON subscription_events(occurred_at);

-- Row update triggers
CREATE OR REPLACE FUNCTION subscriptions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER subscriptions_trigger_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION subscriptions_updated_at();

-- Index for audit trail queries (tenant-wide subscription events)
CREATE INDEX idx_subscription_events_tenant_id ON subscription_events(tenant_id, occurred_at DESC);

-- Comment on schema elements
COMMENT ON TABLE subscriptions IS 'Recurring subscriptions for Teams/Enterprise plans. Linked to Helcim recurring billing schedules.';
COMMENT ON COLUMN subscriptions.status IS 'active (charging), past_due (payment failed, in grace), canceled (stopped), trialing (introductory period), suspended (admin pause)';
COMMENT ON COLUMN subscriptions.billing_cycle IS 'MONTHLY or YEARLY recurrence for billing Schedule';
COMMENT ON COLUMN subscriptions.dunning_status IS 'none | pending_retry (waiting for next retry) | action_required (manual intervention required)';
COMMENT ON TABLE subscription_events IS 'Append-only audit trail of subscription lifecycle events.';