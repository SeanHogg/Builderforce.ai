-- Auto-Detect Integration Gaps - Data Model & Schedule

-- -----------------------------------------------------------------------
-- Integration credentials (credentialCrypto encryption at rest)
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integration_credentials (
    id              BIGSERIAL PRIMARY KEY,
    tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id      INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    provider        VARCHAR(50) NOT NULL,
    name            VARCHAR(255) NOT NULL,
    base_url        VARCHAR(512),
    credentials_enc TEXT NOT NULL,              -- AES-256-GCM ciphertext
    iv              TEXT NOT NULL,
    is_enabled      BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMP NOT NULL DEFAULT now(),
    updated_at      TIMESTAMP NOT NULL DEFAULT now(),
    last_tested_at  TIMESTAMP,
    last_test_ok    BOOLEAN,
    CONSTRAINT integration_credential_unique UNIQUE (tenant_id, provider, name)
);

-- -----------------------------------------------------------------------
-- Gap checks catalog (config-driven, no code deployment needed)
-- -----------------------------------------------------------------------
CREATE TYPE gap_severity_enum AS ENUM ('critical', 'warning', 'informational');
CREATE TYPE gap_status_enum AS ENUM ('open', 'acknowledged', 'resolved');
CREATE TYPE gap_category_enum AS ENUM (
    'missing_webhook',
    'missing_permission',
    'incomplete_routing',
    'stale_credential',
    'misconfiguration'
);

CREATE TABLE integration_gap_catalog (
    id              BIGSERIAL PRIMARY KEY,
    provider        VARCHAR(50) NOT NULL,
    slug            VARCHAR(50) NOT NULL,                -- human-readable unique key
    name            VARCHAR(255) NOT NULL,
    description     TEXT NOT NULL,
    severity        gap_severity_enum NOT NULL DEFAULT 'informational',
    category        gap_category_enum NOT NULL,
    remediation_url VARCHAR(512),                        -- deeplink to provider settings
    api_signal_used VARCHAR(255),                        -- e.g., 'GitHub API: GET /repos/:id/hooks'
    created_at      TIMESTAMP NOT NULL DEFAULT now(),
    updated_at      TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT integration_gap_catalog_unique UNIQUE (provider, slug)
);

-- -----------------------------------------------------------------------
-- Detected gaps per integration (versioned evaluation)
-- -----------------------------------------------------------------------
CREATE TABLE integration_gaps (
    id              BIGSERIAL PRIMARY KEY,
    integration_id  BIGINT NOT NULL REFERENCES integration_credentials(id) ON DELETE CASCADE,
    catalog_id      BIGINT NOT NULL REFERENCES integration_gap_catalog(id) ON DELETE RESTRICT,
    severity        gap_severity_enum NOT NULL,
    status          gap_status_enum NOT NULL DEFAULT 'open',
    acknowledged_at TIMESTAMP,
    acknowledged_by VARCHAR(36),                        -- userId
    acknowledged_notes TEXT,
    evaluated_at    TIMESTAMP NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMP,
    resolved_by     VARCHAR(36),
    notes           TEXT,
    created_at      TIMESTAMP NOT NULL DEFAULT now(),
    updated_at      TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT integration_gap_integrity UNIQUE (integration_id, catalog_id, severity)
);

-- ---- Indexing ---------------------------------------------------------
CREATE INDEX if not EXISTS integration_gaps_integration_idx ON integration_gaps(integration_id);
CREATE INDEX if not EXISTS integration_gaps_status_idx ON integration_gaps(status);
CREATE INDEX if not EXISTS integration_gaps_severity_idx ON integration_gaps(severity);
CREATE INDEX if not EXISTS integration_gaps_catalog_idx ON integration_gaps(catalog_id);
CREATE INDEX if not EXISTS integration_gaps_integration_status_idx 
    ON integration_gaps(integration_id, status);
CREATE INDEX if not EXISTS integration_gap_catalog_provider_slug_idx ON integration_gap_catalog(provider, slug);

-- ---- Triggers ----------------------------------------------------------
CREATE OR REPLACE FUNCTION integration_gap_updated_at_trigger()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER integration_credentials_updated_at BEFORE UPDATE ON integration_credentials
    FOR EACH ROW EXECUTE FUNCTION integration_gap_updated_at_trigger();

CREATE TRIGGER integration_gap_catalog_updated_at BEFORE UPDATE ON integration_gap_catalog
    FOR EACH ROW EXECUTE FUNCTION integration_gap_updated_at_trigger();

CREATE TRIGGER integration_gaps_updated_at BEFORE UPDATE ON integration_gaps
    FOR EACH ROW EXECUTE FUNCTION integration_gap_updated_at_trigger();