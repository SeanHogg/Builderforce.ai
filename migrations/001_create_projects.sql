-- Migration: Create projects table
CREATE TABLE projects (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  owner_id TEXT,
  template TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);