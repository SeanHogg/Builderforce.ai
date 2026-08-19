-- 0483_rfp_risk_register_and_tenant_brand.sql
-- RFP / RFQ Response (PRD 15) — close the three deferred sub-items that needed DDL.
--
-- A. `rfp_risks` — the risks and dependencies a proposal carries stop being JSON
--    buried in `rfp_responses.body` and become a queryable REGISTER. Until now a
--    risk existed only inside one document, so nothing could answer "which risk
--    do we raise on every bid", "how many open high risks are we carrying across
--    live proposals", or "who owns this dependency". One table, not two: a risk
--    and a dependency are the same fact — a named thing that can stop the
--    delivery, attached to one response — differing only in which vocabulary
--    grades it. `kind` is that column value, per the rule that a new kind is a
--    value and not a new table.
--
-- B. `tenants.brand_palette` — the responder side of the co-branding. There was
--    no per-tenant brand-colour store at all, so `blendPalettes` always blended
--    the requester against a hard-coded Builderforce default and every tenant's
--    proposals came out the same colour. One JSONB column on the row that owns
--    the fact, rather than a settings singleton table.
--
-- C. `rfp_responses.deep_analysis_run_id` — the freshness gate can now FIRE the
--    deep architecture analysis when the deep artifacts are themselves stale.
--    That run is asynchronous, so the response points at it and the detail view
--    polls; the state itself is never copied here, it is read from the run row.
--
-- Idempotent throughout.

-- A. The register ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rfp_risks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id    UUID REFERENCES segments(id) ON DELETE CASCADE,
  response_id   UUID NOT NULL REFERENCES rfp_responses(id) ON DELETE CASCADE,
  request_id    UUID NOT NULL REFERENCES rfp_requests(id) ON DELETE CASCADE,
  -- 'risk' | 'dependency'. Decides which of the two grading columns applies.
  kind          VARCHAR(16) NOT NULL DEFAULT 'risk',
  title         VARCHAR(255) NOT NULL,
  -- Risks only: 'low' | 'medium' | 'high' — the delivery risk vocabulary the
  -- narrative already speaks, so a roll-up can rank across responses.
  severity      VARCHAR(16),
  -- Dependencies only: 'internal' | 'external' | 'third_party'.
  dependency_type VARCHAR(24),
  -- The mitigation (risk) or the note (dependency): what is DONE about it.
  detail        TEXT,
  -- The register's own lifecycle, which the generated document has no room for:
  -- 'open' | 'accepted' | 'mitigated' | 'closed'.
  status        VARCHAR(16) NOT NULL DEFAULT 'open',
  owner_user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  -- Ordinal within its response, so the register replays the document's order.
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rfp_risks_tenant   ON rfp_risks(tenant_id, kind, status);
CREATE INDEX IF NOT EXISTS idx_rfp_risks_response ON rfp_risks(response_id, position);
CREATE INDEX IF NOT EXISTS idx_rfp_risks_request  ON rfp_risks(request_id);
CREATE INDEX IF NOT EXISTS idx_rfp_risks_owner    ON rfp_risks(owner_user_id);

-- B. The responder tenant's palette ------------------------------------------
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS brand_palette JSONB;

-- C. The deep-analysis run a response is waiting on --------------------------
ALTER TABLE rfp_responses ADD COLUMN IF NOT EXISTS deep_analysis_run_id UUID;
CREATE INDEX IF NOT EXISTS idx_rfp_responses_deep_run ON rfp_responses(deep_analysis_run_id);

-- D. Backfill the register from every response already generated -------------
-- The risks and dependencies are already in `body`; the register is a projection
-- of the same fact, so an existing proposal joins the roll-up without being
-- regenerated. `NOT EXISTS` keeps a re-run of this migration a no-op.
INSERT INTO rfp_risks (tenant_id, segment_id, response_id, request_id, kind, title, severity, detail, position)
SELECT r.tenant_id, r.segment_id, r.id, r.request_id, 'risk',
       left(coalesce(item->>'title', 'Untitled risk'), 255),
       CASE WHEN item->>'severity' IN ('low','medium','high') THEN item->>'severity' ELSE 'medium' END,
       item->>'mitigation',
       (ord - 1)::int
FROM rfp_responses r
CROSS JOIN LATERAL jsonb_array_elements(coalesce(r.body->'risks', '[]'::jsonb)) WITH ORDINALITY AS t(item, ord)
WHERE NOT EXISTS (SELECT 1 FROM rfp_risks x WHERE x.response_id = r.id AND x.kind = 'risk');

INSERT INTO rfp_risks (tenant_id, segment_id, response_id, request_id, kind, title, dependency_type, detail, position)
SELECT r.tenant_id, r.segment_id, r.id, r.request_id, 'dependency',
       left(coalesce(item->>'title', 'Untitled dependency'), 255),
       CASE WHEN item->>'type' IN ('internal','external','third_party') THEN item->>'type' ELSE 'external' END,
       item->>'note',
       (ord - 1)::int
FROM rfp_responses r
CROSS JOIN LATERAL jsonb_array_elements(coalesce(r.body->'dependencies', '[]'::jsonb)) WITH ORDINALITY AS t(item, ord)
WHERE NOT EXISTS (SELECT 1 FROM rfp_risks x WHERE x.response_id = r.id AND x.kind = 'dependency');
