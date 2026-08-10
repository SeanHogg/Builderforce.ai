-- Server-backed CRM for referral / sales-associate accounts.
CREATE TABLE IF NOT EXISTS sales_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id varchar(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(255) NOT NULL DEFAULT '', email varchar(255) NOT NULL DEFAULT '', company varchar(255) NOT NULL DEFAULT '',
  market varchar(255) NOT NULL DEFAULT '', stage varchar(24) NOT NULL DEFAULT 'new', last_touch_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sales_contacts_owner_stage ON sales_contacts(owner_user_id, stage, updated_at DESC);
CREATE TABLE IF NOT EXISTS sales_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id varchar(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(255) NOT NULL, market varchar(255) NOT NULL DEFAULT '', subject varchar(500) NOT NULL DEFAULT '',
  status varchar(24) NOT NULL DEFAULT 'draft', sent integer NOT NULL DEFAULT 0, replies integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sales_campaigns_owner_status ON sales_campaigns(owner_user_id, status, updated_at DESC);
CREATE TABLE IF NOT EXISTS sales_weekly_goals (
  owner_user_id varchar(36) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  outreach_target integer NOT NULL DEFAULT 50, contacts_target integer NOT NULL DEFAULT 20, meetings_target integer NOT NULL DEFAULT 3,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sales_coaching_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), associate_user_id varchar(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_user_id varchar(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE, body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sales_coaching_notes_associate ON sales_coaching_notes(associate_user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS sales_canvas_sessions (
  owner_user_id varchar(36) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL UNIQUE REFERENCES creation_sessions(id) ON DELETE CASCADE,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
