-- Add profession, phone, and availability_text columns to profiles table
-- These support richer directory listings and filtering

ALTER TABLE profiles ADD COLUMN profession TEXT;
ALTER TABLE profiles ADD COLUMN phone TEXT;
ALTER TABLE profiles ADD COLUMN availability_text TEXT;
