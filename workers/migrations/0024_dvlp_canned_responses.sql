CREATE TABLE IF NOT EXISTS dvlp_canned_responses (
  template_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  user_type TEXT NOT NULL DEFAULT 'developer',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT
);