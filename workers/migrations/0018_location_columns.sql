-- VLP D1 Migration: location columns
-- Created: 2026-03-29
-- Worker binding: DB

-- Add location columns to profiles (tax pros)
ALTER TABLE profiles ADD COLUMN city TEXT;
ALTER TABLE profiles ADD COLUMN state TEXT;
ALTER TABLE profiles ADD COLUMN zip TEXT;

-- Add location columns to accounts (taxpayers)
ALTER TABLE accounts ADD COLUMN city TEXT;
ALTER TABLE accounts ADD COLUMN state TEXT;
ALTER TABLE accounts ADD COLUMN zip TEXT;