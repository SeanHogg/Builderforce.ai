-- Provider webhooks for the Product Feedback pillar — Sentry / PostHog.
--
-- ── WHY THIS TABLE EXISTS ───────────────────────────────────────────────────
-- The feedback collector had exactly two doors: the embeddable snippet and the
-- signed-in in-app panel. Both require the team to instrument their product with
-- OUR widget. A team that already gathers requests somewhere — Sentry's User
-- Feedback dialog, a PostHog survey — could only get them onto this board by
-- copying them across by hand, which is precisely the work the board exists to
-- remove.
--
-- This row is the per-tenant configuration behind
-- `/api/feedback-webhooks/:collector_id/:provider`: which provider is wired up,
-- and the shared secret its signature is verified against.
--
-- ── WHY THE SECRET IS ENCRYPTED, NOT HASHED ─────────────────────────────────
-- `feedback_collectors.key_hash` is a HASH because verifying an ingest key only
-- needs to compare a presented value. A webhook secret cannot work that way: HMAC
-- verification has to RECOMPUTE the digest over the raw request body, which needs
-- the secret itself. So it is encrypted at rest under the same tenant-salted
-- AES-GCM envelope every other stored credential uses (`credentialCrypto`), with
-- the ciphertext and IV split across two columns exactly like
-- `error_collector_integrations`. Nothing ever returns it to a client; the UI
-- shows the secret once at creation and can only rotate it thereafter.
--
-- ── TENANCY ─────────────────────────────────────────────────────────────────
-- `tenant_id` is carried directly rather than reached through `collector_id`. The
-- tenant-scope guard can only check a predicate it can SEE on the table being
-- queried, and this row is the input to a DECRYPT: a child that reaches its
-- tenant through a join is unscoped by construction, and one forgotten join
-- condition would attempt another workspace's secret under this tenant's salt.

CREATE TABLE IF NOT EXISTS feedback_collector_integrations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  collector_id  uuid NOT NULL REFERENCES feedback_collectors(id) ON DELETE CASCADE,
  -- Must match a `feedbackProviders.ts` adapter id ('sentry' | 'posthog'). Kept as
  -- a varchar rather than an enum because adding an adapter should be a code
  -- change, not a migration — the registry is the authority, and an unknown value
  -- is answered with a 404 at the route rather than a constraint violation here.
  provider      varchar(32) NOT NULL,
  -- AES-GCM ciphertext of `{ secret }`, tenant-salted. Nullable so an integration
  -- can exist in a half-configured state while an operator sets it up on the
  -- provider's side; the route refuses every unsigned delivery until it is set.
  secret_enc    text,
  secret_iv     varchar(32),
  -- Pausing stops imports without discarding the secret, so a noisy provider can
  -- be silenced and resumed without being re-configured on the far side.
  enabled       boolean NOT NULL DEFAULT true,
  last_event_at timestamp,
  created_by    varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamp NOT NULL DEFAULT now(),
  updated_at    timestamp NOT NULL DEFAULT now()
);

-- One integration per (collector, provider). Without it, "the secret for Sentry on
-- this collector" becomes a question with two answers, and whether a signature
-- verifies would depend on which row the query happened to return first.
CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_collector_integration
  ON feedback_collector_integrations (collector_id, provider);

-- The settings read path: every integration a workspace has configured.
CREATE INDEX IF NOT EXISTS idx_feedback_collector_integrations_tenant
  ON feedback_collector_integrations (tenant_id);
