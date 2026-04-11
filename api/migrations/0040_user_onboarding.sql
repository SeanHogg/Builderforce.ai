-- Migration: add onboarding tracking columns to users table
-- onboarding_completed_at: timestamp set when the user finishes the onboarding flow
-- user_intent: JSON array of intent strings captured during onboarding

ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS user_intent TEXT;
