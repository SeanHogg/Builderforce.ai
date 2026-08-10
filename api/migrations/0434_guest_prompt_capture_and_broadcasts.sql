-- 0434_guest_prompt_capture_and_broadcasts.sql
--
-- Two halves of the same funnel: what an anonymous visitor ASKED FOR, and what
-- we are allowed to say back to them.
--
-- HALF ONE — capture the prompt.
--
-- A logged-out visitor starts a session by typing a prompt into the landing
-- canvas composer. Until now that prompt reached the model and then vanished:
-- `createLocalCreationSession` wrote it to the browser's localStorage, the
-- gateway forwarded it, and the only durable trace on our side was
-- `marketing_sessions.guest_chat_count` going up by one. The single most
-- valuable thing a lead ever tells us — what they were trying to build — was the
-- one thing not persisted.
--
-- `marketing_session_prompts` is that log: one row per submitted prompt, keyed
-- by the same opaque `visitor_id` the lead row already uses, so a prompt joins
-- to its session, its attribution, and (after signup) its account with no new
-- identity concept.
--
-- WHY A TABLE AND NOT A KERNEL PRIMITIVE. The kernel already owns conversation
-- (`threads` + `messages`) and that is where an authenticated chat turn belongs.
-- Both declare `tenant_id NOT NULL`, and this row is written BEFORE an account
-- exists, so neither can hold it. `activity_log` can (its `tenant_id` is
-- nullable for exactly this reason) but it is the audit store — a verb about a
-- thing, not the thing — and putting visitor-authored free text in it would put
-- erasable personal data in the one table erasure must not rewrite.
--
-- NO tenant_id, therefore, and the lead row it hangs off has none either. The
-- scope is `visitor_id`, which is narrower than tenant rather than looser — the
-- same decision already recorded for `email_otp_challenges`, and now recorded
-- for this pair in `check-tenant-column.mjs` as a decision instead of a
-- baseline entry.
--
-- NO ROLLUP COLUMNS on `marketing_sessions` (prompt_count / first_prompt / …).
-- They were in the first draft of this migration and they are a third-normal-form
-- violation: each is functionally determined by the prompt rows, not by the
-- session key, so every one is an update anomaly waiting for the first delete.
-- PRD 20 §2.2 lists "removing stored derived values" as one of the two places
-- the target model is deliberately STRICTER than its source, and this is that
-- rule applied to a table being touched rather than only to a table being
-- created. The sessions console gets its intent from ONE aggregate join
-- (`GuestPromptService.listSessionsWithIntent`), served through the canonical
-- read-through cache and invalidated on write — not from an N+1, and not from a
-- denormalised copy.
--
-- PII posture: a prompt is free text a visitor typed, so it is personal data —
-- capped in length on the way in, and erasable by `visitor_id` from the
-- superadmin console's per-visitor drawer
-- (`DELETE /api/admin/guest-sessions/:visitorId/prompts`). It hangs off no
-- cascade on purpose, because there is no user row to cascade FROM before
-- signup — so the erasure is explicit, and it is wired rather than implied.
--
-- HALF TWO — say something back.
--
-- `announcement_banners` was created by 0432 as a PRD 20 target and has been
-- cold ever since: declared, migrated, mapped, and read by nothing. It is
-- already the right shape for an operator-authored message with a tone, a CTA,
-- a window and an audience, so this wires it up rather than adding a second
-- table that means the same thing. It lacked only the operator half — who wrote
-- it, and whether it is live — so those two columns are added.
--
-- Engagement (impression / click / dismissal) is NOT counted in columns here.
-- Counters would again be derived values, and worse, they would be derived from
-- nothing: there would be no row to recount them from and no way to answer
-- "which visitor clicked", which is the whole attribution question. Those events
-- go to `activity_log`, the kernel's append-only event primitive, whose
-- `tenant_id` is already nullable for platform-global events and whose
-- `event_key` unique index makes an impression idempotent per visitor for free.
-- The counts are a GROUP BY over that table, cached.
--
-- Idempotent throughout: every statement is IF NOT EXISTS / ADD COLUMN IF NOT
-- EXISTS, so a replay against an environment that already ran this is a no-op.

-- ── Half one: prompts ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS marketing_session_prompts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id   VARCHAR(64) NOT NULL,
  -- The session the prompt opened: `local-<uuid>` before signup, the
  -- creation_sessions id after it is claimed. Not a foreign key on purpose — a
  -- local draft has no row anywhere until the visitor signs in.
  session_ref  VARCHAR(80),
  -- Where it was typed: 'landing' | 'canvas' | 'brain' | 'room'.
  surface      VARCHAR(24) NOT NULL DEFAULT 'landing',
  -- The chat/work mode armed on the composer when it was submitted (0409).
  mode         VARCHAR(16),
  prompt       TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The two reads that exist: one visitor's prompts newest-first (the drill-in),
-- and the platform's prompts newest-first (the console's default page).
CREATE INDEX IF NOT EXISTS idx_marketing_session_prompts_visitor
  ON marketing_session_prompts(visitor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_session_prompts_recent
  ON marketing_session_prompts(created_at DESC);

-- ── Half two: broadcasts ───────────────────────────────────────────────────

-- Who authored it. A platform broadcast has `tenant_id IS NULL`, so the author
-- is the only accountability the row carries.
ALTER TABLE announcement_banners ADD COLUMN IF NOT EXISTS created_by VARCHAR(36);

-- 'draft' | 'live' | 'archived'. Deliberately separate from starts_at/ends_at:
-- a scheduled banner is authored days before it should appear, and "is it
-- written" and "is it due" are different questions. Neither is derived from the
-- other, so both are stored.
ALTER TABLE announcement_banners ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'draft';

-- The delivery predicate, run for every visitor on every page load.
CREATE INDEX IF NOT EXISTS idx_announcement_banners_live
  ON announcement_banners(status, starts_at, ends_at);
