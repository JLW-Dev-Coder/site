-- WLVLP Phase 2: custom domain connection
-- Adds custom_domain column to wlvlp_purchases for buyer-supplied domain mapping.

ALTER TABLE wlvlp_purchases ADD COLUMN custom_domain TEXT;

CREATE INDEX IF NOT EXISTS idx_wlvlp_purchases_custom_domain ON wlvlp_purchases(custom_domain);
CREATE INDEX IF NOT EXISTS idx_wlvlp_purchases_hosting_expires_at ON wlvlp_purchases(hosting_expires_at);
