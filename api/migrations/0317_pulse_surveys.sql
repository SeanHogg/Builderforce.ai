-- 0317_pulse_surveys.sql
-- EMP-15 — Internal sentiment / pulse survey.
-- A lightweight periodic pulse: a manager opens a single-question survey on a fixed
-- numeric scale; any member submits ONE anonymous score (+ optional comment). The
-- aggregate lens rolls scores into an average + trend + eNPS-style split; per-user
-- scores are NEVER returned (anonymity is a product guarantee). Idempotent.

CREATE TABLE IF NOT EXISTS pulse_surveys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id  UUID REFERENCES segments(id) ON DELETE CASCADE,
  question    VARCHAR(255) NOT NULL,
  scale       INTEGER NOT NULL DEFAULT 5,             -- top of the 1..scale range
  active      BOOLEAN NOT NULL DEFAULT true,
  created_by  VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT now(),
  closed_at   TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pulse_surveys_tenant ON pulse_surveys(tenant_id, active);

DROP TRIGGER IF EXISTS trg_pulse_surveys_segment ON pulse_surveys;
CREATE TRIGGER trg_pulse_surveys_segment
  BEFORE INSERT ON pulse_surveys
  FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();

CREATE TABLE IF NOT EXISTS pulse_responses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id   UUID NOT NULL REFERENCES pulse_surveys(id) ON DELETE CASCADE,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id  UUID REFERENCES segments(id) ON DELETE CASCADE,
  -- user_id is stored ONLY to enforce one-response-per-user (unique) and is never
  -- returned by any aggregate read. It is NOT the anonymity leak surface.
  user_id     VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  score       INTEGER NOT NULL,
  comment     TEXT,
  created_at  TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pulse_responses_survey ON pulse_responses(survey_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pulse_response_user ON pulse_responses(survey_id, user_id);

DROP TRIGGER IF EXISTS trg_pulse_responses_segment ON pulse_responses;
CREATE TRIGGER trg_pulse_responses_segment
  BEFORE INSERT ON pulse_responses
  FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();
