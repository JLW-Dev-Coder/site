-- Add Cal.com personal API key column to accounts table
-- Users paste their Cal.com API key in profile settings; Worker uses it to fetch their bookings
ALTER TABLE accounts ADD COLUMN calcom_api_key TEXT;
