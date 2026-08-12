-- Owned, tenant-scoped web corpus, persistent crawl frontier, and inverted index.

CREATE TABLE IF NOT EXISTS web_search_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  seed_url TEXT NOT NULL,
  allowed_domains JSONB NOT NULL DEFAULT '[]'::jsonb,
  blocked_domains JSONB NOT NULL DEFAULT '[]'::jsonb,
  max_depth INTEGER NOT NULL DEFAULT 2 CHECK (max_depth BETWEEN 0 AND 10),
  crawl_delay_ms INTEGER NOT NULL DEFAULT 1000 CHECK (crawl_delay_ms BETWEEN 100 AND 86400000),
  per_domain_concurrency INTEGER NOT NULL DEFAULT 1 CHECK (per_domain_concurrency BETWEEN 1 AND 16),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, seed_url)
);

CREATE TABLE IF NOT EXISTS web_search_frontier (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_id UUID REFERENCES web_search_sources(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  domain VARCHAR(255) NOT NULL,
  depth INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','leased','fetched','failed','blocked')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_fetch_at TIMESTAMP NOT NULL DEFAULT NOW(),
  lease_expires_at TIMESTAMP,
  last_error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, normalized_url)
);
CREATE INDEX IF NOT EXISTS idx_web_search_frontier_ready
  ON web_search_frontier (tenant_id, status, next_fetch_at, priority DESC);
CREATE INDEX IF NOT EXISTS idx_web_search_frontier_domain
  ON web_search_frontier (tenant_id, domain, status, next_fetch_at);

CREATE TABLE IF NOT EXISTS web_search_robots (
  domain VARCHAR(255) PRIMARY KEY,
  body TEXT NOT NULL DEFAULT '',
  fetched_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  fetch_status INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS web_search_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  canonical_url TEXT NOT NULL,
  original_url TEXT NOT NULL,
  title TEXT,
  text TEXT NOT NULL,
  headings JSONB NOT NULL DEFAULT '[]'::jsonb,
  domain VARCHAR(255) NOT NULL,
  language VARCHAR(16),
  crawl_timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  publication_timestamp TIMESTAMP,
  content_hash VARCHAR(64) NOT NULL,
  http_status INTEGER NOT NULL,
  content_type VARCHAR(255) NOT NULL,
  outbound_links JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  author TEXT,
  word_count INTEGER NOT NULL DEFAULT 0,
  duplicate_of UUID REFERENCES web_search_documents(id) ON DELETE SET NULL,
  next_crawl_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, canonical_url)
);
CREATE INDEX IF NOT EXISTS idx_web_search_documents_hash ON web_search_documents (tenant_id, content_hash);
CREATE INDEX IF NOT EXISTS idx_web_search_documents_fresh ON web_search_documents (tenant_id, publication_timestamp DESC, crawl_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_web_search_documents_domain ON web_search_documents (tenant_id, domain);

CREATE TABLE IF NOT EXISTS web_search_terms (
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES web_search_documents(id) ON DELETE CASCADE,
  term VARCHAR(128) NOT NULL,
  title_frequency INTEGER NOT NULL DEFAULT 0,
  heading_frequency INTEGER NOT NULL DEFAULT 0,
  body_frequency INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, document_id, term)
);
CREATE INDEX IF NOT EXISTS idx_web_search_terms_lookup ON web_search_terms (tenant_id, term, document_id);

CREATE TABLE IF NOT EXISTS web_search_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  normalized_query TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','discovering','crawling','completed','failed')),
  result_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  requested_at TIMESTAMP NOT NULL DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, normalized_query)
);
CREATE INDEX IF NOT EXISTS idx_web_search_requests_status ON web_search_requests (tenant_id, status, requested_at);

CREATE TABLE IF NOT EXISTS web_search_request_urls (
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  request_id UUID NOT NULL REFERENCES web_search_requests(id) ON DELETE CASCADE,
  frontier_id BIGINT NOT NULL REFERENCES web_search_frontier(id) ON DELETE CASCADE,
  status VARCHAR(16) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','indexed','failed','blocked')),
  PRIMARY KEY (tenant_id, request_id, frontier_id)
);
CREATE INDEX IF NOT EXISTS idx_web_search_request_urls_frontier ON web_search_request_urls (tenant_id, frontier_id, request_id);
