-- Extend wlvlp_purchases with columns required by GET /v1/wlvlp/sites/by-account/:account_id
-- Base table created in 0031_wlvlp_purchases.sql

ALTER TABLE wlvlp_purchases ADD COLUMN tier TEXT;
ALTER TABLE wlvlp_purchases ADD COLUMN purchased_at TEXT;
ALTER TABLE wlvlp_purchases ADD COLUMN hosting_expires_at TEXT;
ALTER TABLE wlvlp_purchases ADD COLUMN stripe_session_id TEXT;

CREATE INDEX IF NOT EXISTS idx_wlvlp_purchases_account ON wlvlp_purchases(account_id);
CREATE INDEX IF NOT EXISTS idx_wlvlp_purchases_slug ON wlvlp_purchases(slug);
