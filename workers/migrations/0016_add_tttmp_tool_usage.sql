CREATE TABLE IF NOT EXISTS tttmp_tool_usage (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  dedupe_key TEXT UNIQUE NOT NULL,
  executed_at INTEGER NOT NULL,
  tokens_deducted INTEGER NOT NULL,
  result_url TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_tttmp_tool_usage_account ON tttmp_tool_usage(account_id);
CREATE INDEX IF NOT EXISTS idx_tttmp_tool_usage_dedupe ON tttmp_tool_usage(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_tttmp_tool_usage_event ON tttmp_tool_usage(event_id);
