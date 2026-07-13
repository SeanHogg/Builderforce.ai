-- 0114_tenant_invitations.sql
-- Humans and agents are one workforce. Inviting a teammate used to ONLY work if
-- they already had a Builderforce account — invite-by-email looked the user up
-- and added them on the spot, 404-ing otherwise. There was no way to invite a
-- not-yet-registered teammate, and no "pending" state to show who's been asked.
--
-- This table records invitations to an email address. When the invitee signs up
-- (or next returns) with a matching email, the pending row auto-converts to a
-- tenant_members row (status -> 'accepted'). Managers can revoke a pending row
-- before it's accepted (status -> 'revoked').
CREATE TABLE IF NOT EXISTS tenant_invitations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email               varchar(255) NOT NULL,                 -- stored lower-cased
  role                tenant_role NOT NULL DEFAULT 'developer',
  status              varchar(20) NOT NULL DEFAULT 'pending', -- pending | accepted | revoked
  invited_by_user_id  varchar(36),
  created_at          timestamp NOT NULL DEFAULT now(),
  accepted_at         timestamp,
  revoked_at          timestamp
);

-- At most one OPEN invite per (tenant, email): re-inviting the same address
-- refreshes the existing pending row (role/timestamp) instead of duplicating.
-- Accepted/revoked rows are exempt so history accumulates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_invitations_pending_unique
  ON tenant_invitations (tenant_id, email) WHERE status = 'pending';

-- Listing the pending roster for a tenant, and accept-on-login lookups by email.
CREATE INDEX IF NOT EXISTS idx_tenant_invitations_tenant_pending
  ON tenant_invitations (tenant_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_tenant_invitations_email_pending
  ON tenant_invitations (email) WHERE status = 'pending';
