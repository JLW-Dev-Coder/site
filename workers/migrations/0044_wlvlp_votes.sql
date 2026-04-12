CREATE TABLE IF NOT EXISTS wlvlp_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  template_slug TEXT NOT NULL,
  voted_at TEXT NOT NULL,
  UNIQUE(account_id, template_slug)
);
