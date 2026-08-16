-- 0476 · Professional references — the people who will vouch for you.
--
-- Two ported hired.video articles send readers to `/references`, and the page did
-- not exist. The failure it prevents is the one both articles open with: references
-- live scattered across an inbox and a Google Doc, so when an employer finally asks,
-- the candidate is reconstructing contact details from memory under time pressure.
--
-- ── WHY A SHARE IS ITS OWN ROW ────────────────────────────────────────────────
-- A reference is private by default and stays that way. What gets handed to an
-- employer is a SHARE — a token, a chosen subset, an optional expiry — because the
-- alternative (a public profile field) publishes a third party's phone number to
-- anyone who finds the page. The people on this list did not sign up here and
-- cannot manage their own exposure, so the product has to do it for them: nothing
-- is visible without a token, a token names exactly which references it covers, and
-- revoking it is one UPDATE.

-- ── TWO GUARD BASELINES GREW FOR THIS MIGRATION, BOTH DELIBERATELY ───────────
--
-- `check-tenant-column`: neither table carries a tenant_id, and must not. A
-- reference belongs to a PERSON's career, not to a workspace — the same call
-- `freelancer_profiles` already makes, keyed by user_id alone. Somebody keeping a
-- reference list may have no workspace at all, and a tenant column here would
-- either be null everywhere or silently bind a private list to whichever employer
-- they last joined.
--
-- `check-shape-lint`: `reference_shares` matches the kernel's `share_links` shape
-- and does not reuse it, for two reasons that are not stylistic. `share_links` is
-- NOT NULL on tenant_id (see above), and it grants access to exactly ONE
-- `objects` row, where a reference share covers a CHOSEN SUBSET of several rows
-- that are not kernel objects. What this table DOES take from that primitive is
-- the part that matters: only the token's hash is stored, never the token.

CREATE TABLE IF NOT EXISTS professional_references (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           VARCHAR(160) NOT NULL,
  -- How they know you: "Manager at Fintech Co, 2021–2024". One line, because that
  -- is what an employer reads first and the only thing they need to judge relevance.
  relationship   VARCHAR(240),
  company        VARCHAR(160),
  title          VARCHAR(160),
  email          VARCHAR(320),
  phone          VARCHAR(60),
  -- What this person can actually speak to. The articles' whole argument: a
  -- reference who is briefed on which two things to confirm is worth three who
  -- were told "they might call".
  can_speak_to   TEXT,
  -- draft → requested → confirmed | declined. Confirmation is recorded by the
  -- OWNER (the referee has no account here), so it is a claim, not a signature.
  status         VARCHAR(16) NOT NULL DEFAULT 'draft',
  requested_at   TIMESTAMPTZ,
  confirmed_at   TIMESTAMPTZ,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_professional_references_user
  ON professional_references (user_id, created_at DESC);

-- One share = one token = one chosen subset. `reference_ids` is a jsonb array of
-- ids rather than a join table because a share is immutable once issued: changing
-- which references it covers must mean issuing a NEW token, not silently widening
-- an employer's access to a link they were already sent.
CREATE TABLE IF NOT EXISTS reference_shares (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Only the HASH is stored, the rule the kernel's `share_links` states and the
  -- same one `email_verification_codes` applies: a raw bearer token that grants
  -- access to a third party's contact details must not be readable from the row.
  -- The link is shown to its creator once, at issue time, and never again.
  token_hash     VARCHAR(64) NOT NULL UNIQUE,
  label          VARCHAR(160),
  reference_ids  JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Contact details are the sensitive half; a share can withhold them and still
  -- prove the reference exists and what they can speak to.
  include_contact BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at     TIMESTAMPTZ,
  revoked_at     TIMESTAMPTZ,
  view_count     INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reference_shares_user
  ON reference_shares (user_id, created_at DESC);
