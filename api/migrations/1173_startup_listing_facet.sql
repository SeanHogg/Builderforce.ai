-- 1173 · The startup listing facet on `companies`, and investor interest as deal flow.
--
-- PRD 19 B1/B2 — BurnRateOS's business directory ("list your startup, meet
-- investors") merges onto the CEO's `companies` root. BurnRateOS itself had already
-- collapsed its `BusinessProfile` model INTO `Company` (its public directory read
-- `companies` directly, joined to `business_metrics` and `investment_opportunities`),
-- so the listing is a FACET of the company — columns here, the same flattening move
-- §3.1 made for the CRM facet — and not a second table. `newTablesAllowed: false`
-- (burnrateCutoverPolicy) holds: zero CREATE TABLE.
--
-- Three groups of columns, each a different kind of fact:
--   • the public profile   — tagline, description, logo, business stage, location,
--                            founders, what the company is seeking, funding goal and
--                            total raised;
--   • declared finance     — cash on hand, monthly budget, team cost, monthly revenue,
--                            and WHEN they were declared. Runway is never stored: it is
--                            cash ÷ net burn, computed by the one shared formula, so it
--                            cannot disagree with the inputs that produced it;
--   • the listing decision — is it public, is it raising, does it take inquiries, and
--                            who to contact. `listed_at` is stamped by the publish
--                            transition, so a listed company with no listing time is
--                            unrepresentable rather than merely unlikely.
--
-- `slug` was per-tenant. A public URL needs it unique among LISTED companies only,
-- so the partial unique index below is the rule — two tenants may both have an
-- "acme" they never list.
--
-- An investor "expressing interest" is inbound deal flow in the FOUNDER's tenant:
-- BurnRateOS wrote an `investor_inquiries` row and a CRM deal for it, and
-- `source-to-target.tsv` folded the inquiry into `deal_flow_opportunities`. That
-- table names the prospect's firm and email but not WHICH of the tenant's companies
-- the interest is about, nor the person's name — hence the three columns. `details`
-- holds the optional answers of the interest form (amount, instrument, timeframe,
-- expertise, accreditation); none is filtered on, so a jsonb bag beats nine
-- mostly-null columns, and the shape is documented on the writer.
--
-- `stage_lookup` (0430) was created empty; `companies.stage` "references" a
-- vocabulary nothing seeded. The company stages are seeded here from the ONE
-- declaration in `packages/creation-canvas-contract/src/startupListing.ts`, so the
-- lookup a form reads and the filter a directory applies are the same eight rows.

ALTER TABLE companies ADD COLUMN IF NOT EXISTS tagline               VARCHAR(160);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS description           TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_url              VARCHAR(500);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS business_stage        VARCHAR(24);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS city                  VARCHAR(120);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS region                VARCHAR(120);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS founders_count        INTEGER;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS seeking               JSONB;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS funding_goal          NUMERIC(18, 2);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS total_funding_raised  NUMERIC(18, 2);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS cash_on_hand          NUMERIC(18, 2);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS monthly_budget        NUMERIC(18, 2);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS monthly_revenue       NUMERIC(18, 2);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS team_cost             NUMERIC(18, 2);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS finance_declared_at   TIMESTAMP;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_publicly_listed    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_seeking_investment BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS allow_investor_inquiries BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS investor_contact_name  VARCHAR(160);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS investor_contact_email VARCHAR(320);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS listed_at             TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS uq_companies_public_slug
  ON companies (slug) WHERE is_publicly_listed = TRUE;
CREATE INDEX IF NOT EXISTS idx_companies_directory
  ON companies (is_publicly_listed, is_seeking_investment, stage, sector, listed_at DESC);

ALTER TABLE deal_flow_opportunities ADD COLUMN IF NOT EXISTS subject_company_id INTEGER;
ALTER TABLE deal_flow_opportunities ADD COLUMN IF NOT EXISTS contact_name       VARCHAR(160);
ALTER TABLE deal_flow_opportunities ADD COLUMN IF NOT EXISTS details            JSONB;
CREATE INDEX IF NOT EXISTS idx_deal_flow_subject_company
  ON deal_flow_opportunities (tenant_id, subject_company_id, status, created_at DESC);

INSERT INTO stage_lookup (category, key, label, position, description) VALUES
  ('company', 'bootstrapped',   'Bootstrapped', 0, 'Self-funded; growing on revenue and founders'' own capital'),
  ('company', 'pre_seed',       'Pre-Seed',     1, 'Validating the idea and building the first version'),
  ('company', 'seed',           'Seed',         2, 'A proven concept raising its first outside round'),
  ('company', 'series_a',       'Series A',     3, 'Product-market fit; scaling the operation'),
  ('company', 'series_b',       'Series B',     4, 'Expanding market reach and the team'),
  ('company', 'series_c',       'Series C',     5, 'Preparing for market leadership'),
  ('company', 'series_d_plus',  'Series D+',    6, 'Late stage with significant market presence'),
  ('company', 'ipo_ready',      'IPO Ready',    7, 'Preparing for a public offering')
ON CONFLICT (category, key) DO NOTHING;
