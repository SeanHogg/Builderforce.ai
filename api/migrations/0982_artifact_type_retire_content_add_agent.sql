-- ═══════════════════════════════════════════════════════════════════════════════
-- 0982 · artifact_type: retire 'content', admit 'agent'
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- WHY 'content' GOES
-- ------------------
-- `artifact_type = 'content'` referred to "content blocks", a feature that only
-- ever existed in the BROWSER: the blocks themselves lived in localStorage under
-- `bf-content-<tenant>` and were never written to any table. The server therefore
-- held assignments, likes and purchases whose target it could not name — the
-- Content assignments panel rendered the raw slug because there was nothing to
-- resolve it against, on every device except the one that authored the block.
--
-- Content itself has a real home now: `knowledge_documents`, which the one-time
-- client migration (`frontend/src/lib/contentManagerMigration.ts`) imports the
-- surviving localStorage blocks into. A knowledge document is assigned, liked and
-- sold through the knowledge subsystem's OWN tables, not through artifact_type.
--
-- WHAT IS LOST, EXACTLY
-- ---------------------
-- The DELETEs below drop:
--   * artifact_assignments rows of type 'content' — "block <uuid> is attached to
--     this project/agent". The block moved to knowledge_documents under a NEW id,
--     so the slug on these rows points at nothing and cannot be rewritten to
--     point at anything: the mapping old-block-id → new-document-id is produced
--     client-side, per browser, and was never persisted server-side.
--   * artifact_likes rows of type 'content' — a like count on a block only its
--     author's browser could name.
--   * marketplace_purchases rows of type 'content' — every one is price_cents = 0
--     (the purchase route only ever priced 'skill'; see marketplaceRoutes), so no
--     paid entitlement is destroyed and no refund is owed.
-- None of the three is recoverable from another table, and none of the three is
-- readable by the product after this migration. They are deleted rather than left
-- behind as unreadable rows in a column that can no longer hold their value.
--
-- WHY 'agent' ARRIVES IN THE SAME SWAP
-- ------------------------------------
-- Postgres has no DROP VALUE, so removing 'content' means rewriting the type
-- (the 0098 rename-swap pattern). Adding 'agent' in the SAME rewrite costs one
-- statement; doing it later would cost a second full rewrite of three tables,
-- two of which carry artifact_type in their PRIMARY KEY. Marketplace agents are
-- sold through `marketplace_purchases` from here on (see agentCommerce.ts) —
-- one purchase ledger for every artifact the marketplace sells, not a fourth
-- table.
--
-- Idempotent throughout: re-running finds `artifact_type` already rewritten (the
-- guard checks for the 'content' member) and does nothing.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1 · Drop the rows whose type is about to stop existing ──────────────────
DELETE FROM artifact_assignments  WHERE artifact_type::text = 'content';
DELETE FROM artifact_likes        WHERE artifact_type::text = 'content';
DELETE FROM marketplace_purchases WHERE artifact_type::text = 'content';

-- ── 2 · Rewrite the enum (0098 pattern) ─────────────────────────────────────
-- Guarded on the OLD member still being present, so a re-run is a no-op, and on
-- `artifact_type_old` being absent, so a half-applied run can be resumed.
DO $$ BEGIN
  IF EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = 'artifact_type' AND e.enumlabel = 'content'
      )
     AND NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'artifact_type_old') THEN

    ALTER TYPE artifact_type RENAME TO artifact_type_old;
    CREATE TYPE artifact_type AS ENUM ('skill', 'persona', 'agent');

    -- No column here declares a DEFAULT (all three are plain NOT NULL), so there
    -- is nothing to drop and re-attach — unlike 0098, whose `specs.status` did.
    ALTER TABLE artifact_assignments
      ALTER COLUMN artifact_type TYPE artifact_type
      USING (artifact_type::text)::artifact_type;

    ALTER TABLE artifact_likes
      ALTER COLUMN artifact_type TYPE artifact_type
      USING (artifact_type::text)::artifact_type;

    ALTER TABLE marketplace_purchases
      ALTER COLUMN artifact_type TYPE artifact_type
      USING (artifact_type::text)::artifact_type;

    DROP TYPE artifact_type_old;
  END IF;
END $$;

-- ── 3 · marketplace_purchases learns who bought and who took the money ──────
-- An agent is bought BY A WORKSPACE, not by a person: the entitlement the hire
-- gate reads is "does THIS tenant hold this agent", and the runtime binding the
-- purchase unlocks is tenant-wide. `tenant_id` is nullable because the historical
-- skill/persona rows predate any tenant and genuinely have none — a purchase made
-- from the marketing marketplace, where the buyer is a user with no workspace.
--
-- `provider` / `external_ref` are the pair `knowledge_listing_purchases` already
-- carries: which processor took the money and its own reference for the charge.
-- `stripe_payment_intent_id` stays for the legacy skill rows that populated it;
-- new agent rows write `external_ref`, so one column means one thing.
ALTER TABLE marketplace_purchases
  ADD COLUMN IF NOT EXISTS tenant_id    INTEGER      REFERENCES tenants(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS provider     VARCHAR(24),
  ADD COLUMN IF NOT EXISTS external_ref VARCHAR(255);

-- The idempotency guard for a replayed checkout redirect: one purchase per
-- (workspace, artifact). PARTIAL on `tenant_id IS NOT NULL` so the pre-existing
-- user-scoped rows — which have no tenant and may legitimately repeat — are not
-- retroactively constrained.
CREATE UNIQUE INDEX IF NOT EXISTS uq_marketplace_purchases_tenant_artifact
  ON marketplace_purchases (tenant_id, artifact_type, artifact_slug)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_marketplace_purchases_tenant
  ON marketplace_purchases (tenant_id);
