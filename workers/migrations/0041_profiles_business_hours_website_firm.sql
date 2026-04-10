-- Add business_hours, website, and firm_name columns to profiles table
-- Completes the onboarding form → D1 projection round-trip

ALTER TABLE profiles ADD COLUMN business_hours TEXT;
ALTER TABLE profiles ADD COLUMN website TEXT;
ALTER TABLE profiles ADD COLUMN firm_name TEXT;
