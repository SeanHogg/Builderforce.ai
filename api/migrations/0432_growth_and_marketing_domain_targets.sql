-- 0432_growth_and_marketing_domain_targets.sql
--
-- Growth and marketing domain targets
--
-- GENERATED from src/infrastructure/database/schema/growth.ts by
-- scripts/gen-consolidation-migration.mjs (PRD 20 §5 step 2). Edit the Drizzle
-- module and regenerate; do not hand-edit the DDL, or the two sources of truth
-- this file exists to collapse come straight back.
--
-- 47 table(s). Idempotent: replayable against an environment at any
-- point in the sequence.

CREATE TABLE IF NOT EXISTS email_campaigns (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  kind VARCHAR(32) NOT NULL DEFAULT 'marketing',
  name VARCHAR(200) NOT NULL,
  subject VARCHAR(300),
  preheader VARCHAR(300),
  from_name VARCHAR(160),
  from_email VARCHAR(320),
  body_html TEXT,
  body_text TEXT,
  audience JSONB,
  connection_id INTEGER,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  scheduled_at TIMESTAMP,
  sent_at TIMESTAMP,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  open_count INTEGER NOT NULL DEFAULT 0,
  click_count INTEGER NOT NULL DEFAULT 0,
  reply_count INTEGER NOT NULL DEFAULT 0,
  bounce_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_campaigns_name ON email_campaigns (tenant_id, name);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_status ON email_campaigns (tenant_id, status, scheduled_at);

CREATE TABLE IF NOT EXISTS marketing_emails (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  key VARCHAR(96) NOT NULL,
  name VARCHAR(200) NOT NULL,
  subject VARCHAR(300),
  body_html TEXT,
  body_text TEXT,
  variables JSONB,
  is_template BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_marketing_emails_key ON marketing_emails (tenant_id, key);

CREATE TABLE IF NOT EXISTS nurture_flows (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  name VARCHAR(200) NOT NULL,
  goal VARCHAR(200),
  steps JSONB NOT NULL DEFAULT '[]',
  entry_rule JSONB,
  exit_rule JSONB,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  owner_ref VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_nurture_flows_name ON nurture_flows (tenant_id, name);

CREATE TABLE IF NOT EXISTS follow_up_enrollments (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  sequence_kind VARCHAR(24) NOT NULL DEFAULT 'follow_up',
  sequence_ref VARCHAR(64) NOT NULL,
  subject_kind VARCHAR(16) NOT NULL DEFAULT 'contact',
  subject_ref VARCHAR(64) NOT NULL,
  current_step INTEGER NOT NULL DEFAULT 0,
  next_send_at TIMESTAMP,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  enrolled_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  exit_reason VARCHAR(120),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_follow_up_enrollments_subject ON follow_up_enrollments (tenant_id, sequence_kind, sequence_ref, subject_ref);
CREATE INDEX IF NOT EXISTS idx_follow_up_enrollments_due ON follow_up_enrollments (status, next_send_at);

CREATE TABLE IF NOT EXISTS customer_journeys (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  name VARCHAR(200) NOT NULL,
  persona VARCHAR(120),
  stages JSONB NOT NULL DEFAULT '[]',
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_journeys_name ON customer_journeys (tenant_id, name);

CREATE TABLE IF NOT EXISTS journey_touchpoints (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  journey_id INTEGER REFERENCES customer_journeys(id) ON DELETE CASCADE,
  subject_ref VARCHAR(64),
  visitor_id VARCHAR(64),
  stage VARCHAR(64) NOT NULL,
  channel VARCHAR(32),
  label VARCHAR(200),
  attribution NUMERIC(5, 4),
  occurred_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_journey_touchpoints_subject ON journey_touchpoints (tenant_id, subject_ref, occurred_at);
CREATE INDEX IF NOT EXISTS idx_journey_touchpoints_journey ON journey_touchpoints (journey_id, stage, occurred_at);

CREATE TABLE IF NOT EXISTS marketing_leads (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  email VARCHAR(320),
  name VARCHAR(200),
  company VARCHAR(255),
  phone VARCHAR(40),
  origin VARCHAR(24) NOT NULL DEFAULT 'marketing',
  source VARCHAR(96),
  campaign_id INTEGER,
  utm JSONB,
  score NUMERIC(5, 2),
  status VARCHAR(16) NOT NULL DEFAULT 'new',
  owner_ref VARCHAR(64),
  converted_contact_ref VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_marketing_leads_status ON marketing_leads (tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_marketing_leads_email ON marketing_leads (tenant_id, email);

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  list_key VARCHAR(96) NOT NULL,
  email VARCHAR(320) NOT NULL,
  name VARCHAR(200),
  referrer VARCHAR(500),
  position INTEGER,
  status VARCHAR(16) NOT NULL DEFAULT 'waiting',
  invited_at TIMESTAMP,
  joined_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_waitlist_entries_email ON waitlist_entries (list_key, email);

CREATE TABLE IF NOT EXISTS referral_entries (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  referrer_ref VARCHAR(64) NOT NULL,
  referee_email VARCHAR(320),
  referee_ref VARCHAR(64),
  code VARCHAR(64),
  status VARCHAR(16) NOT NULL DEFAULT 'sent',
  reward_ledger_ref VARCHAR(160),
  qualified_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_referral_entries_referrer ON referral_entries (tenant_id, referrer_ref, status);

CREATE TABLE IF NOT EXISTS affiliate_referrals (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  affiliate_ref VARCHAR(64) NOT NULL,
  click_id VARCHAR(64),
  landing_path VARCHAR(500),
  referee_ref VARCHAR(64),
  order_id INTEGER,
  commission_cents INTEGER NOT NULL DEFAULT 0,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  status VARCHAR(16) NOT NULL DEFAULT 'clicked',
  converted_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_affiliate_referrals_affiliate ON affiliate_referrals (tenant_id, affiliate_ref, status);

CREATE TABLE IF NOT EXISTS podcast_outreach (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  show_name VARCHAR(255) NOT NULL,
  host_name VARCHAR(200),
  contact_email VARCHAR(320),
  audience_size INTEGER,
  topic_pitch TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'researching',
  recorded_at TIMESTAMP,
  published_url TEXT,
  owner_ref VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_podcast_outreach_show ON podcast_outreach (tenant_id, show_name);

CREATE TABLE IF NOT EXISTS ad_campaigns (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  connection_id INTEGER,
  platform VARCHAR(32) NOT NULL,
  external_id VARCHAR(160),
  name VARCHAR(200) NOT NULL,
  objective VARCHAR(48),
  daily_budget_cents INTEGER,
  total_budget_cents INTEGER,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  starts_at TIMESTAMP,
  ends_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ad_campaigns_external ON ad_campaigns (tenant_id, platform, external_id);

CREATE TABLE IF NOT EXISTS ad_sets (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  campaign_id INTEGER REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  external_id VARCHAR(160),
  name VARCHAR(200) NOT NULL,
  targeting JSONB,
  bid_strategy VARCHAR(48),
  bid_cents INTEGER,
  daily_budget_cents INTEGER,
  status VARCHAR(16) NOT NULL DEFAULT 'paused',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ad_sets_external ON ad_sets (tenant_id, external_id);

CREATE TABLE IF NOT EXISTS ads (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  ad_set_id INTEGER REFERENCES ad_sets(id) ON DELETE CASCADE,
  external_id VARCHAR(160),
  name VARCHAR(200) NOT NULL,
  headline VARCHAR(300),
  body TEXT,
  call_to_action VARCHAR(64),
  destination_url TEXT,
  creative_artifact_id UUID,
  status VARCHAR(16) NOT NULL DEFAULT 'paused',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ads_external ON ads (tenant_id, external_id);

CREATE TABLE IF NOT EXISTS boosts (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  subject_kind VARCHAR(32) NOT NULL,
  subject_ref VARCHAR(64) NOT NULL,
  buyer_ref VARCHAR(64),
  placement VARCHAR(32) NOT NULL,
  starts_at TIMESTAMP NOT NULL,
  ends_at TIMESTAMP NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  impression_count INTEGER NOT NULL DEFAULT 0,
  click_count INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'scheduled',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_boosts_live ON boosts (tenant_id, placement, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS boost_checkouts (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  boost_id INTEGER REFERENCES boosts(id) ON DELETE CASCADE,
  order_id INTEGER,
  requested_starts_at TIMESTAMP,
  requested_ends_at TIMESTAMP,
  availability VARCHAR(16) NOT NULL DEFAULT 'unchecked',
  conflict_reason VARCHAR(200),
  checked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_boost_checkouts_availability ON boost_checkouts (tenant_id, availability, requested_starts_at);

CREATE TABLE IF NOT EXISTS ab_tests (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  key VARCHAR(96) NOT NULL,
  name VARCHAR(200) NOT NULL,
  hypothesis TEXT,
  primary_metric VARCHAR(96),
  minimum_sample INTEGER,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  winning_variant_id INTEGER,
  conclusion TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ab_tests_key ON ab_tests (tenant_id, key);

CREATE TABLE IF NOT EXISTS ab_test_variants (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  test_id INTEGER REFERENCES ab_tests(id) ON DELETE CASCADE,
  key VARCHAR(48) NOT NULL,
  name VARCHAR(160) NOT NULL,
  is_control BOOLEAN NOT NULL DEFAULT false,
  traffic_percent NUMERIC(5, 2) NOT NULL DEFAULT '50',
  payload JSONB,
  exposure_count INTEGER NOT NULL DEFAULT 0,
  conversion_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ab_test_variants_key ON ab_test_variants (test_id, key);

CREATE TABLE IF NOT EXISTS ab_test_segments (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  test_id INTEGER REFERENCES ab_tests(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL,
  rule JSONB NOT NULL DEFAULT '{}',
  is_exclusion BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ab_test_segments_name ON ab_test_segments (test_id, name);

CREATE TABLE IF NOT EXISTS experiments (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  hypothesis TEXT,
  success_criteria TEXT,
  owner_ref VARCHAR(64),
  status VARCHAR(16) NOT NULL DEFAULT 'proposed',
  started_at TIMESTAMP,
  review_at TIMESTAMP,
  concluded_at TIMESTAMP,
  outcome TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_experiments_name ON experiments (tenant_id, name);

CREATE TABLE IF NOT EXISTS landing_pages (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  slug VARCHAR(200) NOT NULL,
  title VARCHAR(300) NOT NULL,
  campaign_id INTEGER,
  goal_metric VARCHAR(96),
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  shell_kind VARCHAR(16) NOT NULL DEFAULT 'public',
  published_at TIMESTAMP,
  ends_at TIMESTAMP,
  view_count INTEGER NOT NULL DEFAULT 0,
  conversion_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_landing_pages_slug ON landing_pages (tenant_id, slug);

CREATE TABLE IF NOT EXISTS landing_page_blocks (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  page_id INTEGER REFERENCES landing_pages(id) ON DELETE CASCADE,
  kind VARCHAR(48) NOT NULL,
  content JSONB,
  position INTEGER NOT NULL DEFAULT 0,
  is_visible BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_landing_page_blocks_pos ON landing_page_blocks (page_id, position);

CREATE TABLE IF NOT EXISTS website_pages (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  path VARCHAR(500) NOT NULL,
  title VARCHAR(300) NOT NULL,
  nav_label VARCHAR(160),
  nav_position INTEGER,
  parent_path VARCHAR(500),
  body_markdown TEXT,
  canonical_path VARCHAR(500),
  shell_kind VARCHAR(16) NOT NULL DEFAULT 'public',
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  published_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_website_pages_path ON website_pages (tenant_id, path);

CREATE TABLE IF NOT EXISTS marketing_seo_pages (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  pattern VARCHAR(255) NOT NULL,
  path VARCHAR(500) NOT NULL,
  title VARCHAR(300) NOT NULL,
  meta_description VARCHAR(500),
  params JSONB,
  structured_data JSONB,
  status VARCHAR(16) NOT NULL DEFAULT 'published',
  last_rendered_at TIMESTAMP,
  impression_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_marketing_seo_pages_path ON marketing_seo_pages (path);
CREATE INDEX IF NOT EXISTS idx_marketing_seo_pages_pattern ON marketing_seo_pages (pattern, status);

CREATE TABLE IF NOT EXISTS employer_branding_pages (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  slug VARCHAR(200) NOT NULL,
  headline VARCHAR(300),
  story TEXT,
  values JSONB,
  perks JSONB,
  hero_artifact_id UUID,
  theme JSONB,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  published_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_employer_branding_pages_slug ON employer_branding_pages (tenant_id, slug);

CREATE TABLE IF NOT EXISTS announcement_banners (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  key VARCHAR(96) NOT NULL,
  message VARCHAR(500) NOT NULL,
  tone VARCHAR(16) NOT NULL DEFAULT 'info',
  cta_label VARCHAR(96),
  cta_href VARCHAR(500),
  audience JSONB,
  dismissible BOOLEAN NOT NULL DEFAULT true,
  starts_at TIMESTAMP,
  ends_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_announcement_banners_key ON announcement_banners (tenant_id, key);

CREATE TABLE IF NOT EXISTS embed_widget_layout (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  widget_key VARCHAR(96) NOT NULL,
  host_pattern VARCHAR(255),
  mode VARCHAR(16) NOT NULL DEFAULT 'inline',
  anchor VARCHAR(160),
  layout JSONB,
  theme JSONB,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_embed_widget_layout_key ON embed_widget_layout (tenant_id, widget_key, host_pattern);

CREATE TABLE IF NOT EXISTS marketing_heatmap_pages (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  path VARCHAR(500) NOT NULL,
  click_map JSONB,
  scroll_map JSONB,
  sample_count INTEGER NOT NULL DEFAULT 0,
  period_start TIMESTAMP,
  period_end TIMESTAMP,
  computed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_marketing_heatmap_pages_path ON marketing_heatmap_pages (tenant_id, path, period_start);

CREATE TABLE IF NOT EXISTS marketing_heatmap_screenshots (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  page_id INTEGER REFERENCES marketing_heatmap_pages(id) ON DELETE CASCADE,
  artifact_id UUID,
  viewport_width INTEGER NOT NULL,
  viewport_height INTEGER,
  theme_mode VARCHAR(8) NOT NULL DEFAULT 'light',
  captured_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_marketing_heatmap_screenshots_viewport ON marketing_heatmap_screenshots (page_id, viewport_width, theme_mode);

CREATE TABLE IF NOT EXISTS brand_kits (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  name VARCHAR(200) NOT NULL,
  palette JSONB,
  typography JSONB,
  logo_artifact_id UUID,
  logo_dark_artifact_id UUID,
  voice TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_brand_kits_name ON brand_kits (tenant_id, name);

CREATE TABLE IF NOT EXISTS marketing_content_items (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  title VARCHAR(300) NOT NULL,
  format VARCHAR(32) NOT NULL,
  channel VARCHAR(48),
  brief TEXT,
  artifact_id UUID,
  owner_ref VARCHAR(64),
  status VARCHAR(16) NOT NULL DEFAULT 'idea',
  scheduled_at TIMESTAMP,
  published_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_marketing_content_items_status ON marketing_content_items (tenant_id, status, scheduled_at);

CREATE TABLE IF NOT EXISTS blog_posts (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  slug VARCHAR(200) NOT NULL,
  title VARCHAR(300) NOT NULL,
  excerpt TEXT,
  body_markdown TEXT,
  author_ref VARCHAR(64),
  category VARCHAR(96),
  tags JSONB,
  hero_artifact_id UUID,
  read_minutes INTEGER,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  published_at TIMESTAMP,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_blog_posts_slug ON blog_posts (tenant_id, slug);
CREATE INDEX IF NOT EXISTS idx_blog_posts_published ON blog_posts (status, published_at);

CREATE TABLE IF NOT EXISTS videos (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  artifact_id UUID,
  title VARCHAR(300) NOT NULL,
  description TEXT,
  duration_ms INTEGER,
  thumbnail_artifact_id UUID,
  visibility VARCHAR(16) NOT NULL DEFAULT 'private',
  view_count INTEGER NOT NULL DEFAULT 0,
  published_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_videos_visibility ON videos (tenant_id, visibility, published_at);

CREATE TABLE IF NOT EXISTS learn_videos (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
  surface VARCHAR(32) NOT NULL,
  feature_key VARCHAR(96),
  title VARCHAR(300) NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_learn_videos_surface ON learn_videos (tenant_id, surface, feature_key, position);

CREATE TABLE IF NOT EXISTS page_embed_videos (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  page_path VARCHAR(500) NOT NULL,
  video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
  anchor VARCHAR(160),
  autoplay BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_page_embed_videos_pos ON page_embed_videos (tenant_id, page_path, position);

CREATE TABLE IF NOT EXISTS creator_youtube_ingests (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  connection_id INTEGER,
  channel_id VARCHAR(96) NOT NULL,
  channel_title VARCHAR(255),
  last_video_at TIMESTAMP,
  imported_count INTEGER NOT NULL DEFAULT 0,
  auto_import BOOLEAN NOT NULL DEFAULT true,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  last_error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_creator_youtube_ingests_channel ON creator_youtube_ingests (tenant_id, channel_id);

CREATE TABLE IF NOT EXISTS content_audiences (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  key VARCHAR(96) NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  pain_points JSONB,
  channels JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_content_audiences_key ON content_audiences (tenant_id, key);

CREATE TABLE IF NOT EXISTS content_locations (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  slug VARCHAR(200) NOT NULL,
  name VARCHAR(200) NOT NULL,
  country VARCHAR(2),
  region VARCHAR(120),
  city_id INTEGER,
  is_generated BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_content_locations_slug ON content_locations (tenant_id, slug);

CREATE TABLE IF NOT EXISTS feed_posts (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  author_ref VARCHAR(64),
  body TEXT,
  artifact_id UUID,
  link_url TEXT,
  like_count INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'published',
  pinned_until TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feed_posts_recent ON feed_posts (tenant_id, status, created_at);

CREATE TABLE IF NOT EXISTS feed_features (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  key VARCHAR(96) NOT NULL,
  label VARCHAR(200) NOT NULL,
  required_rung INTEGER NOT NULL DEFAULT 0,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_feed_features_key ON feed_features (tenant_id, key);

CREATE TABLE IF NOT EXISTS activity_feed (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  audience_ref VARCHAR(64) NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  verb VARCHAR(64) NOT NULL,
  actor_ref VARCHAR(64),
  summary VARCHAR(500),
  group_key VARCHAR(160),
  group_count INTEGER NOT NULL DEFAULT 1,
  seen_at TIMESTAMP,
  occurred_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_feed_audience ON activity_feed (tenant_id, audience_ref, occurred_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_activity_feed_group ON activity_feed (tenant_id, audience_ref, group_key);

CREATE TABLE IF NOT EXISTS event_categories (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  key VARCHAR(64) NOT NULL,
  label VARCHAR(160) NOT NULL,
  color_token VARCHAR(48),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_categories_key ON event_categories (tenant_id, key);

CREATE TABLE IF NOT EXISTS event_waitlist (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  event_ref VARCHAR(64) NOT NULL,
  party_ref VARCHAR(64),
  email VARCHAR(320),
  position INTEGER,
  status VARCHAR(16) NOT NULL DEFAULT 'waiting',
  offered_at TIMESTAMP,
  offer_expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_waitlist_party ON event_waitlist (tenant_id, event_ref, email);

CREATE TABLE IF NOT EXISTS event_reminders_sent (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  event_ref VARCHAR(64) NOT NULL,
  recipient_ref VARCHAR(64),
  recipient_email VARCHAR(320),
  offset_key VARCHAR(24) NOT NULL,
  delivery_ref VARCHAR(64),
  sent_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_reminders_sent_offset ON event_reminders_sent (tenant_id, event_ref, recipient_email, offset_key);

CREATE TABLE IF NOT EXISTS event_matchmaking (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  event_ref VARCHAR(64) NOT NULL,
  party_a_ref VARCHAR(64) NOT NULL,
  party_b_ref VARCHAR(64) NOT NULL,
  score NUMERIC(5, 2),
  reasons JSONB,
  status VARCHAR(16) NOT NULL DEFAULT 'suggested',
  slot_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_matchmaking_pair ON event_matchmaking (tenant_id, event_ref, party_aref, party_bref);

CREATE TABLE IF NOT EXISTS email_otp_challenges (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  email VARCHAR(320) NOT NULL,
  purpose VARCHAR(48) NOT NULL DEFAULT 'subscribe',
  code_hash VARCHAR(64) NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  consumed_at TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_otp_challenges_email ON email_otp_challenges (email, purpose, expires_at);

CREATE TABLE IF NOT EXISTS promo_projects (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  client_ref VARCHAR(64),
  order_id INTEGER,
  title VARCHAR(300) NOT NULL,
  brief TEXT,
  deliverable VARCHAR(32) NOT NULL,
  revisions_allowed INTEGER NOT NULL DEFAULT 2,
  revisions_used INTEGER NOT NULL DEFAULT 0,
  due_at TIMESTAMP,
  status VARCHAR(16) NOT NULL DEFAULT 'briefed',
  delivered_artifact_id UUID,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_promo_projects_status ON promo_projects (tenant_id, status, due_at);

-- Tenancy foreign keys (PRD 20 §4 — every table carries tenant_id).
ALTER TABLE email_campaigns DROP CONSTRAINT IF EXISTS fk_email_campaigns_tenant;
ALTER TABLE email_campaigns ADD CONSTRAINT fk_email_campaigns_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE marketing_emails DROP CONSTRAINT IF EXISTS fk_marketing_emails_tenant;
ALTER TABLE marketing_emails ADD CONSTRAINT fk_marketing_emails_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE nurture_flows DROP CONSTRAINT IF EXISTS fk_nurture_flows_tenant;
ALTER TABLE nurture_flows ADD CONSTRAINT fk_nurture_flows_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE follow_up_enrollments DROP CONSTRAINT IF EXISTS fk_follow_up_enrollments_tenant;
ALTER TABLE follow_up_enrollments ADD CONSTRAINT fk_follow_up_enrollments_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE customer_journeys DROP CONSTRAINT IF EXISTS fk_customer_journeys_tenant;
ALTER TABLE customer_journeys ADD CONSTRAINT fk_customer_journeys_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE journey_touchpoints DROP CONSTRAINT IF EXISTS fk_journey_touchpoints_tenant;
ALTER TABLE journey_touchpoints ADD CONSTRAINT fk_journey_touchpoints_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE marketing_leads DROP CONSTRAINT IF EXISTS fk_marketing_leads_tenant;
ALTER TABLE marketing_leads ADD CONSTRAINT fk_marketing_leads_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE waitlist_entries DROP CONSTRAINT IF EXISTS fk_waitlist_entries_tenant;
ALTER TABLE waitlist_entries ADD CONSTRAINT fk_waitlist_entries_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE referral_entries DROP CONSTRAINT IF EXISTS fk_referral_entries_tenant;
ALTER TABLE referral_entries ADD CONSTRAINT fk_referral_entries_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE affiliate_referrals DROP CONSTRAINT IF EXISTS fk_affiliate_referrals_tenant;
ALTER TABLE affiliate_referrals ADD CONSTRAINT fk_affiliate_referrals_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE podcast_outreach DROP CONSTRAINT IF EXISTS fk_podcast_outreach_tenant;
ALTER TABLE podcast_outreach ADD CONSTRAINT fk_podcast_outreach_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE ad_campaigns DROP CONSTRAINT IF EXISTS fk_ad_campaigns_tenant;
ALTER TABLE ad_campaigns ADD CONSTRAINT fk_ad_campaigns_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE ad_sets DROP CONSTRAINT IF EXISTS fk_ad_sets_tenant;
ALTER TABLE ad_sets ADD CONSTRAINT fk_ad_sets_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE ads DROP CONSTRAINT IF EXISTS fk_ads_tenant;
ALTER TABLE ads ADD CONSTRAINT fk_ads_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE boosts DROP CONSTRAINT IF EXISTS fk_boosts_tenant;
ALTER TABLE boosts ADD CONSTRAINT fk_boosts_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE boost_checkouts DROP CONSTRAINT IF EXISTS fk_boost_checkouts_tenant;
ALTER TABLE boost_checkouts ADD CONSTRAINT fk_boost_checkouts_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE ab_tests DROP CONSTRAINT IF EXISTS fk_ab_tests_tenant;
ALTER TABLE ab_tests ADD CONSTRAINT fk_ab_tests_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE ab_test_variants DROP CONSTRAINT IF EXISTS fk_ab_test_variants_tenant;
ALTER TABLE ab_test_variants ADD CONSTRAINT fk_ab_test_variants_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE ab_test_segments DROP CONSTRAINT IF EXISTS fk_ab_test_segments_tenant;
ALTER TABLE ab_test_segments ADD CONSTRAINT fk_ab_test_segments_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE experiments DROP CONSTRAINT IF EXISTS fk_experiments_tenant;
ALTER TABLE experiments ADD CONSTRAINT fk_experiments_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE landing_pages DROP CONSTRAINT IF EXISTS fk_landing_pages_tenant;
ALTER TABLE landing_pages ADD CONSTRAINT fk_landing_pages_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE landing_page_blocks DROP CONSTRAINT IF EXISTS fk_landing_page_blocks_tenant;
ALTER TABLE landing_page_blocks ADD CONSTRAINT fk_landing_page_blocks_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE website_pages DROP CONSTRAINT IF EXISTS fk_website_pages_tenant;
ALTER TABLE website_pages ADD CONSTRAINT fk_website_pages_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE marketing_seo_pages DROP CONSTRAINT IF EXISTS fk_marketing_seo_pages_tenant;
ALTER TABLE marketing_seo_pages ADD CONSTRAINT fk_marketing_seo_pages_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE employer_branding_pages DROP CONSTRAINT IF EXISTS fk_employer_branding_pages_tenant;
ALTER TABLE employer_branding_pages ADD CONSTRAINT fk_employer_branding_pages_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE announcement_banners DROP CONSTRAINT IF EXISTS fk_announcement_banners_tenant;
ALTER TABLE announcement_banners ADD CONSTRAINT fk_announcement_banners_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE embed_widget_layout DROP CONSTRAINT IF EXISTS fk_embed_widget_layout_tenant;
ALTER TABLE embed_widget_layout ADD CONSTRAINT fk_embed_widget_layout_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE marketing_heatmap_pages DROP CONSTRAINT IF EXISTS fk_marketing_heatmap_pages_tenant;
ALTER TABLE marketing_heatmap_pages ADD CONSTRAINT fk_marketing_heatmap_pages_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE marketing_heatmap_screenshots DROP CONSTRAINT IF EXISTS fk_marketing_heatmap_screenshots_tenant;
ALTER TABLE marketing_heatmap_screenshots ADD CONSTRAINT fk_marketing_heatmap_screenshots_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE brand_kits DROP CONSTRAINT IF EXISTS fk_brand_kits_tenant;
ALTER TABLE brand_kits ADD CONSTRAINT fk_brand_kits_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE marketing_content_items DROP CONSTRAINT IF EXISTS fk_marketing_content_items_tenant;
ALTER TABLE marketing_content_items ADD CONSTRAINT fk_marketing_content_items_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE blog_posts DROP CONSTRAINT IF EXISTS fk_blog_posts_tenant;
ALTER TABLE blog_posts ADD CONSTRAINT fk_blog_posts_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE videos DROP CONSTRAINT IF EXISTS fk_videos_tenant;
ALTER TABLE videos ADD CONSTRAINT fk_videos_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE learn_videos DROP CONSTRAINT IF EXISTS fk_learn_videos_tenant;
ALTER TABLE learn_videos ADD CONSTRAINT fk_learn_videos_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE page_embed_videos DROP CONSTRAINT IF EXISTS fk_page_embed_videos_tenant;
ALTER TABLE page_embed_videos ADD CONSTRAINT fk_page_embed_videos_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE creator_youtube_ingests DROP CONSTRAINT IF EXISTS fk_creator_youtube_ingests_tenant;
ALTER TABLE creator_youtube_ingests ADD CONSTRAINT fk_creator_youtube_ingests_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE content_audiences DROP CONSTRAINT IF EXISTS fk_content_audiences_tenant;
ALTER TABLE content_audiences ADD CONSTRAINT fk_content_audiences_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE content_locations DROP CONSTRAINT IF EXISTS fk_content_locations_tenant;
ALTER TABLE content_locations ADD CONSTRAINT fk_content_locations_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE feed_posts DROP CONSTRAINT IF EXISTS fk_feed_posts_tenant;
ALTER TABLE feed_posts ADD CONSTRAINT fk_feed_posts_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE feed_features DROP CONSTRAINT IF EXISTS fk_feed_features_tenant;
ALTER TABLE feed_features ADD CONSTRAINT fk_feed_features_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE activity_feed DROP CONSTRAINT IF EXISTS fk_activity_feed_tenant;
ALTER TABLE activity_feed ADD CONSTRAINT fk_activity_feed_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE event_categories DROP CONSTRAINT IF EXISTS fk_event_categories_tenant;
ALTER TABLE event_categories ADD CONSTRAINT fk_event_categories_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE event_waitlist DROP CONSTRAINT IF EXISTS fk_event_waitlist_tenant;
ALTER TABLE event_waitlist ADD CONSTRAINT fk_event_waitlist_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE event_reminders_sent DROP CONSTRAINT IF EXISTS fk_event_reminders_sent_tenant;
ALTER TABLE event_reminders_sent ADD CONSTRAINT fk_event_reminders_sent_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE event_matchmaking DROP CONSTRAINT IF EXISTS fk_event_matchmaking_tenant;
ALTER TABLE event_matchmaking ADD CONSTRAINT fk_event_matchmaking_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE email_otp_challenges DROP CONSTRAINT IF EXISTS fk_email_otp_challenges_tenant;
ALTER TABLE email_otp_challenges ADD CONSTRAINT fk_email_otp_challenges_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE promo_projects DROP CONSTRAINT IF EXISTS fk_promo_projects_tenant;
ALTER TABLE promo_projects ADD CONSTRAINT fk_promo_projects_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
