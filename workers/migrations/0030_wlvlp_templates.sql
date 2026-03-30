CREATE TABLE IF NOT EXISTS wlvlp_templates (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  thumbnail_url TEXT,
  status TEXT NOT NULL DEFAULT 'available',
  current_owner_id TEXT,
  bid_start_price INTEGER NOT NULL DEFAULT 29,
  buy_now_price INTEGER NOT NULL DEFAULT 99,
  auction_ends_at TEXT,
  vote_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
