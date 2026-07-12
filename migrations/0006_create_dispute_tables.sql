-- Migration: Create dispute resolution tables
-- Task: Dispute Resolution GAP P1-7

-- Dispute tickets table
CREATE TABLE IF NOT EXISTS disputes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    engagement_id UUID REFERENCES engagements(id) ON DELETE SET NULL,
    milestone_id UUID REFERENCES milestones(id) ON DELETE SET NULL,

    -- Party involved
    initiating_party_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    defending_party_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    -- Status and lifecycle
    state VARCHAR(50) NOT NULL CHECK (state IN (
        'open',
        'under_review',
        'mediation_phase',
        'awaiting_party_agreement',
        'platform_decision',
        'resolved_released',
        'resolved_refunded',
        'canceled'
    )),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Dispute details
    title VARCHAR(500) NOT NULL,
    reason TEXT NOT NULL,
    description TEXT NOT NULL,
    severity VARCHAR(50) CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    
    -- Evidence
    evidence_count INTEGER DEFAULT 0,
    
    -- Financial details
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    escrowed_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    
    -- Resolution details
    proposed_resolution TEXT,
    platform_decision TEXT,
    resolution_notes TEXT,
    resolution_type VARCHAR(50) CHECK (resolution_type IN ('full_payment', 'full_refund', 'partial', 'no_action')),

    -- Platform administrator who closed/disputed
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,

    -- Audit
    created_by_client_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    last_modified_by_id UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Dispute communication messages
CREATE TABLE IF NOT EXISTS dispute_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dispute_id UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    sender_type VARCHAR(20) NOT NULL CHECK (sender_type IN ('client', 'freelancer', 'platform_admin')),

    -- Message content
    content TEXT NOT NULL,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,

    -- Attachments
    attachment_url TEXT,
    attachment_type VARCHAR(50),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dispute evidence files
CREATE TABLE IF NOT EXISTS dispute_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dispute_id UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
    uploader_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    file_name VARCHAR(500) NOT NULL,
    file_url TEXT NOT NULL,
    file_type VARCHAR(100),
    file_size INTEGER,
    description TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dispute notifications
CREATE TABLE IF NOT EXISTS dispute_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dispute_id UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
    target_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    notification_type VARCHAR(50) NOT NULL CHECK (notification_type IN (
        'dispute_initiated',
        'dispute_updated',
        'message_received',
        'evidence_uploaded',
        'resolution_proposed',
        'platform_decision',
        'resolution_finalized'
    )),
    title VARCHAR(500) NOT NULL,
    message TEXT NOT NULL,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add index for efficient filtering
CREATE INDEX IF NOT EXISTS idx_disputes_tenant ON disputes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_disputes_project ON disputes(project_id);
CREATE INDEX IF NOT EXISTS idx_disputes_engagement ON disputes(engagement_id);
CREATE INDEX IF NOT EXISTS idx_disputes_milestone ON disputes(milestone_id);
CREATE INDEX IF NOT EXISTS idx_disputes_state ON disputes(state);
CREATE INDEX IF NOT EXISTS idx_disputes_created_by_client ON disputes(created_by_client_id);
CREATE INDEX IF NOT EXISTS idx_dispute_messages_dispute ON dispute_messages(dispute_id);
CREATE INDEX IF NOT EXISTS idx_dispute_messages_sender ON dispute_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_dispute_notif_dispute ON dispute_notifications(dispute_id);
CREATE INDEX IF NOT EXISTS idx_dispute_notif_user ON dispute_notifications(target_user_id);

-- Trigger for updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_disputes_updated_at
    BEFORE UPDATE ON disputes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();