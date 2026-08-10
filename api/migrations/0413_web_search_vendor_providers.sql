-- Migration: BYO web-search vendors — Tavily, Exa, Linkup.
--
-- Replaces `brave_search` (migration 0353) as the set of KEYED search vendors behind the
-- port in application/runtime/webSearchVendors.ts. Brave was dropped as a product
-- decision; the three added here were chosen for the same reason it originally was — a
-- self-serve free tier a tenant can start on without a sales call — plus one Brave did
-- not have: all three return page CONTENT in the search response, so a result is often
-- usable without a second `web_fetch`.
--
--   tavily — 1,000 credits/month free, no card. Agent-oriented; the default.
--   exa    — neural/semantic search; answers a different KIND of question well.
--   linkup — European index, standing free tier.
--
-- These are the CREDENTIALED tier only. Beneath them sit two vendors that need no
-- credential and therefore no row here: an operator's own SearXNG instance (addressed by
-- the `SEARXNG_URL` env var, not by a stored key) and the keyless Wikipedia floor. That
-- is why search now works on a deployment with nothing configured at all, and why this
-- migration is not required for the feature to function.
--
-- The key lives in `integration_credentials` — the same vault github/jira/sentry/linear
-- already use (per-tenant PBKDF2-derived AES-GCM, `is_enabled`, one CRUD surface at
-- /api/integrations) — whose `provider` column is the `integration_provider` enum, so a
-- new vendor is exactly one enum value plus one adapter.
--
-- `brave_search` is deliberately NOT removed. PostgreSQL has no `ALTER TYPE ... DROP
-- VALUE`, so dropping it would mean recreating the enum and rewriting every dependent
-- column — a large, risky migration to reclaim one unused label. The value simply stops
-- being produced: no adapter answers to it, so `webSearchVendor('brave_search')` returns
-- null and any pre-existing row is treated as an unwired vendor and skipped, exactly as
-- the resolver already handles a provider this build does not know.
--
-- Purely ADDITIVE and idempotent: an enum value cannot break existing rows.
--
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block on older
-- PostgreSQL, and a new value is not usable in the same transaction that adds it.
-- This migration therefore does nothing else.

ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'tavily';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'exa';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'linkup';
