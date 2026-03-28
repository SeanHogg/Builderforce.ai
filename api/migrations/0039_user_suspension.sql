-- Migration: add is_suspended column to users table
-- Suspension enforcement: admin can set this flag to block a user from logging in
-- or refreshing any session, regardless of existing tokens.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT FALSE;
