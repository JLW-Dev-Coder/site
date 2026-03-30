CREATE TABLE IF NOT EXISTS gvlp_visitor_sessions (
  visitor_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  last_seen TEXT NOT NULL,
  created_at TEXT NOT NULL
);