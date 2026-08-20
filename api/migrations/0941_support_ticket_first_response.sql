-- 0941 — Record when a support ticket first got an ANSWER.
--
-- ── A METRIC THAT WAS NOT MERELY UNWRITTEN — IT WAS UNCOMPUTABLE ────────────
-- `DOMAIN_MANIFEST` has declared `support.first_response_min` since the Support
-- seat existed. `support_tickets` recorded `opened_at` and `resolved_at` and
-- nothing in between, so the number could not be derived from this database at
-- all — not by a rollup, not by a report, not by hand.
--
-- Substituting resolution time would have been worse than an empty panel: a team
-- that replies in four minutes and ships the fix four days later would have been
-- reported as taking four days to answer, which is the opposite of what the
-- metric exists to measure and the kind of error a support lead is judged on.
--
-- ── WHOSE CLOCK ─────────────────────────────────────────────────────────────
-- The help desk's. Freshdesk and Freshservice both publish `stats.first_
-- responded_at` on a ticket, and it is THEIR timestamp — the moment the customer
-- actually saw a reply — rather than the moment our poller happened to notice.
-- The ITSM ingest maps it through `NormalizedTicket.fields.firstRespondedAt`, so
-- a provider that does not expose one simply leaves the column NULL.
--
-- Tickets ingested before this column existed keep NULL and are EXCLUDED from
-- the metric rather than back-filled. A first-response time nobody measured is
-- not zero, and a zero here would report instant answers for the entire history
-- of every workspace.

ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS first_responded_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_support_tickets_first_response
  ON support_tickets (tenant_id, first_responded_at);

COMMENT ON COLUMN support_tickets.first_responded_at IS
  'When the help desk recorded the first agent reply. Sourced from the provider''s own stats, never from our poll time. NULL = never answered, or the provider does not report it — excluded from support.first_response_min rather than counted as zero.';
