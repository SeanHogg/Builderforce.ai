-- 1321 · Idempotency for the writes the DevSecOps layer makes on its own.
--
-- WHY. PRD 08 §10: a CRITICAL finding auto-opens a SecurityIncident and a merged PR auto-creates
-- SocEvidence. Both are written by code that can run twice for the same fact (a finalize that is
-- retried, a sweep that overlaps another, a scan re-ingested). "Exactly one row per fact" has to be
-- the database's answer, not a read-then-write race.
--
--   security_incidents  one auto-opened incident per repository + finding fingerprint: `source_ref` is
--                       `finding:<owner/repo>:<fingerprint>` for the rows the agent opens (the same
--                       finding in another repository is another incident).
--   soc_evidence        one automated evidence row per (control, provenance): `source_ref` is
--                       `auto:<kind>:<id>` (pr / scan / review).
--
-- Both indexes are PARTIAL on the reserved prefix, so no existing row — hand-entered incidents and
-- evidence leave `source_ref` NULL or free-form — can collide with them. Writers use a target-less
-- ON CONFLICT DO NOTHING, which matches whichever unique index fires.
CREATE UNIQUE INDEX IF NOT EXISTS uq_security_incidents_finding_ref
  ON security_incidents(tenant_id, segment_id, source_ref)
  WHERE source_ref LIKE 'finding:%';

CREATE UNIQUE INDEX IF NOT EXISTS uq_soc_evidence_auto_ref
  ON soc_evidence(control_id, source_ref)
  WHERE source_ref LIKE 'auto:%';
