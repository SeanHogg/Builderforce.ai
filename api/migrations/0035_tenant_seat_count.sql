-- Add seat_count column to tenants table
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS seat_count INTEGER;
