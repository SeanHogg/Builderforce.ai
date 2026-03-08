DO $$ BEGIN
  CREATE TYPE newsletter_subscription_status AS ENUM ('subscribed', 'unsubscribed', 'suppressed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE newsletter_event_type AS ENUM ('subscribed', 'unsubscribed', 'template_sent', 'email_opened', 'email_clicked');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id serial PRIMARY KEY,
  user_id varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  email varchar(255) NOT NULL UNIQUE,
  first_name varchar(120),
  last_name varchar(120),
  source varchar(120) NOT NULL DEFAULT 'marketing_site',
  status newsletter_subscription_status NOT NULL DEFAULT 'subscribed',
  subscribed_at timestamp NOT NULL DEFAULT now(),
  unsubscribed_at timestamp,
  unsubscribe_reason text,
  last_communication_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS newsletter_templates (
  id serial PRIMARY KEY,
  name varchar(180) NOT NULL,
  slug varchar(180) NOT NULL UNIQUE,
  subject varchar(255) NOT NULL,
  preheader varchar(255),
  body_markdown text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  updated_by varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS newsletter_events (
  id serial PRIMARY KEY,
  subscriber_id integer NOT NULL REFERENCES newsletter_subscribers(id) ON DELETE CASCADE,
  template_id integer REFERENCES newsletter_templates(id) ON DELETE SET NULL,
  event_type newsletter_event_type NOT NULL,
  metadata text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_status ON newsletter_subscribers(status);
CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_created_at ON newsletter_subscribers(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_newsletter_events_type_created ON newsletter_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_newsletter_events_subscriber_id ON newsletter_events(subscriber_id);
