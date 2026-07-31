-- Migration: Add is_active column to users table for profile soft-delete functionality
-- Task #172: User Profile Management API

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);
