-- Migration: Add onboarding tracking columns to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS user_intent TEXT;
