-- 0335_rfp_response.sql
-- RFP / RFQ Response (PRD 15) — pre-sales proposal generation.
--
-- A tenant answers an incoming RFQ/RFP. Each request captures the ASKING business's
-- brand (co-branding) + the requirements, and is either greenfield ('new') or grounded
-- on an existing tenant project ('existing_project'). Generating a response produces a
-- co-branded proposal: capability roster (grounded in a fresh diagnostics scan when the
-- last one is >5 days old), a P&L (build + agentic + marketing + margin), a phase/
-- milestone plan (Gantt), risks, dependencies and a delivery timeline — rendered as a
-- self-contained branded document.
--
-- Also seeds two new built-in agents that co-author the response: a CTO (feasibility,
-- architecture, effort, risk) and a Product Owner (scope, value, roadmap, positioning).
-- New tenants get them via provisionBuiltinAgents; here we backfill existing tenants.
--
-- Idempotent throughout (CREATE TABLE / CREATE INDEX IF NOT EXISTS + NOT EXISTS agent seed).

-- A. The incoming RFP/RFQ ----------------------------------------------------
CREATE TABLE IF NOT EXISTS rfp_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id          UUID REFERENCES segments(id) ON DELETE CASCADE,
  title               VARCHAR(255) NOT NULL,
  requester_org_name  VARCHAR(255),
  requester_brand     JSONB,                                  -- BrandPalette of the asking business
  requirements        TEXT,                                   -- pasted RFP/RFQ text
  source_mode         VARCHAR(16) NOT NULL DEFAULT 'new',     -- new | existing_project
  based_on_project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  margin_pct          REAL,                                   -- override; defaults applied in code
  marketing_pct       REAL,
  contingency_pct     REAL,
  due_date            TIMESTAMPTZ,
  status              VARCHAR(24) NOT NULL DEFAULT 'draft',   -- draft | analyzing | ready | submitted
  created_by          VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rfp_requests_tenant  ON rfp_requests(tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_rfp_requests_project ON rfp_requests(based_on_project_id);

-- B. The generated proposal --------------------------------------------------
CREATE TABLE IF NOT EXISTS rfp_responses (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id            UUID REFERENCES segments(id) ON DELETE CASCADE,
  request_id            UUID NOT NULL REFERENCES rfp_requests(id) ON DELETE CASCADE,
  project_id            INTEGER REFERENCES projects(id) ON DELETE SET NULL,  -- grounding project
  status                VARCHAR(24) NOT NULL DEFAULT 'draft',                -- draft | ready | submitted
  body                  JSONB,                                               -- RfpResponseBody (typed in code)
  doc_html              TEXT,                                                -- rendered self-contained branded document
  quoted_price_usd_cents INTEGER,                                            -- headline number (queryable)
  margin_pct            REAL,
  scan_refreshed        BOOLEAN NOT NULL DEFAULT FALSE,                      -- did the freshness gate re-run a scan
  generated_by          JSONB,                                              -- { cto, productOwner } agent refs used
  created_by            VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rfp_responses_tenant  ON rfp_responses(tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_rfp_responses_request ON rfp_responses(request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rfp_responses_project ON rfp_responses(project_id);

-- C. Seed the CTO + Product Owner built-in agents (existing tenants) ----------
-- New tenants get them via provisionBuiltinAgents; builtin_kind keys dispatch/lookup.
INSERT INTO ide_agents (id, tenant_id, name, title, bio, skills, base_model, status, runtime_support, published, price_cents, builtin_kind)
SELECT 'cto-t' || t.id, t.id, 'CTO',
       'CTO — technical feasibility, architecture, effort & risk for pre-sales',
       'Assesses an RFP from the build side: judges technical feasibility against the tenant''s real capabilities, proposes an architecture and phase plan, estimates build effort and agentic cost, and surfaces the key delivery risks and dependencies so the proposal is grounded, not aspirational.',
       '["architecture","feasibility","estimation","risk-analysis","technical-strategy"]',
       'builderforce-default', 'active', 'cloud', FALSE, 0, 'cto'
FROM tenants t
WHERE NOT EXISTS (SELECT 1 FROM ide_agents a WHERE a.tenant_id = t.id AND a.builtin_kind = 'cto');

INSERT INTO ide_agents (id, tenant_id, name, title, bio, skills, base_model, status, runtime_support, published, price_cents, builtin_kind)
SELECT 'product-owner-t' || t.id, t.id, 'Product Owner',
       'Product Owner — scope, value framing, roadmap & win themes for pre-sales',
       'Shapes the RFP response from the product side: frames the scope and value proposition against the buyer''s stated needs, sequences the roadmap into phases and milestones, and writes the executive summary and win themes that co-brand the responder with the requesting organisation.',
       '["product-management","scoping","value-proposition","roadmapping","proposal-writing"]',
       'builderforce-default', 'active', 'cloud', FALSE, 0, 'product_owner'
FROM tenants t
WHERE NOT EXISTS (SELECT 1 FROM ide_agents a WHERE a.tenant_id = t.id AND a.builtin_kind = 'product_owner');
