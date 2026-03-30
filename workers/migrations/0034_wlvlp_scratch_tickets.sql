CREATE TABLE IF NOT EXISTS wlvlp_scratch_tickets (
  ticket_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unscratched',
  prize_type TEXT,
  prize_value TEXT,
  revealed_at TEXT,
  created_at TEXT NOT NULL
);
