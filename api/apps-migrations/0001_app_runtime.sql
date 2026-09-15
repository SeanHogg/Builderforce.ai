-- Apps runtime database (NEON_APPS_DATABASE_URL): the marketplace apps' own data —
-- the published site and everything its visitors create. Split out of the primary so
-- public app traffic wakes THIS endpoint and not the core one (Neon bills awake time).
--
-- Column-for-column the primary's `project_sites` and `site_*` tables as they stand
-- (taken from the 2026-09-14 schema), with the same constraint names, so the rows copy
-- across unchanged at cutover. Keys INTO the core database — tenant_id, project_id,
-- audience_id, origin_session_id, catalog_item_id, snapshot_id, landing_object_id — are
-- bare ids: Postgres cannot enforce a foreign key across databases, so the cascades the
-- primary's FKs gave are carried out by the application. Keys WITHIN this cluster keep
-- their FKs and their cascades.
--
-- After the cutover copy, each sequence must be advanced past the copied ids
-- (setval to max(id)) or the first insert collides.

CREATE TABLE project_sites (
  id serial PRIMARY KEY,
  project_id integer NOT NULL CONSTRAINT project_sites_project_id_key UNIQUE,
  tenant_id integer NOT NULL,
  subdomain varchar(63) NOT NULL CONSTRAINT project_sites_subdomain_key UNIQUE,
  mode varchar(16) NOT NULL DEFAULT 'static',
  status varchar(16) NOT NULL DEFAULT 'active',
  r2_prefix text NOT NULL,
  version_token varchar(32) NOT NULL,
  index_document varchar(128) NOT NULL DEFAULT 'index.html',
  custom_domain varchar(255),
  asset_count integer NOT NULL DEFAULT 0,
  total_bytes bigint NOT NULL DEFAULT 0,
  published_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  custom_domain_status varchar(24) NOT NULL DEFAULT 'unset',
  custom_domain_token varchar(64),
  custom_domain_verified_at timestamp,
  custom_domain_hostname_id varchar(64),
  custom_domain_error text,
  landing_object_id uuid
);
CREATE INDEX idx_project_sites_custom_domain ON project_sites (custom_domain) WHERE custom_domain IS NOT NULL;
CREATE INDEX idx_project_sites_tenant ON project_sites (tenant_id);

CREATE TABLE site_users (
  id serial PRIMARY KEY,
  site_id integer NOT NULL REFERENCES project_sites(id) ON DELETE CASCADE,
  tenant_id integer NOT NULL,
  email varchar(320) NOT NULL,
  display_name varchar(120),
  status varchar(16) NOT NULL DEFAULT 'active',
  last_seen_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT site_users_site_email_unique UNIQUE (site_id, email)
);

CREATE TABLE site_user_sessions (
  id serial PRIMARY KEY,
  site_user_id integer NOT NULL REFERENCES site_users(id) ON DELETE CASCADE,
  site_id integer NOT NULL REFERENCES project_sites(id) ON DELETE CASCADE,
  tenant_id integer NOT NULL,
  token_hash varchar(64) NOT NULL CONSTRAINT site_user_sessions_token_unique UNIQUE,
  code_hash varchar(64),
  code_expires_at timestamp,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamp NOT NULL,
  redeemed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE site_collections (
  id serial PRIMARY KEY,
  site_id integer NOT NULL REFERENCES project_sites(id) ON DELETE CASCADE,
  tenant_id integer NOT NULL,
  project_id integer NOT NULL,
  name varchar(64) NOT NULL,
  accepts_public_writes boolean NOT NULL DEFAULT true,
  audience_id integer,
  daily_write_cap integer NOT NULL DEFAULT 0,
  record_count integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  read_policy varchar(16) NOT NULL DEFAULT 'none',
  raises_tickets boolean NOT NULL DEFAULT false,
  origin_session_id uuid
);
CREATE INDEX idx_site_collections_origin_session ON site_collections (origin_session_id);
CREATE INDEX idx_site_collections_project ON site_collections (project_id);
CREATE INDEX idx_site_collections_tenant ON site_collections (tenant_id);
COMMENT ON COLUMN site_collections.origin_session_id IS 'The Creation Session whose idea this collection was provisioned for. Null when the collection was created by hand: nobody knows which idea it belongs to, and guessing would attribute submissions to the wrong artifact.';

CREATE TABLE site_records (
  id bigserial PRIMARY KEY,
  collection_id integer NOT NULL REFERENCES site_collections(id) ON DELETE CASCADE,
  tenant_id integer NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  email varchar(320),
  ip_hash varchar(64),
  user_agent varchar(500),
  referrer varchar(1000),
  created_at timestamp NOT NULL DEFAULT now(),
  site_user_id integer REFERENCES site_users(id) ON DELETE SET NULL
);
CREATE INDEX idx_site_records_collection_time ON site_records (collection_id, created_at DESC);
CREATE INDEX idx_site_records_email ON site_records (email) WHERE email IS NOT NULL;
CREATE INDEX idx_site_records_tenant_time ON site_records (tenant_id, created_at DESC);

CREATE TABLE site_releases (
  id serial PRIMARY KEY,
  site_id integer NOT NULL REFERENCES project_sites(id) ON DELETE CASCADE,
  tenant_id integer NOT NULL,
  version_token varchar(32) NOT NULL,
  r2_prefix text NOT NULL,
  source varchar(16) NOT NULL DEFAULT 'browser',
  asset_count integer NOT NULL DEFAULT 0,
  total_bytes bigint NOT NULL DEFAULT 0,
  published_at timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT site_releases_site_version_unique UNIQUE (site_id, version_token)
);

CREATE TABLE site_subscriptions (
  id serial PRIMARY KEY,
  site_id integer NOT NULL REFERENCES project_sites(id) ON DELETE CASCADE,
  tenant_id integer NOT NULL,
  site_user_id integer NOT NULL REFERENCES site_users(id) ON DELETE CASCADE,
  catalog_item_id text,
  status varchar(16) NOT NULL DEFAULT 'active',
  price_cents integer NOT NULL DEFAULT 0,
  currency varchar(8) NOT NULL DEFAULT 'USD',
  provider_ref varchar(255),
  snapshot_id uuid,
  current_period_end timestamp,
  cancelled_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT site_subscriptions_site_user_unique UNIQUE (site_id, site_user_id)
);

CREATE TABLE site_traffic_daily (
  id serial PRIMARY KEY,
  site_id integer NOT NULL REFERENCES project_sites(id) ON DELETE CASCADE,
  tenant_id integer NOT NULL,
  project_id integer NOT NULL,
  day date NOT NULL,
  page_views integer NOT NULL DEFAULT 0,
  asset_hits integer NOT NULL DEFAULT 0,
  visitors integer NOT NULL DEFAULT 0,
  bytes_served bigint NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX idx_site_traffic_daily_project_day ON site_traffic_daily (project_id, day DESC);
CREATE INDEX idx_site_traffic_daily_tenant_day ON site_traffic_daily (tenant_id, day DESC);
