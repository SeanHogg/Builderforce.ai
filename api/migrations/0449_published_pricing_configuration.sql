-- One authoritative, publish-gated document for every public pricing surface.
CREATE TABLE IF NOT EXISTS platform_pricing_configuration (
  key                VARCHAR(32) PRIMARY KEY,
  draft_document     JSONB NOT NULL,
  published_document JSONB NOT NULL,
  published_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  published_by       VARCHAR(36),
  updated_at         TIMESTAMP NOT NULL DEFAULT NOW()
);
