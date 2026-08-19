-- The data room's safety columns, ENFORCED (ROADMAP FO-E2).
--
-- `data_rooms` has carried `nda_required`, `watermark` and `expires_at` since
-- migration 0422, and nothing read any of the three: there was no share flow, no
-- access log and no view analytics, so the properties that make a data room safe
-- to send were decoration. `dataRoom.share` was a GATED canvas act with nothing
-- behind the gate — a human could approve it and no link was ever minted.
--
-- ── ONE TABLE, AND WHY IT IS NOT `legal_document_shares` ────────────────────
-- The two look alike and are not the same noun. A legal-document share grants a
-- recipient ONE sealed file; a data-room share grants a NEGOTIATED RELATIONSHIP
-- with a firm — it can require an NDA first, it inherits the room's own expiry,
-- and it is the thing view analytics are reported per. Folding them into one
-- polymorphic table would trade two real foreign keys for a string discriminator
-- and put the NDA columns on every legal-file share that can never use them.
-- What IS shared is the credential mechanics, and those already live in exactly
-- one place (`application/security/shareToken.ts`) — this table stores a hash the
-- same way `signature_parties`, `form_recipients` and `legal_document_shares` do,
-- and the resolve-time policy (revoked? expired?) is now the single predicate
-- `shareGrantState()` all four call.
--
-- ── NO `nda_state` COLUMN, DELIBERATELY ────────────────────────────────────
-- Whether the NDA is signed is `signature_requests.status` on the row
-- `nda_signature_request_id` points at, derived at read time — the same rule
-- `legal_document_files` states for its own status, and the reason a data room
-- cannot report "signed" for an NDA that was declined.
--
-- ── NO ACCESS-LOG TABLE, ALSO DELIBERATELY ─────────────────────────────────
-- `activity_log` is THE audit store (migration 0295) and is already indexed on
-- (tenant_id, target_type, target_id), which is exactly the access path "every
-- event for this data room" needs. Every view is recorded there under
-- `data_room.share_viewed` / `data_room.document_viewed`, and the analytics
-- endpoint is a GROUP BY over it — a second, private log would be the drift the
-- consolidation exists to prevent.

CREATE TABLE IF NOT EXISTS data_room_shares (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  data_room_id             integer NOT NULL REFERENCES data_rooms(id) ON DELETE CASCADE,
  -- The token IS the credential, so only its hash is stored: a leaked database
  -- row cannot mint a working link.
  token_hash               varchar(64) NOT NULL,
  recipient_name           varchar(200),
  recipient_email          varchar(320),
  -- The FIRM, as a `party_roles.party_ref` — so "which fund read the cap table"
  -- joins to the same investor object the raise pipeline uses (FO-A1, FO-E1)
  -- rather than to a typed name.
  firm_party_ref           varchar(64),
  -- 'view' | 'download'. Forced to 'view' at mint time while the room requires a
  -- watermark: an un-watermarked copy of a watermarked room is the one thing the
  -- column exists to prevent.
  permission               varchar(16) NOT NULL DEFAULT 'view',
  nda_signature_request_id integer REFERENCES signature_requests(id) ON DELETE SET NULL,
  -- The SHARE's own lapse date. The ROOM's `expires_at` is enforced on top of it
  -- at resolve time, so shortening the room shortens every link into it.
  expires_at               timestamp,
  revoked_at               timestamp,
  created_by               varchar(64),
  created_at               timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_data_room_shares_token ON data_room_shares (token_hash);
CREATE INDEX IF NOT EXISTS idx_data_room_shares_room ON data_room_shares (data_room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_data_room_shares_tenant ON data_room_shares (tenant_id, created_at);
