-- Add Cal.com OAuth token columns to accounts table
-- Replaces the per-user API key approach with standard OAuth 2.0 (authorization code flow)
-- The calcom_api_key column from migration 0046 is left in place but no longer used
ALTER TABLE accounts ADD COLUMN calcom_access_token TEXT;
ALTER TABLE accounts ADD COLUMN calcom_refresh_token TEXT;
ALTER TABLE accounts ADD COLUMN calcom_token_expiry TEXT;
