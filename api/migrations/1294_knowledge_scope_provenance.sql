-- 1294 · Optional provenance of an uploaded knowledge pack (PRD 40, OD-3).
--
-- `knowledge_scopes.provenance` records who reviewed a pack and how, as the pack file carries it:
-- `{ reviewedBy?, judgeModel?, policy?, reviewedAt? }` (each an optional string, ≤ 255 chars,
-- validated at the route). The server stores it ONLY on a pack root (`pack:` host segment) — a
-- reviewed folder's scope never takes it — and the scopes list returns it on pack scopes.
--
-- NULL for every row written before this and for every scope without provenance.
--
-- Expand only: one nullable column, no default, no backfill. The old Worker's INSERT/UPDATE of
-- knowledge_scopes names neither the column nor reads it, so it is unaffected while the deploy
-- completes. Idempotent / re-runnable; reversible by DROP COLUMN.
SET LOCAL lock_timeout = '3s';

ALTER TABLE knowledge_scopes ADD COLUMN IF NOT EXISTS provenance jsonb;
