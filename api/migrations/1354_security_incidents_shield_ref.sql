-- 1354 · Security incidents: runtime-shield refs dedupe, client attestation, redacted evidence
--         (make.md › PRD 31 §4 W10, design decision 9 + phase 7).
--
-- WHY. The browser runtime's Security Shield forwards quarantines and signature blocks through
-- `POST /api/security/shield-incidents` into `security_incidents` (`detection_source =
-- 'runtime-shield'`, `source_ref = shield:<projectId>:<applicationId>:<ruleId>`). Repeats of the
-- same rule on the same application must land on ONE incident. Migration 1321's
-- `uq_security_incidents_finding_ref` cannot do that:
--   * it is PARTIAL on `finding:%` only, so a `shield:` ref is not covered at all;
--   * `segment_id` is nullable (the set_default_segment_id() trigger fills it, but a tenant without
--     a default segment still writes NULL), and ordinary UNIQUE semantics treat NULLs as distinct,
--     so two rows with a NULL segment and the same ref would both insert.
--
-- THE NEW INDEX covers both platform-opened prefixes with NULLS NOT DISTINCT (PG ≥ 15; already used
-- by 0453/0468/1130). `segment_id` stays nullable table-wide — hand-entered incidents and other
-- writers rely on that.
--
-- Writers name the new index's predicate verbatim in their conflict target
-- (`(source_ref LIKE 'finding:%' OR source_ref LIKE 'shield:%')`, see
-- application/security/findingIncidentKinds.ts). The Worker still running the previous build
-- (migrations run before deploy) restates only `source_ref LIKE 'finding:%'`; that predicate
-- implies this index's, so its upsert keeps resolving to an arbiter either way.
--
-- PROVENANCE. `attestation` says who vouches for the row: NULL for hand-entered and server-detected
-- incidents (a scan the platform ran itself), 'client-attested' for events a browser runtime
-- reported and the server could not verify. `evidence` holds the runtime's REDACTED evidence
-- object (the ingest route refuses password/token/cookie keys and bounds the size).
--
-- EXPAND ONLY. Nullable columns, one new index, no drops. The runner wraps each file in one
-- transaction, so no CONCURRENTLY (the table is small: one row per incident).
--
-- CONTRACT (a later push): `DROP INDEX IF EXISTS uq_security_incidents_finding_ref;` once the
-- build that restates the new predicate is the only one running. It is strictly weaker than the
-- new index (narrower predicate, NULLs distinct), so leaving it in place for one push is harmless;
-- nothing references it by name. Mirror the drop in schema/delivery.ts.

SET LOCAL lock_timeout = '3s';

ALTER TABLE security_incidents ADD COLUMN IF NOT EXISTS attestation VARCHAR(20);
ALTER TABLE security_incidents ADD COLUMN IF NOT EXISTS evidence JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS uq_security_incidents_platform_ref
  ON security_incidents(tenant_id, segment_id, source_ref) NULLS NOT DISTINCT
  WHERE (source_ref LIKE 'finding:%' OR source_ref LIKE 'shield:%');
