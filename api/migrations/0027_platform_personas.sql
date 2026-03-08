-- Platform personas (admin-managed). Used by admin Personas tab and merged into marketplace.
CREATE TABLE IF NOT EXISTS platform_personas (
  id                serial PRIMARY KEY,
  name              varchar(255) NOT NULL,
  slug              varchar(255) NOT NULL UNIQUE,
  description       text,
  voice             varchar(500),
  perspective       varchar(500),
  decision_style    varchar(500),
  output_prefix     varchar(50),
  capabilities      text,  -- JSON array
  tags              text,  -- JSON array
  source            varchar(50) NOT NULL DEFAULT 'builtin',
  author            varchar(255),
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamp NOT NULL DEFAULT now(),
  updated_at        timestamp NOT NULL DEFAULT now()
);
