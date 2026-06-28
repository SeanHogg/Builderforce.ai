-- 0251_devex_segments_and_recipients.sql
-- Richer DevEx survey visuals (segment heatmap, participation timeline, honest
-- response rate). Two additive, idempotent columns:
--
--   devex_responses.segments       — per-response demographic tags
--                                    ({ group?, team?, location?, role? }) used to
--                                    break results down by segment WITHOUT tying a
--                                    submission to a person. Anonymity is preserved
--                                    in the rollup (segment groups with < 3
--                                    responses are never shown in detail).
--   devex_campaigns.recipient_count — the expected reach of a campaign, so the
--                                    response rate is responses ÷ recipients
--                                    instead of the responses ÷ campaigns proxy.
--
-- Both columns are nullable / defaulted so existing rows keep working; ADD COLUMN
-- IF NOT EXISTS makes the migration safe to re-run.

ALTER TABLE devex_responses
  ADD COLUMN IF NOT EXISTS segments JSONB NOT NULL DEFAULT '{}';

ALTER TABLE devex_campaigns
  ADD COLUMN IF NOT EXISTS recipient_count INTEGER;
