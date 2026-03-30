CREATE TABLE IF NOT EXISTS wlvlp_bids (
  bid_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  account_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);
